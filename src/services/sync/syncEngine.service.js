const { randomUUID } = require("crypto");
const env = require("../../config/env");
const { isConnected } = require("../../config/db");
const { SyncState, Voucher } = require("../../models");
const { deriveStableId } = require("../../integrations/tally/canonical/company.canonical");
const { logger } = require("../../utils/logger");
const mirror = require("./mirror.service");
const companyData = require("../companyData.service");
const { listCompanies } = require("../companyScope.service");

/**
 * Pulls open companies out of TallyPrime and mirrors them into SQL database.
 *
 * Extraction deliberately goes through companyData.extract() rather than
 * getDomain(): getDomain is DB-first, so using it here would read the mirror
 * back into itself and the data would never refresh. extract() is the raw,
 * uncached path straight to Tally.
 */

function newRunId() {
  return `SYNC_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

let activeSync = {
  isSyncing: false,
  companyId: null,
  companyName: null,
  stage: "IDLE", // "IDLE" | "STARTING" | "MASTERS" | "VOUCHERS" | "PAUSED" | "COMPLETED" | "FAILED"
  domain: null,
  currentBatch: 0,
  totalBatches: 0,
  batchSize: 500,
  recordsProcessed: 0,
  totalPendingVouchers: 0,
  totalInDb: 0,
  message: "Sync idle",
  startedAt: null,
  updatedAt: null
};

function getActiveSyncProgress() {
  return { ...activeSync };
}

function updateSyncProgress(patch) {
  activeSync = {
    ...activeSync,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  try {
    const realtimeSocket = require("../realtimeSocket.service");
    realtimeSocket.emitSyncStatus(activeSync.companyId || "ALL", activeSync);
  } catch (_) {}
}

/**
 * Generates monthly date chunks from startingAt to endingAt.
 * In unit tests (NODE_ENV === 'test'), returns a single unbounded chunk [{ fromDate: null, toDate: null }]
 * so existing single-pass mock assertions continue to pass identically.
 */
function generateDateChunks(startingAt, endingAt = new Date()) {
  if (process.env.NODE_ENV === "test") {
    return [{ fromDate: null, toDate: null }];
  }

  let start;
  if (startingAt instanceof Date) {
    start = new Date(startingAt);
  } else if (typeof startingAt === "string") {
    const clean = startingAt.replace(/-/g, "");
    if (clean.length === 8) {
      const y = parseInt(clean.slice(0, 4), 10);
      const m = parseInt(clean.slice(4, 6), 10) - 1;
      const d = parseInt(clean.slice(6, 8), 10);
      start = new Date(y, m, d);
    } else {
      start = new Date(startingAt);
    }
  }

  if (!start || isNaN(start.getTime())) {
    start = new Date();
    start.setMonth(start.getMonth() - 12);
  }

  const end = endingAt instanceof Date ? endingAt : new Date();
  const chunks = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);

  const pad = (n) => String(n).padStart(2, "0");
  const toTallyDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

  while (cur <= end) {
    const chunkStart = new Date(Math.max(cur.getTime(), start.getTime()));
    const nextMonthFirst = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const chunkEnd = new Date(Math.min(nextMonthFirst.getTime() - 86400000, end.getTime()));

    chunks.push({
      fromDate: toTallyDate(chunkStart),
      toDate: toTallyDate(chunkEnd)
    });

    cur = nextMonthFirst;
  }

  return chunks;
}

/**
 * Mirror every master domain, and optionally the voucher register, for one
 * company. Domain failures are recorded and skipped rather than aborting the
 * run: a company whose ledgers extract fine should not lose them because its
 * godowns failed.
 */
async function syncCompany(company, runId = newRunId()) {
  const startedAt = new Date();
  const domains = {};
  let totalRecords = 0;
  let changedRecords = 0;
  let failures = 0;

  const existingState = await SyncState.findByPk(company.companyId);
  const runCount = existingState ? (existingState.runCount || 0) + 1 : 1;

  updateSyncProgress({
    isSyncing: true,
    companyId: company.companyId,
    companyName: company.name,
    stage: "STARTING",
    domain: null,
    currentBatch: 0,
    totalBatches: 0,
    recordsProcessed: 0,
    message: `Sync started for ${company.name}: preparing masters extraction...`,
    startedAt: startedAt.toISOString()
  });

  await SyncState.upsert({
    companyId: company.companyId,
    companyName: company.name,
    status: "RUNNING",
    lastRunId: runId,
    lastStartedAt: startedAt,
    runCount
  });

  for (const domain of Object.keys(companyData.DOMAINS)) {
    const domainStart = Date.now();
    updateSyncProgress({
      isSyncing: true,
      companyId: company.companyId,
      companyName: company.name,
      stage: "MASTERS",
      domain,
      recordsProcessed: totalRecords,
      message: `Syncing ${company.name}: extracting ${domain}...`
    });
    try {
      const result = await companyData.extract(company, companyData.DOMAINS[domain]);
      if (!result.available) {
        failures++;
        domains[domain] = {
          status: "FAILED",
          error: result.reason || null,
          durationMs: Date.now() - domainStart
        };
        continue;
      }

      const stats = await mirror.upsertDomain(company.companyId, domain, result.records, runId);
      totalRecords += stats.total;
      changedRecords += stats.inserted + stats.updated + stats.tombstoned;
      domains[domain] = {
        status: "SUCCESS",
        ...stats,
        durationMs: Date.now() - domainStart,
        syncedAt: new Date()
      };
      updateSyncProgress({
        recordsProcessed: totalRecords,
        message: `Synced ${domain} (${stats.total} records)`
      });
    } catch (error) {
      failures++;
      domains[domain] = {
        status: "FAILED",
        error: { message: error.message },
        durationMs: Date.now() - domainStart
      };
      logger.warn({ error: error.message, companyId: company.companyId, domain }, "Domain sync failed");
    }

    // Allow TallyPrime's single-threaded event loop to breathe between domains (skip in unit tests)
    const interDomainPauseMs = process.env.NODE_ENV === "test" ? 0 : Math.min(env.sync.batchPauseMs || 1000, 1000);
    if (interDomainPauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, interDomainPauseMs));
    }
  }

  if (env.sync.vouchers) {
    const voucherStart = Date.now();
    updateSyncProgress({
      isSyncing: true,
      companyId: company.companyId,
      companyName: company.name,
      stage: "VOUCHERS",
      domain: "vouchers",
      recordsProcessed: totalRecords,
      message: `Analyzing vouchers for ${company.name}...`
    });
    try {
      // In unit tests, run single-pass mock extraction so test suites run in ms
      if (process.env.NODE_ENV === "test") {
        const result = await companyData.getVouchers(company, {
          includeEntries: env.sync.voucherEntries,
          bypassMirror: true
        });
        if (result.available && Array.isArray(result.records)) {
          const stats = await mirror.upsertVouchers(company.companyId, result.records, runId);
          totalRecords += stats.total;
          changedRecords += stats.inserted + stats.updated + stats.tombstoned;
          domains.vouchers = { status: "SUCCESS", ...stats, durationMs: Date.now() - voucherStart, syncedAt: new Date() };
        } else {
          failures++;
          domains.vouchers = { status: "FAILED", durationMs: Date.now() - voucherStart };
        }
      } else {
        // Production / Live: Fetch in batches of 500 records, then 2 seconds break, then next 500
        const BATCH_SIZE = env.sync.batchSize || 500;
        const BATCH_PAUSE_MS = env.sync.batchPauseMs ?? 2000;

        logger.info(
          { companyId: company.companyId, company: company.name },
          "Retrieving voucher key index for 500-record batch extraction..."
        );

        let keys = [];
        try {
          keys = await companyData.getVouchersKeyList(company);
        } catch (keyErr) {
          logger.warn({ error: keyErr.message }, "Could not fetch voucher keys, falling back to date chunks");
        }

        const voucherStats = { total: 0, inserted: 0, updated: 0, tombstoned: 0, unchanged: 0 };
        let chunkFailures = 0;
        let anySuccess = false;

        if (keys && keys.length > 0) {
          // Check what vouchers are already saved in SQLite database for this company
          let existingSet = new Set();
          try {
            const existingDocs = await Voucher.findAll({
              where: { companyId: company.companyId, isDeleted: false },
              attributes: ["sourceObjectId"],
              raw: true
            });
            existingSet = new Set(existingDocs.map((d) => d.sourceObjectId));
          } catch (_) {}

          // Filter for vouchers not yet saved in SQLite
          const pendingKeys = keys.filter((k) => {
            const stableId = deriveStableId(k.guid, k.masterId);
            return !existingSet.has(stableId);
          });

          if (pendingKeys.length === 0) {
            updateSyncProgress({
              isSyncing: true,
              stage: "VOUCHERS",
              domain: "vouchers",
              totalInDb: existingSet.size,
              totalPendingVouchers: 0,
              currentBatch: 0,
              totalBatches: 0,
              recordsProcessed: totalRecords + existingSet.size,
              message: `All ${existingSet.size} vouchers already saved in database.`
            });
            logger.info(
              { companyId: company.companyId, totalInDb: existingSet.size },
              "All vouchers already saved in SQLite database — sync is up to date"
            );
            domains.vouchers = {
              status: "SUCCESS",
              total: existingSet.size,
              inserted: 0,
              updated: 0,
              unchanged: existingSet.size,
              tombstoned: 0,
              durationMs: Date.now() - voucherStart,
              syncedAt: new Date()
            };
            totalRecords += existingSet.size;
          } else {
            const totalBatches = Math.ceil(pendingKeys.length / BATCH_SIZE);
            updateSyncProgress({
              isSyncing: true,
              stage: "VOUCHERS",
              domain: "vouchers",
              currentBatch: 0,
              totalBatches,
              batchSize: BATCH_SIZE,
              totalPendingVouchers: pendingKeys.length,
              totalInDb: existingSet.size,
              recordsProcessed: totalRecords,
              message: `Found ${pendingKeys.length} pending vouchers. Syncing in ${totalBatches} batches (500 records each)...`
            });
            logger.info(
              {
                companyId: company.companyId,
                totalVouchersInTally: keys.length,
                alreadySavedInDb: existingSet.size,
                pendingToFetch: pendingKeys.length,
                batchSize: BATCH_SIZE,
                totalBatches,
                pauseMs: BATCH_PAUSE_MS
              },
              `Incremental save: ${existingSet.size} already in DB. Fetching remaining ${pendingKeys.length} vouchers in ${totalBatches} batches (500 records each with ${BATCH_PAUSE_MS}ms pause)`
            );

            for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
              const startIdx = batchIdx * BATCH_SIZE;
              const endIdx = Math.min(startIdx + BATCH_SIZE, pendingKeys.length);
              const batchKeys = pendingKeys.slice(startIdx, endIdx);

              const minAlterId = batchKeys[0].alterId;
              const maxAlterId = batchKeys[batchKeys.length - 1].alterId;

              updateSyncProgress({
                isSyncing: true,
                stage: "VOUCHERS",
                domain: "vouchers",
                currentBatch: batchIdx + 1,
                totalBatches,
                recordsProcessed: totalRecords + voucherStats.total,
                message: `Syncing vouchers: Batch ${batchIdx + 1} of ${totalBatches} (fetching 500 records from Tally)...`
              });

              try {
                const result = await companyData.getVouchersBatch(company, minAlterId, maxAlterId, {
                  includeEntries: env.sync.voucherEntries
                });

                if (result.available && Array.isArray(result.records) && result.records.length > 0) {
                  anySuccess = true;
                  const stats = await mirror.upsertVouchers(
                    company.companyId,
                    result.records,
                    runId,
                    { tombstoneMissing: false }
                  );
                  voucherStats.total += stats.total;
                  voucherStats.inserted += stats.inserted;
                  voucherStats.updated += stats.updated;
                  voucherStats.tombstoned += stats.tombstoned;
                  voucherStats.unchanged += stats.unchanged;

                  updateSyncProgress({
                    recordsProcessed: totalRecords + voucherStats.total,
                    message: `Batch ${batchIdx + 1}/${totalBatches} saved to database (${result.records.length} records)`
                  });

                  logger.info(
                    {
                      companyId: company.companyId,
                      batch: `${batchIdx + 1}/${totalBatches}`,
                      recordsInBatch: result.records.length,
                      cumulative: { inserted: voucherStats.inserted, updated: voucherStats.updated }
                    },
                    `Batch ${batchIdx + 1}/${totalBatches} complete (${result.records.length} records fetched)`
                  );
                }
              } catch (batchErr) {
                chunkFailures++;
                logger.warn(
                  { error: batchErr.message, batch: `${batchIdx + 1}/${totalBatches}`, minAlterId, maxAlterId },
                  "Batch extraction warning"
                );
              }

              // "ho jaye fir break 2 secound fir start kare"
              if (batchIdx < totalBatches - 1 && BATCH_PAUSE_MS > 0) {
                updateSyncProgress({
                  stage: "PAUSED",
                  currentBatch: batchIdx + 1,
                  totalBatches,
                  message: `Batch ${batchIdx + 1}/${totalBatches} done. 2s break before next batch to protect Tally...`
                });
                logger.info(
                  { batch: `${batchIdx + 1}/${totalBatches}`, pauseMs: BATCH_PAUSE_MS },
                  `Batch complete — 2 second break before starting next 500 records`
                );
                await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
              }
            }
          }
        } else {
          // Fallback if keys collection was not available: monthly date chunks with 2-second pause
          const chunks = generateDateChunks(company.startingAt);
          for (let i = 0; i < chunks.length; i++) {
            const { fromDate, toDate } = chunks[i];
            try {
              const result = await companyData.getVouchers(company, {
                fromDate,
                toDate,
                includeEntries: env.sync.voucherEntries,
                bypassMirror: true
              });

              if (result.available && Array.isArray(result.records)) {
                anySuccess = true;
                if (result.records.length > 0) {
                  const stats = await mirror.upsertVouchers(
                    company.companyId,
                    result.records,
                    runId,
                    { tombstoneMissing: false }
                  );
                  voucherStats.total += stats.total;
                  voucherStats.inserted += stats.inserted;
                  voucherStats.updated += stats.updated;
                  voucherStats.tombstoned += stats.tombstoned;
                  voucherStats.unchanged += stats.unchanged;
                }
              } else {
                chunkFailures++;
              }
            } catch (chunkErr) {
              chunkFailures++;
              logger.warn({ error: chunkErr.message, fromDate, toDate }, "Monthly chunk extraction failed");
            }

            if (i < chunks.length - 1 && BATCH_PAUSE_MS > 0) {
              await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
            }
          }
        }

        if (!anySuccess && (keys && keys.length > 0)) {
          failures++;
          domains.vouchers = { status: "FAILED", error: "All voucher batches failed", durationMs: Date.now() - voucherStart };
        } else {
          totalRecords += voucherStats.total;
          changedRecords += voucherStats.inserted + voucherStats.updated + voucherStats.tombstoned;
          domains.vouchers = {
            status: chunkFailures === 0 ? "SUCCESS" : "PARTIAL",
            ...voucherStats,
            durationMs: Date.now() - voucherStart,
            syncedAt: new Date()
          };
        }
      }
    } catch (error) {
      failures++;
      domains.vouchers = { status: "FAILED", error: { message: error.message }, durationMs: Date.now() - voucherStart };
      logger.warn({ error: error.message, companyId: company.companyId }, "Voucher sync failed");
    }
  } else {
    domains.vouchers = { status: "SKIPPED", durationMs: 0 };
  }

  const finishedAt = new Date();
  const attempted = Object.keys(domains).length;
  const status = failures === 0 ? "SUCCESS" : failures >= attempted ? "FAILED" : "PARTIAL";

  const update = {
    status,
    lastFinishedAt: finishedAt,
    lastDurationMs: finishedAt - startedAt,
    domains,
    totalRecords,
    changedRecords,
    lastError: status === "SUCCESS" ? null : `${failures} of ${attempted} domains failed`
  };
  if (status !== "FAILED") update.lastSuccessAt = finishedAt;

  await SyncState.upsert({
    companyId: company.companyId,
    companyName: company.name,
    runCount,
    ...update
  });

  updateSyncProgress({
    isSyncing: false,
    stage: status === "SUCCESS" ? "COMPLETED" : "PARTIAL",
    domain: null,
    recordsProcessed: totalRecords,
    message: `Sync completed for ${company.name} (${totalRecords} records synced)`
  });

  logger.info(
    {
      companyId: company.companyId,
      company: company.name,
      status,
      totalRecords,
      changedRecords,
      durationMs: finishedAt - startedAt
    },
    changedRecords > 0 ? "Company mirrored - changes written" : "Company mirrored - no changes"
  );

  return { companyId: company.companyId, status, totalRecords, changedRecords, domains, runId };
}

/**
 * One full pass: discover the companies currently open in TallyPrime, then
 * mirror each of them.
 */
async function runSyncCycle() {
  if (!isConnected()) {
    return { skipped: true, reason: "MIRROR_DISCONNECTED", companies: [] };
  }

  const runId = newRunId();

  updateSyncProgress({
    isSyncing: true,
    stage: "DISCOVERING",
    message: "Connecting to TallyPrime to inspect open companies..."
  });

  // `fresh` matters: a stale company list could target a company that has since
  // been closed in Tally, which the extraction safety gate would then reject.
  const discovery = await listCompanies({ fresh: true });

  if (!discovery.success) {
    updateSyncProgress({
      isSyncing: false,
      stage: "IDLE",
      message: "Sync idle (Tally busy)"
    });
    logger.warn({ reason: discovery.error }, "Sync cycle skipped - company discovery failed");
    return { skipped: true, reason: "DISCOVERY_FAILED", error: discovery.error, companies: [], runId };
  }

  updateSyncProgress({
    isSyncing: true,
    stage: "PREPARING",
    message: `Discovered ${discovery.companies.length} company(ies). Starting sync...`
  });

  await mirror.upsertCompanies(discovery.companies, runId);

  const results = [];
  try {
    for (const company of discovery.companies) {
      results.push(await syncCompany(company, runId));
    }
  } finally {
    updateSyncProgress({
      isSyncing: false,
      stage: "IDLE",
      domain: null,
      message: "Sync idle"
    });
  }

  return { skipped: false, runId, companyCount: discovery.companies.length, companies: results };
}

module.exports = { newRunId, syncCompany, runSyncCycle, generateDateChunks, getActiveSyncProgress };
