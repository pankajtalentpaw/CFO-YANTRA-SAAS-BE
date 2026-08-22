const { isConnected, getLastError, redactUri } = require("../config/db");
const env = require("../config/env");
const { SyncState, Company } = require("../models");
const tallySyncJob = require("../jobs/tallySync.job");
const mirror = require("../services/sync/mirror.service");

/**
 * Live sync status: whether the mirror is connected, whether the loop is
 * running, and what the last pass did for each company.
 */
async function getSyncStatus(req, res) {
  const connected = isConnected();
  const job = tallySyncJob.getState();

  let companies = [];
  if (connected) {
    const states = await SyncState.find({}).lean();
    companies = states.map((s) => ({
      companyId: s.companyId,
      companyName: s.companyName,
      status: s.status,
      lastRunId: s.lastRunId,
      lastStartedAt: s.lastStartedAt,
      lastFinishedAt: s.lastFinishedAt,
      lastDurationMs: s.lastDurationMs,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
      totalRecords: s.totalRecords,
      changedRecords: s.changedRecords,
      runCount: s.runCount,
      domains: s.domains || {}
    }));
  }

  const lastSync = companies.reduce(
    (latest, c) => (c.lastFinishedAt && (!latest || c.lastFinishedAt > latest) ? c.lastFinishedAt : latest),
    null
  );

  return res.json({
    status: connected ? (job.running ? "SYNCING" : "READY") : "MIRROR_UNAVAILABLE",
    mirror: {
      enabled: env.mongo.enabled,
      connected,
      uri: redactUri(env.mongo.uri),
      lastError: getLastError()
    },
    autoSync: {
      enabled: job.configuredEnabled,
      running: job.running,
      intervalMs: job.intervalMs,
      startedAt: job.startedAt,
      lastTickAt: job.lastTickAt,
      tickCount: job.tickCount,
      skippedOverlaps: job.skippedOverlaps,
      lastError: job.lastError,
      syncVouchers: job.syncVouchers,
      syncVoucherEntries: job.syncVoucherEntries
    },
    lastSync,
    companyCount: companies.length,
    companies
  });
}

/** Force one sync pass immediately instead of waiting for the next tick. */
async function runSyncNow(req, res) {
  if (!isConnected()) {
    return res.status(503).json({
      success: false,
      error: "Local mirror is not connected",
      hint: "Start MongoDB and check MONGODB_URI in backend/.env"
    });
  }

  const outcome = await tallySyncJob.triggerNow();
  if (!outcome.triggered) {
    return res.status(409).json({ success: false, error: "A sync cycle is already running" });
  }
  return res.json({ success: true, result: outcome.result });
}

/** Companies as currently held in the mirror. */
async function getMirroredCompanies(req, res) {
  if (!isConnected()) {
    return res.status(503).json({ success: false, error: "Local mirror is not connected" });
  }
  const companies = await Company.find({}).lean();
  return res.json({
    success: true,
    count: companies.length,
    companies: companies.map(mirror.stripCompanyEnvelope)
  });
}

/** Per-domain record counts held in the mirror for one company. */
async function getMirrorCounts(req, res) {
  if (!isConnected()) {
    return res.status(503).json({ success: false, error: "Local mirror is not connected" });
  }
  const counts = await mirror.countsForCompany(req.params.companyId);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return res.json({ success: true, companyId: req.params.companyId, total, counts });
}

module.exports = {
  getSyncStatus,
  runSyncNow,
  getMirroredCompanies,
  getMirrorCounts
};
