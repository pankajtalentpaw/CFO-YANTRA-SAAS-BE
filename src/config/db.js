const dns = require("dns");
const mongoose = require("mongoose");
const env = require("./env");
const { logger } = require("../utils/logger");

/**
 * Local MongoDB mirror connection.
 *
 * TallyPrime stays the source of truth. The mirror is an accelerator and an
 * offline cache, never a dependency: if MongoDB is missing, stopped or
 * misconfigured, the bridge must keep answering exactly as it does today by
 * falling back to live extraction. So every failure here is logged and
 * swallowed rather than thrown at the caller or allowed to kill the process.
 */

let connecting = null;
let lastError = null;

/** 1 = connected. Anything else means callers must use the live Tally path. */
function isConnected() {
  return mongoose.connection.readyState === 1;
}

function getLastError() {
  return lastError;
}

async function connectDatabase() {
  if (!env.mongo.enabled) {
    logger.info("Local mirror disabled (MONGODB_ENABLED=false) - serving from TallyPrime only");
    return false;
  }
  if (isConnected()) return true;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      if (env.mongo.uri && env.mongo.uri.startsWith("mongodb+srv://")) {
        try {
          dns.setServers(["8.8.8.8", "1.1.1.1"]);
        } catch (dnsErr) {
          // ignore
        }
      }
      await mongoose.connect(env.mongo.uri, {
        // Fail fast instead of buffering commands forever when mongod is down,
        // otherwise a missing database would stall API requests.
        serverSelectionTimeoutMS: env.mongo.serverSelectionTimeoutMs,
        bufferCommands: false
      });
      lastError = null;
      logger.info({ db: mongoose.connection.name }, "Local MongoDB mirror connected");
      return true;
    } catch (error) {
      lastError = error.message;
      logger.warn(
        { error: error.message, uri: redactUri(env.mongo.uri) },
        "Local MongoDB mirror unavailable - falling back to live TallyPrime reads"
      );
      return false;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) return;
  try {
    await mongoose.disconnect();
  } catch (error) {
    logger.warn({ error: error.message }, "Error while disconnecting local mirror");
  }
}

/** Never log credentials that may be embedded in a connection string. */
function redactUri(uri) {
  return String(uri || "").replace(/\/\/[^@]*@/, "//***:***@");
}

// A dropped connection must not crash the bridge; it just returns reads to Tally.
mongoose.connection.on("error", (error) => {
  lastError = error.message;
  logger.warn({ error: error.message }, "Local mirror connection error");
});
mongoose.connection.on("disconnected", () => {
  logger.warn("Local mirror disconnected - reads fall back to TallyPrime");
});

module.exports = {
  connectDatabase,
  disconnectDatabase,
  isConnected,
  getLastError,
  redactUri,
  mongoose
};
