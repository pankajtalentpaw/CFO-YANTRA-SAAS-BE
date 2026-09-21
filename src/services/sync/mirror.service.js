const { Op } = require("sequelize");
const { isConnected } = require("../../config/db");
const { Company, Voucher, DOMAIN_MODELS } = require("../../models");
const { logger } = require("../../utils/logger");
const { recordChecksum } = require("../../utils/checksum");
const env = require("../../config/env");

/**
 * Read/write layer over the local SQL database mirror.
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
  "id", "_id", "__v", "companyId", "isDeleted", "deletedAt",
  "syncedAt", "lastRunId", "createdAt", "updatedAt", "contentHash", "data"
];

/**
 * Fields that differ between two extractions of identical data.
 *
 * Everything listed here is stamped fresh by the parsers on every read - a run
 * id, a wall-clock timestamp - and says nothing about whether the record's
 * content moved. Leaving one out silently defeats change detection: the
 * canonical sales voucher carries both `syncRunId` and `sourceFetchedAt`, so
 * every voucher hashed differently on every cycle and all 10,812 of them were
 * rewritten every five minutes (measured: unchanged=0, updated=10812) on a
 * company where nothing had actually changed. Masters were unaffected, which
 * is why the ledger-only test kept passing.
 *
 * `alterId` is here for a subtler reason: only the CDC engine stamps it, so the
 * same voucher hashed one way when CDC wrote it and another when the full sync
 * did, and the two writers flipped the same 928 records back and forth on every
 * cycle. It is a version marker, not content - a real alteration always moves
 * the amount, date, party or entries with it - so ignoring it here costs no
 * change detection while ending the ping-pong. It is still stored, because the
 * CDC cursor resumes from it.
 */
const VOLATILE_FIELDS = ["extractionRunId", "syncRunId", "sourceFetchedAt", "checksum", "alterId"];

function contentHash(record) {
  const stable = { ...record };
  for (const field of VOLATILE_FIELDS) delete stable[field];
  return recordChecksum(stable);
}

/**
 * Records ke array ko N-size ke chunks mein todta hai.
 * Batch processing ke liye use hota hai.
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Batches ke beech mein pause lene ke liye (ms milliseconds).
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseData(data) {
  if (!data) return {};
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return typeof data === "object" ? { ...data } : {};
}

function stripEnvelope(doc) {
  if (!doc) return null;
  const base = parseData(doc.data);
  const out = { ...base, ...doc };
  for (const field of ENVELOPE_FIELDS) delete out[field];
  if (out.isDeleted !== undefined) out.isDeleted = Boolean(out.isDeleted);
  return out;
}

const COMPANY_ENVELOPE_FIELDS = [
  "id", "_id", "__v", "isOpen", "lastSeenAt", "closedAt",
  "createdAt", "updatedAt", "metadata"
];

function stripCompanyEnvelope(doc) {
  if (!doc) return null;
  const out = { ...doc };
  for (const field of COMPANY_ENVELOPE_FIELDS) delete out[field];
  if (out.isOpen !== undefined) out.isOpen = Boolean(out.isOpen);
  return out;
}

function modelForDomain(domain) {
  return DOMAIN_MODELS[domain] || null;
}

/**
 * Upsert one domain's records for a company, writing only real changes.
 *
 * @param {object} [options]
 * @param {boolean} [options.tombstoneMissing=true] Whether `records` is the
 *   COMPLETE set for this company. Only then does "absent from the list" mean
 *   "gone from Tally". A caller passing a delta must set this false, or every
 *   record outside its batch is tombstoned.
 * @returns {{total,inserted,updated,unchanged,tombstoned,skipped}}
 */
async function upsertRecords(model, companyId, records, runId, { tombstoneMissing = true } = {}) {
  const batchSize = env.sync.batchSize || 500;
  const batchPauseMs = env.sync.batchPauseMs ?? 2000;

  const stats = { total: records.length, inserted: 0, updated: 0, unchanged: 0, tombstoned: 0, skipped: 0 };

  // Saare existing records ek baar fetch karo (change-detection ke liye reference set).
  const existing = await model.findAll({
    where: { companyId },
    attributes: ["sourceObjectId", "contentHash", "isDeleted"],
    raw: true
  });
  const known = new Map(existing.map((d) => [d.sourceObjectId, d]));

  const now = new Date();
  const seen = new Set();

  // -------------------------------------------------------------------------
  // PRE-FILTER: Batches banane se pehle hi unchanged records hatao.
  //
  // Jo records DB mein already hain aur contentHash same hai, unhe batch loop
  // mein ghusne ki zaroorat nahi. Yeh ek baar O(n) pass mein:
  //   - `seen` set build karta hai (tombstone detection ke liye sab records chahiye)
  //   - unchanged records count karta hai
  //   - sirf naye ya changed records `toProcess` mein dalta hai
  //
  // Agar 5000 vouchers hain aur 4800 already DB mein hain to sirf 200 records
  // process honge — 4800 ka loop bilkul nahi chalega.
  // -------------------------------------------------------------------------
  const toProcess = [];

  for (const record of records) {
    const sourceObjectId = record && record.sourceObjectId;
    if (!sourceObjectId) {
      stats.skipped++;
      continue;
    }
    // Tombstone detection ke liye sab sourceObjectIds track karo.
    seen.add(sourceObjectId);

    const prior = known.get(sourceObjectId);
    const hash = contentHash(record);

    // Already DB mein hai, hash same hai, deleted nahi — bilkul skip karo.
    if (prior && prior.contentHash && prior.contentHash === hash && !prior.isDeleted) {
      stats.unchanged++;
      continue;
    }

    // Naya record ya content change hua hai — process karna hai.
    toProcess.push({ record, prior, hash });
  }

  // -------------------------------------------------------------------------
  // BATCH PROCESSING: sirf naye / changed records ko SYNC_BATCH_SIZE ke
  // chunks mein process karo. Har chunk ke baad SYNC_BATCH_PAUSE_MS ki neend.
  // -------------------------------------------------------------------------
  const batches = chunkArray(toProcess, batchSize);
  const totalBatches = batches.length;

  logger.info(
    {
      companyId,
      objectType: model.name,
      totalRecords: records.length,
      alreadySynced: stats.unchanged,
      toProcess: toProcess.length,
      batchSize,
      totalBatches
    },
    toProcess.length === 0
      ? "Koi naya ya changed record nahi — sab already synced hain"
      : `Batch processing shuru — ${toProcess.length} records ${totalBatches} batches mein`
  );

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const batchNum = batchIdx + 1;
    const toUpsert = [];

    for (const { record, prior, hash } of batch) {
      const sourceObjectId = record.sourceObjectId;

      const payload = {
        ...record,
        companyId,
        sourceObjectId,
        objectType: record.objectType || (model.options && model.options.name ? model.options.name.singular : model.name),
        name: record.name || null,
        parent: record.parent || null,
        checksum: record.checksum || null,
        contentHash: hash,
        isDeleted: false,
        deletedAt: null,
        syncedAt: now,
        lastRunId: runId,
        data: record
      };

      if (model.name === "Voucher") {
        // voucherDate is the column the register, the dashboard and every date
        // window filter on, so a null here makes the voucher invisible even
        // though the row is present and correct. Fall back through every shape a
        // voucher has ever been written in rather than trust one of them.
        const header = record.header || {};
        payload.voucherDate = record.voucherDate || record.date || header.date || null;
        payload.sourceVoucherNumber =
          record.sourceVoucherNumber || record.voucherNumber || header.voucherNumber || null;
        payload.header = record.header || null;
        payload.entries = record.entries || null;
      }

      toUpsert.push(payload);
      if (prior) stats.updated++;
      else stats.inserted++;
    }

    if (toUpsert.length > 0) {
      for (const item of toUpsert) {
        await model.upsert(item);
      }
    }

    logger.info(
      {
        companyId,
        objectType: model.name,
        batch: `${batchNum}/${totalBatches}`,
        batchRecords: batch.length,
        written: toUpsert.length,
        cumulative: { inserted: stats.inserted, updated: stats.updated }
      },
      `Batch ${batchNum}/${totalBatches} complete`
    );

    // Agar aur batches bachi hain toh pause lo.
    if (batchIdx < batches.length - 1 && batchPauseMs > 0) {
      await sleep(batchPauseMs);
    }
  }

  // -------------------------------------------------------------------------
  // TOMBSTONING: Sirf tab chalega jab saare batches complete ho jayein aur
  // 'seen' set mein saare processed records hain. CDC partial batches ke liye
  // tombstoneMissing=false pass karta hai, isliye woh safe hain.
  // -------------------------------------------------------------------------

  /*
   * Tally exposes no delete feed, so anything that stopped appearing is
   * tombstoned rather than dropped. History and audit trails stay intact.
   *
   * This is only sound when `records` is the whole set. The CDC engine writes
   * an incremental batch - the vouchers whose AlterId moved - and passing that
   * through here tombstoned the entire register except the delta on every tick:
   * 2,412 live vouchers were struck off in a single CDC run, and a company
   * mirrored only by CDC read back as completely empty.
   */
  const vanished = tombstoneMissing
    ? existing.filter((d) => !d.isDeleted && !seen.has(d.sourceObjectId)).map((d) => d.sourceObjectId)
    : [];

  /*
   * Even on a complete set, refuse an implausible mass tombstoning. A read that
   * succeeds but returns a truncated collection is indistinguishable here from
   * a company that genuinely deleted its history, and the destructive reading
   * of that ambiguity is the one that cannot be undone by looking again. The
   * deletion detector already guards itself this way; this is the same rule at
   * the other place tombstones are written.
   */
  const MAX_TOMBSTONE_RATIO = 0.15;
  const activeCount = existing.filter((d) => !d.isDeleted).length;
  const maxAllowed = Math.max(10, Math.floor(activeCount * MAX_TOMBSTONE_RATIO));
  if (vanished.length > maxAllowed) {
    logger.warn(
      { companyId, objectType: model.name, vanished: vanished.length, maxAllowed, activeCount },
      "Refusing to tombstone an implausible share of records in one pass - treating the read as partial"
    );
    vanished.length = 0;
  }

  if (vanished.length > 0) {
    await model.update(
      { isDeleted: true, deletedAt: now, lastRunId: runId },
      { where: { companyId, sourceObjectId: { [Op.in]: vanished } } }
    );
    stats.tombstoned = vanished.length;
  }

  if (stats.skipped > 0) {
    logger.warn(
      { companyId, objectType: model.name, skipped: stats.skipped, total: stats.total },
      "Records had no sourceObjectId and were not mirrored"
    );
  }
  return stats;
}

async function upsertDomain(companyId, domain, records, runId) {
  const model = modelForDomain(domain);
  if (!model) throw new Error(`Unknown mirror domain: ${domain}`);
  return upsertRecords(model, companyId, records, runId);
}

async function upsertVouchers(companyId, records, runId, options = {}) {
  return upsertRecords(Voucher, companyId, records, runId, options);
}

/** Mirror the company list itself, tombstoning companies no longer open. */
async function upsertCompanies(companies, runId) {
  const now = new Date();
  const openIds = [];

  for (const c of companies) {
    if (!c || !c.companyId) continue;
    openIds.push(c.companyId);
    await Company.upsert({
      ...c,
      companyId: c.companyId,
      name: c.name || null,
      legalName: c.legalName || null,
      formalName: c.formalName || null,
      guid: c.guid || null,
      masterId: c.masterId || null,
      alterId: c.alterId || null,
      startingFrom: c.startingFrom || null,
      startingAt: c.startingAt || null,
      booksFrom: c.booksFrom || null,
      financialYearBeginning: c.financialYearBeginning || null,
      baseCurrency: c.baseCurrency || "INR",
      country: c.country || "India",
      countryName: c.countryName || "India",
      state: c.state || null,
      stateName: c.stateName || null,
      pinCode: c.pinCode || null,
      address: c.address || null,
      gstin: c.gstin || null,
      gstRegNo: c.gstRegNo || null,
      pan: c.pan || null,
      panCardNo: c.panCardNo || null,
      cin: c.cin || null,
      cinNo: c.cinNo || null,
      email: c.email || null,
      phone: c.phone || null,
      phoneNumber: c.phoneNumber || null,
      mobile: c.mobile || null,
      mobileNo: c.mobileNo || null,
      features: c.features || undefined,
      isOpen: true,
      closedAt: null,
      lastSeenAt: now,
      syncedAt: now,
      lastRunId: runId
    });
  }

  if (openIds.length > 0) {
    await Company.update(
      { isOpen: false, closedAt: now, lastRunId: runId },
      { where: { companyId: { [Op.notIn]: openIds }, isOpen: true } }
    );
  }
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
    const docs = await model.findAll({
      where: { companyId, isDeleted: false },
      raw: true
    });
    // An empty mirror is not an answer - it means "not synced yet".
    if (docs.length === 0) return null;

    const syncedAt = docs.reduce(
      (max, d) => (d.syncedAt && new Date(d.syncedAt) > max ? new Date(d.syncedAt) : max),
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
    const where = { companyId, isDeleted: false };
    if (fromDate && toDate) {
      where.voucherDate = { [Op.gte]: toIsoDay(fromDate), [Op.lte]: toIsoDay(toDate) };
    } else if (fromDate) {
      where.voucherDate = { [Op.gte]: toIsoDay(fromDate) };
    } else if (toDate) {
      where.voucherDate = { [Op.lte]: toIsoDay(toDate) };
    }

    const docs = await Voucher.findAll({ where, raw: true });
    if (docs.length === 0) {
      const totalCompanyVouchers = await Voucher.count({ where: { companyId, isDeleted: false } });
      if (totalCompanyVouchers > 0) {
        return {
          available: true,
          records: [],
          fetchedAt: new Date().toISOString(),
          source: "mirror",
          syncedAt: new Date().toISOString()
        };
      }
      return null;
    }

    const syncedAt = docs.reduce(
      (max, d) => (d.syncedAt && new Date(d.syncedAt) > max ? new Date(d.syncedAt) : max),
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
    const doc = await Company.findOne({ where: { companyId }, raw: true });
    if (!doc) return null;
    return stripCompanyEnvelope(doc);
  } catch (error) {
    logger.warn({ error: error.message, companyId }, "Mirror company lookup failed");
    return null;
  }
}

/**
 * Identify a company the mirror holds AND that Tally last reported open.
 *
 * Separate from readCompany on purpose. readCompany answers "have we ever seen
 * this company", which is the right question when Tally is unreachable. This
 * one answers "is it safe to serve this company's pages right now", which is
 * what the request path needs: a company closed in Tally must still read as
 * closed, not quietly fall back to whatever was mirrored before it was shut.
 */
async function readOpenCompany(companyId) {
  if (!isConnected()) return null;
  try {
    const doc = await Company.findOne({ where: { companyId, isOpen: true }, raw: true });
    if (!doc) return null;
    return stripCompanyEnvelope(doc);
  } catch (error) {
    logger.warn({ error: error.message, companyId }, "Mirror open-company lookup failed");
    return null;
  }
}

async function countsForCompany(companyId) {
  if (!isConnected()) return null;
  const counts = {};
  for (const [domain, model] of Object.entries(DOMAIN_MODELS)) {
    counts[domain] = await model.count({ where: { companyId, isDeleted: false } });
  }
  counts.vouchers = await Voucher.count({ where: { companyId, isDeleted: false } });
  return counts;
}

async function listCompanies() {
  if (!isConnected()) return [];
  try {
    const docs = await Company.findAll({ where: { isOpen: true }, raw: true });
    return docs.map(stripCompanyEnvelope);
  } catch (error) {
    logger.warn({ error: error.message }, "Mirror listCompanies lookup failed");
    return [];
  }
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
  readOpenCompany,
  listCompanies,
  readDomain,
  readVouchers,
  countsForCompany,
  toIsoDay
};
