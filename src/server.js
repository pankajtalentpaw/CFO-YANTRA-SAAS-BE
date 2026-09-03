const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes");
const env = require("./config/env");
const { logger } = require("./utils/logger");
const { connectDatabase, disconnectDatabase } = require("./config/db");
const tallySyncJob = require("./jobs/tallySync.job");

const app = express();
const PORT = process.env.PORT || 5000;

const { apiVersionMiddleware } = require("./versioning");
const { HTTP_STATUS, APP_ERROR_CODES, createErrorPayload } = require("./constants/statusCodes");

// Middlewares
app.use(cors({ origin: "*" }));
app.use(express.json());

// Apply API Versioning Engine strictly to /api/v1
app.use("/api/v1", apiVersionMiddleware());

// API Routes - Mount strictly on /api/v1
app.use("/api/v1", apiRoutes);

// Root Health
app.get("/", (req, res) => {
  res.json({
    name: "CFO Yantra Backend API",
    version: "1.0.0",
    docs: "/api/v1/health",
    tallyEndpoint: `http://${env.tally.host}:${env.tally.port}`
  });
});

// 404 for unmatched /api/v1 routes
app.use("/api/v1", (req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json(
    createErrorPayload(
      HTTP_STATUS.NOT_FOUND,
      `No such endpoint: ${req.method} ${req.originalUrl}`,
      APP_ERROR_CODES.ROUTE_NOT_FOUND
    )
  );
});

// Reject unversioned /api access with clear guidance to use /api/v1
app.use("/api", (req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json(
    createErrorPayload(
      HTTP_STATUS.NOT_FOUND,
      `Direct /api access is not supported. Please use /api/v1${req.path === "/" ? "" : req.path}`,
      APP_ERROR_CODES.API_VERSION_UNSUPPORTED
    )
  );
});

// Centralized error handler
app.use((err, req, res, next) => {
  logger.error({ error: err.message, stack: err.stack }, "Unhandled backend error");
  if (res.headersSent) return next(err);

  const status = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const errorCode = err.errorCode || (status >= 500 ? APP_ERROR_CODES.INTERNAL_SERVER_ERROR : APP_ERROR_CODES.VALIDATION_FAILED);

  res.status(status).json(
    createErrorPayload(
      status,
      err.message || "Internal server error",
      errorCode,
      err.details || undefined
    )
  );
});

/**
 * Keep the process alive through faults that would otherwise kill it.
 *
 * Express 4 does not catch errors thrown inside async handlers: they surface as
 * unhandled promise rejections, and Node terminates the process by default.
 * A single bad Tally response must not take the whole backend down.
 */
function installProcessGuards() {
  process.on("unhandledRejection", (reason) => {
    logger.error(
      { reason: reason instanceof Error ? reason.message : String(reason) },
      "Unhandled promise rejection - server kept alive"
    );
  });

  process.on("uncaughtException", (error) => {
    logger.error({ error: error.message, stack: error.stack }, "Uncaught exception - server kept alive");
  });
}

/** Report why the port could not be bound instead of dying with a raw stack. */
function handleListenError(error) {
  if (error.code === "EADDRINUSE") {
    logger.error({ port: PORT }, `Port ${PORT} is already in use. Another backend instance is probably running.`);
    console.error(`\nPort ${PORT} is already in use.`);
    console.error(`Find it with:  netstat -ano | findstr :${PORT}`);
    console.error(`Then stop that process, or start this one with a different PORT.\n`);
  } else {
    logger.error({ error: error.message, code: error.code }, "Server failed to start");
  }
  process.exit(1);
}

// Start Server
if (require.main === module) {
  installProcessGuards();

  const http = require("http");
  const httpServer = http.createServer(app);
  const { initRealtimeSocket } = require("./services/realtimeSocket.service");
  const { startCdcEngine, stopCdcEngine } = require("./services/sync/cdcEngine.service");

  initRealtimeSocket(httpServer);

  // Connect the local mirror and start the live auto-sync loop & CDC real-time engine.
  const { initTallyConfig } = require("./services/tallyConfig.service");
  connectDatabase()
    .then(async () => {
      await initTallyConfig();
      tallySyncJob.start();
      startCdcEngine();
    })
    .catch((error) => logger.error({ error: error.message }, "Mirror startup failed - serving from TallyPrime only"));

  httpServer.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`CFO Yantra Backend Engine running on http://localhost:${PORT}`);
    console.log(`Real-Time WebSockets active on ws://localhost:${PORT}`);
    console.log(`TallyPrime Target: http://${env.tally.host}:${env.tally.port}`);
    console.log(`==================================================\n`);
  });

  httpServer.on("error", handleListenError);

  // Release the port promptly so a restart is not blocked by EADDRINUSE.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      console.log(`\n${signal} received, shutting down...`);
      tallySyncJob.stop();
      stopCdcEngine();
      httpServer.close(() => {
        disconnectDatabase().finally(() => process.exit(0));
      });
      // Do not hang forever on a stuck connection.
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}

module.exports = app;

