const { randomUUID } = require("crypto");
const env = require("../../config/env");
const { isConnected } = require("../../config/db");
const { SyncState } = require("../../models");
const { logger } = require("../../utils/logger");
const mirror = require("./mirror.service");
const companyData = require("../companyData.service");
const { listCompanies } = require("../companyScope.service");

/**
 * Pulls open companies out of TallyPrime and mirrors them into MongoDB.
 *
 * Extraction deliberately goes through companyData.extract() rather than
 * getDomain(): getDomain is DB-first, so using it here would read the mirror
 * back into itself and the data would never refresh. extract() is the raw,
 * uncached path straight to Tally.
 */

function newRunId() {
  return `SYNC_${Date.now()}_${randomUUID().slice(0, 8)}`;
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

  await SyncState.updateOne(
    { companyId: company.companyId },
    {
      $set: {
        companyId: company.companyId,
        companyName: company.name,
        status: "RUNNING",
        lastRunId: runId,
        lastStartedAt: startedAt
      },
      $inc: { runCount: 1 }
    },
    { upsert: true }
  );

  for (const domain of Object.keys(companyData.DOMAINS)) {
    const domainStart = Date.now();
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
    } catch (error) {
      failures++;
      domains[domain] = {
        status: "FAILED",
        error: { message: error.message },
        durationMs: Date.now() - domainStart
      };
      logger.warn({ error: error.message, companyId: company.companyId, domain }, "Domain sync failed");
    }
  }

  if (env.sync.vouchers) {
    const voucherStart = Date.now();
    try {
      const result = await companyData.getVouchers(company, {
        includeEntries: env.sync.voucherEntries,
        // Never read the mirror while filling it.
        bypassMirror: true
      });
      if (!result.available) {
        failures++;
        domains.vouchers = { status: "FAILED", error: result.reason || null, durationMs: Date.now() - voucherStart };
      } else {
        const stats = await mirror.upsertVouchers(company.companyId, result.records, runId);
        totalRecords += stats.total;
        changedRecords += stats.inserted + stats.updated + stats.tombstoned;
        domains.vouchers = { status: "SUCCESS", ...stats, durationMs: Date.now() - voucherStart, syncedAt: new Date() };
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

  await SyncState.updateOne({ companyId: company.companyId }, { $set: update }, { upsert: true });

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
  // `fresh` matters: a stale company list could target a company that has since
  // been closed in Tally, which the extraction safety gate would then reject.
  const discovery = await listCompanies({ fresh: true });

  if (!discovery.success) {
    logger.warn({ reason: discovery.error }, "Sync cycle skipped - company discovery failed");
    return { skipped: true, reason: "DISCOVERY_FAILED", error: discovery.error, companies: [], runId };
  }

  await mirror.upsertCompanies(discovery.companies, runId);

  const results = [];
  for (const company of discovery.companies) {
    results.push(await syncCompany(company, runId));
  }

  return { skipped: false, runId, companyCount: discovery.companies.length, companies: results };
}

module.exports = { newRunId, syncCompany, runSyncCycle };
