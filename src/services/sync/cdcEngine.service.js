const { isConnected } = require("../../config/db");
const { Voucher, Company } = require("../../models");
const { sendXml } = require("../../integrations/tally/tally.client");
const { buildIncrementalSyncRequest } = require("../../integrations/tally/tally.requests");
const { parseTallyResponse, normalizeArray } = require("../../integrations/tally/tally.parser");
const { normalizeCanonicalVoucher } = require("../../integrations/tally/canonical/voucher.canonical");
const { detectAndReconcileDeletions } = require("./deletionDetector.service");
const mirror = require("./mirror.service");
const realtimeSocket = require("../realtimeSocket.service");
const { logger } = require("../../utils/logger");

const CDC_INTERVAL_MS = 2500; // Fast sub-second / 2.5s cadence

let cdcTimer = null;
let isCycleRunning = false;
let isEngineActive = false;

// Per-company cursors: companyId -> { lastVoucherAlterId, companyName, lastTickAt }
const companyCursors = new Map();

/**
 * Initialize or restore cursor for a company from MongoDB
 */
async function getOrInitCursor(companyId, companyName) {
  if (companyCursors.has(companyId)) {
    const cursor = companyCursors.get(companyId);
    if (companyName) cursor.companyName = companyName;
    return cursor;
  }

  // Find the highest AlterID recorded in the MongoDB mirror
  let highestAlterId = 0;
  try {
    const latestDoc = await Voucher.findOne({
      companyId,
      "header.alterId": { $exists: true, $ne: null }
    })
      .sort({ "header.alterId": -1 })
      .select({ "header.alterId": 1 })
      .lean();

    if (latestDoc && latestDoc.header && latestDoc.header.alterId) {
      highestAlterId = Number(latestDoc.header.alterId) || 0;
    }
  } catch (err) {
    logger.warn({ error: err.message, companyId }, "Could not read max AlterID from MongoDB");
  }

  const cursor = {
    companyId,
    companyName,
    lastVoucherAlterId: highestAlterId,
    lastTickAt: null,
    totalInserts: 0,
    totalUpdates: 0,
    totalDeletes: 0
  };

  companyCursors.set(companyId, cursor);
  logger.info({ companyId, companyName, initialAlterId: highestAlterId }, "CDC cursor initialized");
  return cursor;
}

/**
 * Single CDC tick for a specific company
 */
async function runCdcForCompany(companyId, companyName) {
  const cursor = await getOrInitCursor(companyId, companyName);
  const currentAlterId = cursor.lastVoucherAlterId;

  // 1. Fetch inserted or updated vouchers with AlterId > currentAlterId
  const reqXml = buildIncrementalSyncRequest(companyName, currentAlterId, {
    includeLedgerEntries: true,
    includeInventoryEntries: true
  });

  const tallyRes = await sendXml(reqXml);
  const parsed = parseTallyResponse(tallyRes.body);
  const rawVouchers = normalizeArray(parsed.collection);

  let newMaxAlterId = currentAlterId;

  if (rawVouchers.length > 0) {
    logger.info(
      { companyId, count: rawVouchers.length, afterAlterId: currentAlterId },
      "CDC: detected new/altered vouchers from Tally"
    );

    const canonicals = [];
    for (const raw of rawVouchers) {
      const canonical = normalizeCanonicalVoucher(raw, {
        sourceCompanyId: companyId,
        extractionRunId: `CDC_${Date.now()}`
      });
      if (canonical && canonical.sourceObjectId) {
        canonicals.push(canonical);
        const vAlterId = canonical.header?.alterId ? Number(canonical.header.alterId) : 0;
        if (vAlterId > newMaxAlterId) {
          newMaxAlterId = vAlterId;
        }
      }
    }

    if (canonicals.length > 0) {
      // Classify each as INSERT or UPDATE by querying existing mirror state
      const sourceIds = canonicals.map((c) => c.sourceObjectId);
      const existingDocs = await Voucher.find(
        { companyId, sourceObjectId: { $in: sourceIds } },
        { sourceObjectId: 1 }
      ).lean();
      const existingSet = new Set(existingDocs.map((d) => d.sourceObjectId));

      // Upsert into MongoDB mirror
      await mirror.upsertVouchers(companyId, canonicals, `CDC_${Date.now()}`);

      // Broadcast real-time events to frontend
      for (const canonical of canonicals) {
        const isUpdate = existingSet.has(canonical.sourceObjectId);
        if (isUpdate) {
          cursor.totalUpdates++;
          realtimeSocket.emitVoucherUpdated(companyId, canonical);
        } else {
          cursor.totalInserts++;
          realtimeSocket.emitVoucherInserted(companyId, canonical);
        }
      }
    }

    cursor.lastVoucherAlterId = newMaxAlterId;
  }

  // 2. Perform fast deletion detection
  const delResult = await detectAndReconcileDeletions(companyId, companyName);
  if (delResult.deletedCount > 0) {
    cursor.totalDeletes += delResult.deletedCount;
  }

  cursor.lastTickAt = new Date();

  // 3. Emit heartbeat status
  realtimeSocket.emitSyncStatus(companyId, {
    lastAlterId: cursor.lastVoucherAlterId,
    totalInserts: cursor.totalInserts,
    totalUpdates: cursor.totalUpdates,
    totalDeletes: cursor.totalDeletes,
    lastTickAt: cursor.lastTickAt
  });
}

/**
 * Main cycle tick - runs across all open/active companies
 */
async function cdcTick() {
  if (isCycleRunning || !isEngineActive) return;
  if (!isConnected()) return;

  isCycleRunning = true;
  try {
    // Find open companies
    const openCompanies = await Company.find({ isOpen: true }).lean();
    if (openCompanies.length === 0) {
      // Fallback: check all companies if none marked isOpen
      const anyCompanies = await Company.find().limit(3).lean();
      for (const comp of anyCompanies) {
        await runCdcForCompany(comp.companyId, comp.companyName || comp.name);
      }
    } else {
      for (const comp of openCompanies) {
        await runCdcForCompany(comp.companyId, comp.companyName || comp.name);
      }
    }
  } catch (error) {
    logger.debug({ error: error.message }, "CDC cycle tick warning (will retry on next interval)");
  } finally {
    isCycleRunning = false;
  }
}

/**
 * Start the CDC real-time engine
 */
function startCdcEngine() {
  if (cdcTimer) return true;
  isEngineActive = true;
  logger.info({ intervalMs: CDC_INTERVAL_MS }, "Starting Tally Real-Time CDC Engine");

  // Initial immediate tick after 1s
  setTimeout(() => {
    cdcTick();
    cdcTimer = setInterval(cdcTick, CDC_INTERVAL_MS);
    if (cdcTimer.unref) cdcTimer.unref();
  }, 1000);

  return true;
}

/**
 * Stop the CDC real-time engine
 */
function stopCdcEngine() {
  isEngineActive = false;
  if (cdcTimer) {
    clearInterval(cdcTimer);
    cdcTimer = null;
  }
  logger.info("Tally Real-Time CDC Engine stopped");
}

module.exports = {
  startCdcEngine,
  stopCdcEngine,
  runCdcForCompany,
  companyCursors
};
