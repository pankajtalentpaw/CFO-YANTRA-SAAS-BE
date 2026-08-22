/**
 * Customer classification layer — the ONLY source of Tier and CustomerType.
 *
 * Neither field is native to Tally. Nothing here derives a value from sales
 * behaviour or naming guesses: a classification exists because someone
 * configured it, or the field is null with a data-quality reason.
 */

const { DATA_QUALITY_REASONS } = require("./factSales.errors");

/** Where a classification came from. Recorded on every FACT_SALES row. */
const CLASSIFICATION_SOURCES = Object.freeze({
  MANUAL: "manual",
  EXTERNAL_MASTER: "external_master",
  LEDGER_GROUP: "ledger_group",
  TDL_UDF: "tdl_udf"
});

/** Normalized lookup key. Never a global name-only key — company always scopes it. */
function classificationKey(companyId, ledgerId) {
  return `${companyId}::${ledgerId}`;
}

/**
 * Build an index over CustomerClassification records.
 *
 * @param {Array<{companyId: string, ledgerId: string, tier?: string|null,
 *   customerType?: string|null, source?: string, confidence?: string}>} records
 * @returns {Map<string, object>}
 */
function buildClassificationIndex(records = []) {
  const index = new Map();
  for (const record of records) {
    if (!record || !record.companyId || !record.ledgerId) continue;
    if (!Object.values(CLASSIFICATION_SOURCES).includes(record.source)) continue;
    index.set(classificationKey(record.companyId, record.ledgerId), {
      companyId: record.companyId,
      ledgerId: record.ledgerId,
      tier: record.tier || null,
      customerType: record.customerType || null,
      source: record.source,
      confidence: record.confidence || "medium",
      updatedAt: record.updatedAt || null
    });
  }
  return index;
}

/**
 * Resolve Tier and CustomerType for one ledger.
 * Returns nulls plus reasons when no classification is configured.
 *
 * @param {Map<string, object>} index
 * @param {string} companyId
 * @param {string|null} ledgerId
 * @returns {{tier: string|null, customerType: string|null, source: string|null,
 *   confidence: string|null, reasons: string[]}}
 */
function resolveClassification(index, companyId, ledgerId) {
  const reasons = [];
  const match = ledgerId ? index.get(classificationKey(companyId, ledgerId)) : null;

  const tier = match && match.tier ? match.tier : null;
  const customerType = match && match.customerType ? match.customerType : null;

  if (!tier) reasons.push(DATA_QUALITY_REASONS.TIER_NOT_CONFIGURED);
  if (!customerType) reasons.push(DATA_QUALITY_REASONS.CUSTOMER_TYPE_NOT_CONFIGURED);

  return {
    tier,
    customerType,
    source: match ? match.source : null,
    confidence: match ? match.confidence : null,
    reasons
  };
}

module.exports = {
  CLASSIFICATION_SOURCES,
  buildClassificationIndex,
  resolveClassification,
  classificationKey
};
