const { isConnected } = require("../../config/db");
const { Voucher, Company } = require("../../models");
const { sendXml, checkHeartbeat } = require("../../integrations/tally/tally.client");
const { buildIncrementalSyncRequest } = require("../../integrations/tally/tally.requests");
const { parseTallyResponse, normalizeArray } = require("../../integrations/tally/tally.parser");
const { normalizeCanonicalVoucher } = require("../../integrations/tally/canonical/voucher.canonical");
const { detectAndReconcileDeletions } = require("./deletionDetector.service");
const { listCompanies } = require("../companyScope.service");
const mirror = require("./mirror.service");
const realtimeSocket = require("../realtimeSocket.service");
const { logger } = require("../../utils/logger");

const DEFAULT_CDC_INTERVAL_MS = 15000; // Safe 15s cadence to avoid overwhelming Tally's single-threaded server

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
  try {
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
  } catch (error) {
    logger.debug({ error: error.message, companyId }, "CDC tick for company had minor issue (will retry next cycle)");
  }
}

/**
 * Main cycle tick - runs across verified open/active companies
 */
async function cdcTick() {
  if (isCycleRunning || !isEngineActive) return;
  if (!isConnected()) return;

  // Pre-flight check: is Tally responding?
  try {
    const hb = await checkHeartbeat({ quick: true });
    if (!hb.alive) {
      logger.debug("CDC tick skipped - TallyPrime is currently offline");
      return;
    }
  } catch (_) {
    return;
  }

  isCycleRunning = true;
  try {
    // Only query companies that are confirmed currently open in Tally
    const discovery = await listCompanies();
    if (!discovery.success || !discovery.companies || discovery.companies.length === 0) {
      return;
    }

    for (const comp of discovery.companies) {
      await runCdcForCompany(comp.companyId, comp.name);
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
function startCdcEngine(customIntervalMs) {
  if (cdcTimer) return true;
  isEngineActive = true;
  const intervalMs = Number(customIntervalMs) || DEFAULT_CDC_INTERVAL_MS;
  logger.info({ intervalMs }, "Starting Tally Real-Time CDC Engine");

  // Initial delay of 10s before first tick to let startup stabilize
  setTimeout(() => {
    if (!isEngineActive) return;
    cdcTick();
    cdcTimer = setInterval(cdcTick, intervalMs);
    if (cdcTimer.unref) cdcTimer.unref();
  }, 10000);

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
