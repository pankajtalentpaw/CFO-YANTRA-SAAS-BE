const env = require("../../config/env");
const { isConnected } = require("../../config/db");
const { Voucher, Company, SyncState } = require("../../models");
const { sendXml, checkHeartbeat } = require("../../integrations/tally/tally.client");
const { buildIncrementalSyncRequest } = require("../../integrations/tally/tally.requests");
const { parseTallyResponse, normalizeArray, extractValue } = require("../../integrations/tally/tally.parser");
// The SAME normalizer the full sync uses. CDC used to write its own shape -
// everything nested under `header` - which no read path understands: the
// register, the dashboard and the analytics all expect top-level voucherDate,
// voucherType, amount and partyLedgerName. A company whose vouchers arrived
// only through CDC therefore mirrored fine and then read as completely empty.
const { normalizeSalesVoucher } = require("../../integrations/tally/sales/salesVoucher.canonical");
const { detectAndReconcileDeletions } = require("./deletionDetector.service");
const { listCompanies } = require("../companyScope.service");
const mirror = require("./mirror.service");
const realtimeSocket = require("../realtimeSocket.service");
const { logger } = require("../../utils/logger");

const DEFAULT_CDC_INTERVAL_MS = (env.sync && env.sync.cdcIntervalMs) || 30000; // Safe 30s cadence to avoid overwhelming Tally

/** Ticks between full deletion scans (~20 minutes at 30s cadence) */
const DELETION_SCAN_EVERY_N_TICKS = 40;

let cdcTimer = null;
let isCycleRunning = false;
let isEngineActive = false;
let tickCount = 0;

// Per-company cursors: companyId -> { lastVoucherAlterId, companyName, lastTickAt }
const companyCursors = new Map();

/**
 * Initialize or restore cursor for a company from database mirror
 */
async function getOrInitCursor(companyId, companyName) {
  if (companyCursors.has(companyId)) {
    const cursor = companyCursors.get(companyId);
    if (companyName) cursor.companyName = companyName;
    return cursor;
  }

  /*
   * Highest AlterID already mirrored, read from the canonical record itself.
   *
   * Deliberately only `data.alterId`, which exists solely on records written in
   * the canonical shape. Rows left behind by the old CDC carry their AlterID
   * under `header.alterId` instead, and honouring that would pin the cursor
   * above them forever - they would never be re-fetched and the register would
   * stay unreadable. Ignoring it starts this company from zero once, the
   * re-pull upserts the correct shape over the same GUID keys, and from then on
   * `data.alterId` is present and the cursor resumes normally.
   */
  let highestAlterId = 0;
  try {
    // 1. Check if SyncState has a saved CDC cursor
    const syncState = await SyncState.findByPk(companyId);
    if (syncState && syncState.domains && syncState.domains.cdc && syncState.domains.cdc.lastAlterId) {
      highestAlterId = Number(syncState.domains.cdc.lastAlterId) || 0;
    }

    // 2. If not in SyncState, check recent mirrored vouchers
    if (!highestAlterId) {
      const docs = await Voucher.findAll({
        where: { companyId },
        attributes: ["data"],
        order: [["id", "DESC"]],
        limit: 50,
        raw: true
      });
      for (const doc of docs) {
        const rawData = typeof doc.data === "string" ? JSON.parse(doc.data) : doc.data;
        const alterId = rawData && rawData.alterId;
        if (alterId) {
          const idNum = Number(alterId) || 0;
          if (idNum > highestAlterId) highestAlterId = idNum;
        }
      }
    }

    // 3. HARD SAFETY GATE: If highestAlterId is STILL 0, use Company baseline alterId!
    // Never let CDC query $AlterId > 0 against an existing company with thousands of vouchers!
    if (!highestAlterId) {
      const comp = await Company.findByPk(companyId);
      if (comp && comp.alterId) {
        highestAlterId = Number(comp.alterId) || 0;
      }
    }
  } catch (err) {
    logger.warn({ error: err.message, companyId }, "Could not read max AlterID from SQL mirror");
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
async function runCdcForCompany(companyId, companyName, { scanDeletions = true } = {}) {
  try {
    const cursor = await getOrInitCursor(companyId, companyName);
    const currentAlterId = cursor.lastVoucherAlterId;

    // 1. Fetch inserted or updated vouchers with AlterId > currentAlterId
    // Respect configured voucher entries flag so Tally does not crash on entries
    const reqXml = buildIncrementalSyncRequest(companyName, currentAlterId, {
      includeLedgerEntries: env.sync.voucherEntries,
      includeInventoryEntries: env.sync.voucherEntries
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

      const runId = `CDC_${Date.now()}`;
      const canonicals = [];
      for (const raw of rawVouchers) {
        const canonical = normalizeSalesVoucher(raw, {
          companyId,
          syncRunId: runId
        });
        if (canonical && canonical.sourceObjectId) {
          // AlterID drives the cursor but is not part of the canonical model,
          // so it is read off the raw node and carried on the record. Storing
          // it is what lets the cursor resume after a restart instead of
          // re-reading the whole register every time.
          const vAlterId = Number(extractValue(raw.ALTERID || raw.AlterId)) || 0;
          canonical.alterId = vAlterId || null;
          canonicals.push(canonical);
          if (vAlterId > newMaxAlterId) {
            newMaxAlterId = vAlterId;
          }
        }
      }

      if (canonicals.length > 0) {
        // Classify each as INSERT or UPDATE by querying existing mirror state
        const { Op } = require("sequelize");
        const sourceIds = canonicals.map((c) => c.sourceObjectId);
        const existingDocs = await Voucher.findAll({
          where: { companyId, sourceObjectId: { [Op.in]: sourceIds } },
          attributes: ["sourceObjectId"],
          raw: true
        });
        const existingSet = new Set(existingDocs.map((d) => d.sourceObjectId));

        // Upsert into SQL mirror. This batch is a DELTA - only the vouchers
        // whose AlterId moved - so the mirror must not read "absent here" as
        // "deleted in Tally". Deletions are the deletion detector's job, and it
        // compares against the full key list before striking anything off.
        await mirror.upsertVouchers(companyId, canonicals, runId, { tombstoneMissing: false });

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
      // Persist cursor to SyncState to maintain continuity across restarts
      try {
        const currentState = await SyncState.findByPk(companyId);
        const existingDomains = (currentState && currentState.domains) || {};
        await SyncState.upsert({
          companyId,
          companyName,
          domains: {
            ...existingDomains,
            cdc: {
              lastAlterId: newMaxAlterId,
              lastTickAt: new Date(),
              totalInserts: cursor.totalInserts,
              totalUpdates: cursor.totalUpdates
            }
          }
        });
      } catch (_) {}
    }

    // 2. Deletion detection, but not on every tick. It costs a second Tally
    // query plus a full scan of the company's active vouchers, and it runs
    // while holding the global Tally lock that user requests also queue on.
    // Vouchers are deleted rarely; paying that frequently starved the pages.
    if (scanDeletions) {
      const delResult = await detectAndReconcileDeletions(companyId, companyName);
      if (delResult.deletedCount > 0) {
        cursor.totalDeletes += delResult.deletedCount;
      }
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

  // Do not compete with full sync cycle: Tally is single-threaded
  try {
    const tallySyncJob = require("../../jobs/tallySync.job");
    if (tallySyncJob.getState().running) {
      logger.debug("CDC tick skipped - full sync cycle is currently running");
      return;
    }
  } catch (_) {}

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

    tickCount += 1;
    // Only scan deletions after baseline is established, avoiding initial startup spike
    const scanDeletions = tickCount > 1 && tickCount % DELETION_SCAN_EVERY_N_TICKS === 0;

    for (const comp of discovery.companies) {
      await runCdcForCompany(comp.companyId, comp.name, { scanDeletions });
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
  const intervalMs = Number(customIntervalMs) || (env.sync && env.sync.cdcIntervalMs) || DEFAULT_CDC_INTERVAL_MS;
  logger.info({ intervalMs }, "Starting Tally Real-Time CDC Engine");

  // Initial delay of 15s before first tick to let startup and initial full sync stabilize
  setTimeout(() => {
    if (!isEngineActive) return;
    cdcTick();
    cdcTimer = setInterval(cdcTick, intervalMs);
    if (cdcTimer.unref) cdcTimer.unref();
  }, 15000);

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
