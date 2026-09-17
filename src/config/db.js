const path = require("path");
const fs = require("fs");
const { Sequelize } = require("sequelize");
const env = require("./env");
const { logger } = require("../utils/logger");

/**
 * Local SQL database mirror connection.
 *
 * TallyPrime stays the source of truth. The mirror is an accelerator and an
 * offline cache, never a dependency: if the database is missing, stopped or
 * misconfigured, the bridge must keep answering exactly as it does today by
 * falling back to live extraction. Every failure here is logged and
 * swallowed rather than allowed to kill the process.
 */

let connected = false;
let connecting = null;
let lastError = null;

function redactUri(uri) {
  return String(uri || "").replace(/\/\/[^@]*@/, "//***:***@");
}

function initSequelize() {
  const dbUrl = env.db.url || "sqlite:./data/cfo_yantra.sqlite";
  let dialect = env.db.dialect;

  if (!dialect) {
    if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
      dialect = "postgres";
    } else if (dbUrl.startsWith("mysql://")) {
      dialect = "mysql";
    } else {
      dialect = "sqlite";
    }
  }

  const logging = env.db.logging ? (msg) => logger.debug({ msg }, "SQL") : false;

  if (dialect === "sqlite") {
    let storage = dbUrl.replace(/^sqlite:/, "").trim();
    if (!storage) storage = "./data/cfo_yantra.sqlite";
    if (storage !== ":memory:") {
      storage = path.resolve(process.cwd(), storage);
      const dir = path.dirname(storage);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    return new Sequelize({
      dialect: "sqlite",
      storage,
      logging
    });
  }

  return new Sequelize(dbUrl, {
    dialect,
    logging,
    pool: {
      max: 10,
      min: 0,
      acquire: env.db.connectTimeoutMs || 10000,
      idle: 10000
    },
    dialectOptions:
      dialect === "postgres"
        ? {
            connectTimeout: env.db.connectTimeoutMs || 10000
          }
        : undefined
  });
}

const sequelize = initSequelize();

function isConnected() {
  return connected;
}

function getLastError() {
  return lastError;
}

async function connectDatabase() {
  if (!env.db.enabled) {
    logger.info("Local SQL mirror disabled (DB_ENABLED=false) - serving from TallyPrime only");
    return false;
  }
  if (connected) return true;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      await sequelize.authenticate();
      // Synchronize database schema (creates tables if not exist)
      await sequelize.sync();
      connected = true;
      lastError = null;
      logger.info(
        { dialect: sequelize.getDialect(), database: sequelize.config.database || sequelize.config.storage },
        "Local SQL mirror connected"
      );
      return true;
    } catch (error) {
      connected = false;
      lastError = error.message;
      logger.warn(
        { error: error.message, url: redactUri(env.db.url) },
        "Local SQL mirror unavailable - falling back to live TallyPrime reads"
      );
      return false;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

async function disconnectDatabase() {
  try {
    await sequelize.close();
    connected = false;
  } catch (error) {
    logger.warn({ error: error.message }, "Error while disconnecting local mirror");
  }
}

module.exports = {
  sequelize,
  Sequelize,
  connectDatabase,
  disconnectDatabase,
  isConnected,
  getLastError,
  redactUri
};
