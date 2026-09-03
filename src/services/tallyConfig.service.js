const { SystemSettings } = require("../models");
const env = require("../config/env");
const { logger } = require("../utils/logger");

let activeConfig = {
  tallyHost: env.tally.host || "127.0.0.1",
  tallyPort: Number(env.tally.port) || 9000,
  protocol: "http",
  connectionMode: "DIRECT",
  targetCompany: env.tally.companyName || "",
  timeoutMs: Number(env.tally.timeoutMs) || 120000,
  probeTimeoutMs: Number(env.tally.probeTimeoutMs) || 8000,
  autoSyncEnabled: env.sync.enabled !== false,
  syncIntervalMs: Number(env.sync.intervalMs) || 300000,
  lastKnownStatus: "UNKNOWN",
  lastConnectedAt: null,
  lastResponseTimeMs: null,
  activeCompanies: []
};

let initialized = false;

/**
 * Initialize dynamic configuration from MongoDB on application startup.
 */
async function initTallyConfig() {
  try {
    const doc = await SystemSettings.findOne({ key: "TALLY_CONFIG" }).lean();
    if (doc) {
      activeConfig = {
        ...activeConfig,
        tallyHost: doc.tallyHost || activeConfig.tallyHost,
        tallyPort: Number(doc.tallyPort) || activeConfig.tallyPort,
        protocol: doc.protocol || activeConfig.protocol,
        connectionMode: doc.connectionMode || activeConfig.connectionMode,
        targetCompany: doc.targetCompany || "",
        timeoutMs: Number(doc.timeoutMs) || activeConfig.timeoutMs,
        probeTimeoutMs: Number(doc.probeTimeoutMs) || activeConfig.probeTimeoutMs,
        autoSyncEnabled: doc.autoSyncEnabled !== undefined ? doc.autoSyncEnabled : activeConfig.autoSyncEnabled,
        syncIntervalMs: Number(doc.syncIntervalMs) || activeConfig.syncIntervalMs,
        lastKnownStatus: doc.lastKnownStatus || "UNKNOWN",
        lastConnectedAt: doc.lastConnectedAt || null,
        lastResponseTimeMs: doc.lastResponseTimeMs || null,
        activeCompanies: doc.activeCompanies || []
      };
      logger.info(
        { host: activeConfig.tallyHost, port: activeConfig.tallyPort, company: activeConfig.targetCompany },
        "Loaded dynamic Tally configuration from MongoDB"
      );
    } else {
      // Seed initial record from environment variables
      await SystemSettings.create({
        key: "TALLY_CONFIG",
        tallyHost: activeConfig.tallyHost,
        tallyPort: activeConfig.tallyPort,
        protocol: activeConfig.protocol,
        connectionMode: activeConfig.connectionMode,
        targetCompany: activeConfig.targetCompany,
        timeoutMs: activeConfig.timeoutMs,
        probeTimeoutMs: activeConfig.probeTimeoutMs,
        autoSyncEnabled: activeConfig.autoSyncEnabled,
        syncIntervalMs: activeConfig.syncIntervalMs
      });
      logger.info("Initialized default Tally configuration in MongoDB");
    }
    initialized = true;
  } catch (err) {
    logger.warn({ error: err.message }, "Could not load Tally configuration from MongoDB; using .env defaults");
  }
}

/**
 * Get active Tally configuration snapshot.
 */
function getActiveConfig() {
  return { ...activeConfig };
}

/**
 * Save updated Tally configuration to MongoDB and hot-reload in memory.
 */
async function updateTallyConfig(updates = {}) {
  const patch = {};

  if (updates.tallyHost !== undefined && typeof updates.tallyHost === "string" && updates.tallyHost.trim()) {
    patch.tallyHost = updates.tallyHost.trim();
  }
  if (updates.tallyPort !== undefined) {
    const port = Number(updates.tallyPort);
    if (!isNaN(port) && port >= 1 && port <= 65535) {
      patch.tallyPort = port;
    }
  }
  if (updates.protocol === "http" || updates.protocol === "https") {
    patch.protocol = updates.protocol;
  }
  if (updates.connectionMode === "DIRECT" || updates.connectionMode === "AGENT") {
    patch.connectionMode = updates.connectionMode;
  }
  if (updates.targetCompany !== undefined) {
    patch.targetCompany = typeof updates.targetCompany === "string" ? updates.targetCompany.trim() : "";
  }
  if (updates.timeoutMs !== undefined) {
    const ms = Number(updates.timeoutMs);
    if (!isNaN(ms) && ms >= 1000) patch.timeoutMs = ms;
  }
  if (updates.probeTimeoutMs !== undefined) {
    const ms = Number(updates.probeTimeoutMs);
    if (!isNaN(ms) && ms >= 1000) patch.probeTimeoutMs = ms;
  }
  if (updates.autoSyncEnabled !== undefined) {
    patch.autoSyncEnabled = Boolean(updates.autoSyncEnabled);
  }
  if (updates.syncIntervalMs !== undefined) {
    const ms = Number(updates.syncIntervalMs);
    if (!isNaN(ms) && ms >= 10000) patch.syncIntervalMs = ms;
  }

  // Update in MongoDB
  const updatedDoc = await SystemSettings.findOneAndUpdate(
    { key: "TALLY_CONFIG" },
    { $set: patch },
    { upsert: true, new: true, runValidators: true }
  ).lean();

  // Update in-memory cache
  activeConfig = {
    ...activeConfig,
    ...patch
  };

  logger.info(
    { host: activeConfig.tallyHost, port: activeConfig.tallyPort, targetCompany: activeConfig.targetCompany },
    "Dynamic Tally configuration updated and hot-reloaded"
  );

  return getActiveConfig();
}

/**
 * Record test connection or heartbeat result in database and memory
 */
async function recordConnectionStatus({ status, responseTimeMs, activeCompanies = [] }) {
  activeConfig.lastKnownStatus = status;
  activeConfig.lastResponseTimeMs = responseTimeMs;
  if (status === "ONLINE") {
    activeConfig.lastConnectedAt = new Date();
    activeConfig.activeCompanies = activeCompanies;
  }

  try {
    await SystemSettings.updateOne(
      { key: "TALLY_CONFIG" },
      {
        $set: {
          lastKnownStatus: status,
          lastResponseTimeMs: responseTimeMs,
          ...(status === "ONLINE" ? { lastConnectedAt: activeConfig.lastConnectedAt, activeCompanies } : {})
        }
      }
    );
  } catch (err) {
    logger.warn({ error: err.message }, "Failed to record connection status to MongoDB");
  }
}

/**
 * Test Tally connectivity using candidate parameters without persisting them yet.
 */
async function testCandidateConnection(params = {}) {
  const host = params.host || activeConfig.tallyHost;
  const port = Number(params.port) || activeConfig.tallyPort;
  const companyName = params.companyName !== undefined ? params.companyName : activeConfig.targetCompany;

  // We import dynamically to avoid circular dependencies
  const { probeTally } = require("../integrations/tally/tally.health");

  try {
    const probe = await probeTally({
      host,
      port,
      companyName,
      timeoutMs: 6000,
      force: true
    });

    const isSuccess = probe.success === true;
    const companyNames = probe.companyNames || (probe.companies ? probe.companies.map((c) => c.name) : []);

    await recordConnectionStatus({
      status: isSuccess ? "ONLINE" : "OFFLINE",
      responseTimeMs: probe.responseTimeMs,
      activeCompanies: companyNames
    });

    return {
      success: isSuccess,
      host,
      port,
      statusCode: probe.statusCode,
      responseTimeMs: probe.responseTimeMs,
      companyCount: companyNames.length,
      companies: companyNames,
      error: probe.error || probe.errorMessage || null,
      diagnosticHint: probe.diagnosticHint || null,
      userAction: probe.userAction || null
    };
  } catch (err) {
    await recordConnectionStatus({
      status: "OFFLINE",
      responseTimeMs: 0,
      activeCompanies: []
    });

    return {
      success: false,
      host,
      port,
      statusCode: null,
      responseTimeMs: 0,
      companyCount: 0,
      companies: [],
      error: err.message,
      diagnosticHint: "Could not connect to Tally server. Ensure Tally is running with ODBC/HTTP enabled on this port."
    };
  }
}

module.exports = {
  initTallyConfig,
  getActiveConfig,
  updateTallyConfig,
  recordConnectionStatus,
  testCandidateConnection
};
