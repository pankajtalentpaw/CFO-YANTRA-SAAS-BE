const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes");
const env = require("./config/env");
const { logger } = require("./utils/logger");
const { connectDatabase, disconnectDatabase } = require("./config/db");
const tallySyncJob = require("./jobs/tallySync.job");

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors({ origin: "*" }));
app.use(express.json());

// API Routes
app.use("/api", apiRoutes);

// Root Health
app.get("/", (req, res) => {
  res.json({
    name: "CFO Yantra Backend API",
    version: "1.0.0",
    docs: "/api/health",
    tallyEndpoint: `http://${env.tally.host}:${env.tally.port}`
  });
});

// 404 for unmatched API routes, so a typo returns JSON instead of HTML.
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

// Centralized error handler
app.use((err, req, res, next) => {
  logger.error({ error: err.message, stack: err.stack }, "Unhandled backend error");
  if (res.headersSent) return next(err);
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error"
  });
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

  // Connect the local mirror and start the live auto-sync loop. Both are
  // optional: connectDatabase() resolves false instead of throwing when
  // MongoDB is absent, and the sync loop idles until it connects, so the
  // bridge still serves every route straight from TallyPrime.
  connectDatabase()
    .then(() => tallySyncJob.start())
    .catch((error) => logger.error({ error: error.message }, "Mirror startup failed - serving from TallyPrime only"));

  const server = app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`CFO Yantra Backend Engine running on http://localhost:${PORT}`);
    console.log(`TallyPrime Target: http://${env.tally.host}:${env.tally.port}`);
    console.log(`==================================================\n`);
  });

  server.on("error", handleListenError);

  // Release the port promptly so a restart is not blocked by EADDRINUSE.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      console.log(`\n${signal} received, shutting down...`);
      tallySyncJob.stop();
      server.close(() => {
        disconnectDatabase().finally(() => process.exit(0));
      });
      // Do not hang forever on a stuck connection.
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}

module.exports = app;
