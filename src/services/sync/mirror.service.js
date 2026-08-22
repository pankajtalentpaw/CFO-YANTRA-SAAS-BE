const { isConnected } = require("../../config/db");
const { Company, Voucher, DOMAIN_MODELS } = require("../../models");
const { logger } = require("../../utils/logger");
const { recordChecksum } = require("../../utils/checksum");

/**
 * Read/write layer over the local MongoDB mirror.
 *
 * Two rules govern everything here:
 *
 *  1. A read never invents data. If the mirror is disconnected, or holds
 *     nothing for the requested company, it returns null so the caller falls
 *     back to live TallyPrime extraction and behaviour is unchanged.
 *  2. A write only touches what actually changed. Each canonical record
 *     carries a parser checksum; records whose checksum is unchanged are not
 *     rewritten, so a quiet company costs no writes at all.
 */

// Fields the mirror adds around a canonical record. They are stripped on read
// so the API keeps returning exactly the canonical shape the parsers produce.
const ENVELOPE_FIELDS = [
  "_id", "__v", "companyId", "isDeleted", "deletedAt",
  "syncedAt", "lastRunId", "createdAt", "updatedAt", "contentHash"
];

/**
 * Fields that differ between two extractions of identical data.
 *
 * The parsers stamp every record with an `extractionRunId` derived from the
 * clock and then fold it into their own `checksum`, so that checksum changes
 * on every pull even when nothing in Tally moved. Using it for change
 * detection would rewrite the entire mirror on every tick. The mirror
 * therefore hashes the record itself with these volatile fields removed.
 */
const VOLATILE_FIELDS = ["extractionRunId", "checksum"];

function contentHash(record) {
  const stable = { ...record };
  for (const field of VOLATILE_FIELDS) delete stable[field];
  return recordChecksum(stable);
}

function stripEnvelope(doc) {
  const out = { ...doc };
  for (const field of ENVELOPE_FIELDS) delete out[field];
  return out;
}

/**
 * Companies are stripped differently from domain records.
 *
 * A canonical domain record identifies its company through `sourceCompanyId`,
 * so `companyId` there is mirror bookkeeping and gets removed. On a company
 * document `companyId` IS the identity every caller resolves against, so it
 * must survive - dropping it hands back a company with a null id.
 */
const COMPANY_ENVELOPE_FIELDS = ENVELOPE_FIELDS.filter((f) => f !== "companyId")
  .concat(["isOpen", "lastSeenAt", "closedAt"]);

function stripCompanyEnvelope(doc) {
  const out = { ...doc };
  for (const field of COMPANY_ENVELOPE_FIELDS) delete out[field];
  return out;
}

function modelForDomain(domain) {
  return DOMAIN_MODELS[domain] || null;
}

/**
 * Upsert one domain's records for a company, writing only real changes.
 * @returns {{total,inserted,updated,unchanged,tombstoned}}
 */
async function upsertRecords(model, companyId, records, runId) {
  const stats = { total: records.length, inserted: 0, updated: 0, unchanged: 0, tombstoned: 0 };

  const existing = await model
    .find({ companyId }, { sourceObjectId: 1, contentHash: 1, isDeleted: 1 })
    .lean();
  const known = new Map(existing.map((d) => [d.sourceObjectId, d]));

  const now = new Date();
  const ops = [];
  const seen = new Set();

  for (const record of records) {
    const sourceObjectId = record && record.sourceObjectId;
    // A record the parser could not key cannot be mirrored deterministically.
    if (!sourceObjectId) continue;
    seen.add(sourceObjectId);

    const prior = known.get(sourceObjectId);
    const hash = contentHash(record);
    // Unchanged and not tombstoned: nothing to write.
    if (prior && prior.contentHash && prior.contentHash === hash && !prior.isDeleted) {
      stats.unchanged++;
      continue;
    }

    ops.push({
      updateOne: {
        filter: { companyId, sourceObjectId },
        update: {
          $set: {
            ...record,
            companyId,
            sourceObjectId,
            contentHash: hash,
            isDeleted: false,
            deletedAt: null,
            syncedAt: now,
            lastRunId: runId
          }
        },
        upsert: true
      }
    });
    if (prior) stats.updated++;
    else stats.inserted++;
  }

  // Tally exposes no delete feed, so anything that stopped appearing is
  // tombstoned rather than dropped. History and audit trails stay intact.
  const vanished = existing
    .filter((d) => !d.isDeleted && !seen.has(d.sourceObjectId))
    .map((d) => d.sourceObjectId);

  if (vanished.length > 0) {
    ops.push({
      updateMany: {
        filter: { companyId, sourceObjectId: { $in: vanished } },
        update: { $set: { isDeleted: true, deletedAt: now, lastRunId: runId } }
      }
    });
    stats.tombstoned = vanished.length;
  }

  if (ops.length > 0) {
    await model.bulkWrite(ops, { ordered: false });
  }
  return stats;
}

async function upsertDomain(companyId, domain, records, runId) {
  const model = modelForDomain(domain);
  if (!model) throw new Error(`Unknown mirror domain: ${domain}`);
  return upsertRecords(model, companyId, records, runId);
}

async function upsertVouchers(companyId, records, runId) {
  return upsertRecords(Voucher, companyId, records, runId);
}

/** Mirror the company list itself, tombstoning companies no longer open. */
async function upsertCompanies(companies, runId) {
  const now = new Date();
  const ops = companies.map((c) => ({
    updateOne: {
      filter: { companyId: c.companyId },
      update: {
        $set: { ...c, companyId: c.companyId, isOpen: true, closedAt: null, lastSeenAt: now, syncedAt: now, lastRunId: runId }
      },
      upsert: true
    }
  }));

  const openIds = companies.map((c) => c.companyId);
  ops.push({
    updateMany: {
      filter: { companyId: { $nin: openIds }, isOpen: true },
      update: { $set: { isOpen: false, closedAt: now, lastRunId: runId } }
    }
  });

  if (ops.length > 0) await Company.bulkWrite(ops, { ordered: false });
  return { total: companies.length };
}

/**
 * Serve one domain from the mirror.
 * @returns {object|null} extraction-shaped result, or null to fall back to Tally.
 */
async function readDomain(companyId, domain) {
  if (!isConnected()) return null;
  const model = modelForDomain(domain);
  if (!model) return null;

  try {
    const docs = await model.find({ companyId, isDeleted: false }).lean();
    // An empty mirror is not an answer - it means "not synced yet".
    if (docs.length === 0) return null;

    const syncedAt = docs.reduce(
      (max, d) => (d.syncedAt && d.syncedAt > max ? d.syncedAt : max),
      new Date(0)
    );

    return {
      available: true,
      records: docs.map(stripEnvelope),
      fetchedAt: syncedAt.toISOString(),
      source: "mirror",
      syncedAt: syncedAt.toISOString()
    };
  } catch (error) {
    // A mirror fault must never fail a request that Tally could still answer.
    logger.warn({ error: error.message, companyId, domain }, "Mirror read failed - falling back to TallyPrime");
    return null;
  }
}

/** Serve the voucher register from the mirror for the requested date window. */
async function readVouchers(companyId, { fromDate = null, toDate = null } = {}) {
  if (!isConnected()) return null;
  try {
    const query = { companyId, isDeleted: false };
    // Canonical vouchers carry an ISO `date`; compare on the same compact form
    // the request uses so a partial window is never served as complete.
    if (fromDate) query.date = { ...(query.date || {}), $gte: toIsoDay(fromDate) };
    if (toDate) query.date = { ...(query.date || {}), $lte: toIsoDay(toDate) };

    const docs = await Voucher.find(query).lean();
    if (docs.length === 0) return null;

    const syncedAt = docs.reduce(
      (max, d) => (d.syncedAt && d.syncedAt > max ? d.syncedAt : max),
      new Date(0)
    );

    return {
      available: true,
      records: docs.map(stripEnvelope),
      fetchedAt: syncedAt.toISOString(),
      source: "mirror",
      syncedAt: syncedAt.toISOString()
    };
  } catch (error) {
    logger.warn({ error: error.message, companyId }, "Mirror voucher read failed - falling back to TallyPrime");
    return null;
  }
}

/** Accepts Tally compact YYYYMMDD or ISO YYYY-MM-DD and returns ISO. */
function toIsoDay(value) {
  const text = String(value).trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return text;
}

/**
 * Identify a company from the mirror when TallyPrime cannot be reached.
 * Returns null when it was never mirrored, so the caller keeps its 502.
 */
async function readCompany(companyId) {
  if (!isConnected()) return null;
  try {
    const doc = await Company.findOne({ companyId }).lean();
    if (!doc) return null;
    return stripCompanyEnvelope(doc);
  } catch (error) {
    logger.warn({ error: error.message, companyId }, "Mirror company lookup failed");
    return null;
  }
}

async function countsForCompany(companyId) {
  if (!isConnected()) return null;
  const counts = {};
  for (const [domain, model] of Object.entries(DOMAIN_MODELS)) {
    counts[domain] = await model.countDocuments({ companyId, isDeleted: false });
  }
  counts.vouchers = await Voucher.countDocuments({ companyId, isDeleted: false });
  return counts;
}

module.exports = {
  stripEnvelope,
  stripCompanyEnvelope,
  contentHash,
  modelForDomain,
  upsertDomain,
  upsertVouchers,
  upsertCompanies,
  readCompany,
  readDomain,
  readVouchers,
  countsForCompany,
  toIsoDay
};
