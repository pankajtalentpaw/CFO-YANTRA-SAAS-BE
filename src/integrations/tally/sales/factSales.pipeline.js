/**
 * FACT_SALES ingestion pipeline orchestration.
 *
 *   Tally XML -> raw ingestion -> typed parser -> canonical source models
 *   -> normalization -> join -> validation -> FACT_SALES -> reconciliation
 *   -> data readiness
 *
 * Each extraction is a separate, independently retryable read-only request.
 * Every stage is company-scoped; nothing is shared across companies.
 */

const { sendXmlRequest } = require("../transports/xml.transport");
const { parseCompanies } = require("../tally.parser");
const { buildCompanyListRequest } = require("../tally.requests");
const {
  buildSalesLedgerRequest,
  buildSalesStockGroupRequest,
  buildSalesStockItemRequest,
  buildSalesCostCentreRequest,
  buildSalesVoucherRequest
} = require("./sales.requests");
const { normalizeCanonicalLedger } = require("../canonical/accounting.canonical");
const { normalizeCanonicalStockGroup, normalizeCanonicalStockItem } = require("../canonical/inventory.canonical");
const { normalizeCanonicalCostCentre } = require("../canonical/dimensions.canonical");
const { normalizeSalesVoucher } = require("./salesVoucher.canonical");
const { buildFactSales } = require("./factSales.builder");
const { reconcileFactSales, deriveSalesControlTotal, buildDataReadiness } = require("./factSales.reconcile");
const { ingestionError, classifyTransportFailure, INGESTION_ERROR_CODES } = require("./factSales.errors");
const { isCompanyStillOpen } = require("../../../services/companyScope.service");

/** ISO yyyy-mm-dd -> Tally yyyymmdd. */
function toTallyCompact(isoDate) {
  if (!isoDate) return null;
  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

/**
 * Decide the period to request.
 *
 * Verified against a live TallyPrime: asking for a Voucher collection without
 * SVFROMDATE returns only Tally's own current period, which for a company whose
 * books start earlier hides the entire history — the pipeline read 119 ledgers
 * and 41 stock items but zero sales vouchers. Defaulting to the company's
 * books-from date makes the extraction cover what the company actually holds.
 * An explicit caller range always wins.
 */
function resolveRange(company, range = {}) {
  const fromDate = range.fromDate || toTallyCompact(company && company.startingAt);
  return { ...range, ...(fromDate ? { fromDate } : {}) };
}

/**
 * Run one read-only extraction and normalize its collection.
 *
 * @param {object} params
 * @param {string} params.xml Read-only Export request
 * @param {string} params.source Label used in errors, e.g. "ledgerMaster"
 * @param {string} params.companyId
 * @param {Function} params.normalize (rawNode, context) => canonical record
 * @param {object} params.context
 * @returns {Promise<{success: boolean, records: Array, error?: object, rawCount: number}>}
 */
async function extractCollection({ xml, source, companyId, normalize, context, company }) {
  // Same hard gate as companyData.service: targeting a company that is no
  // longer open in Tally crashes TallyPrime.
  if (company && !(await isCompanyStillOpen(company))) {
    return {
      success: false, records: [], rawCount: 0,
      error: ingestionError(INGESTION_ERROR_CODES.TALLY_COMPANY_NOT_FOUND, {
        companyId, source, stage: "guard",
        message: `Company "${company.name}" is no longer open in TallyPrime.`
      })
    };
  }

  let transportResult;
  try {
    transportResult = await sendXmlRequest({ xml });
  } catch (error) {
    return {
      success: false,
      records: [],
      rawCount: 0,
      error: ingestionError(INGESTION_ERROR_CODES.TALLY_CONNECTION_FAILED, {
        companyId, source, stage: "extract", message: error.message
      })
    };
  }

  if (!transportResult.success) {
    return {
      success: false,
      records: [],
      rawCount: 0,
      error: ingestionError(classifyTransportFailure(transportResult), {
        companyId, source, stage: "extract",
        message: transportResult.errorMessage || transportResult.errorCode || "Extraction failed"
      })
    };
  }

  const parsed = transportResult.parsedResponse;
  if (!parsed || !parsed.success) {
    return {
      success: false,
      records: [],
      rawCount: 0,
      error: ingestionError(INGESTION_ERROR_CODES.TALLY_XML_PARSE_ERROR, {
        companyId, source, stage: "parse",
        message: (parsed && (parsed.error || parsed.lineError)) || "Unparseable response"
      })
    };
  }

  const rawNodes = parsed.collection || [];
  const records = rawNodes
    .map((node) => {
      try { return normalize(node, context); } catch (e) { return null; }
    })
    .filter(Boolean);

  return { success: true, records, rawCount: rawNodes.length };
}

/**
 * Discover companies currently open in TallyPrime.
 * Returns typed identities only — no names are assumed or hard-coded.
 */
async function discoverCompanies() {
  // The list request (not the minimal probe) so GUID is available as identity.
  const transportResult = await sendXmlRequest({ xml: buildCompanyListRequest() });
  if (!transportResult.success) {
    return {
      success: false,
      companies: [],
      error: ingestionError(classifyTransportFailure(transportResult), {
        source: "companyDiscovery", stage: "extract",
        message: transportResult.errorMessage || "Company discovery failed"
      })
    };
  }

  const companies = parseCompanies(transportResult.parsedResponse);
  if (companies.length === 0) {
    return {
      success: false,
      companies: [],
      error: ingestionError(INGESTION_ERROR_CODES.TALLY_NO_COMPANY, {
        source: "companyDiscovery", stage: "extract",
        message: "No company is currently open in TallyPrime"
      })
    };
  }

  return { success: true, companies };
}

/** Run thunks one at a time so Tally never sees concurrent collection queries. */
async function sequential(thunks) {
  const results = [];
  for (const thunk of thunks) results.push(await thunk());
  return results;
}

/**
 * Extract every source dataset FACT_SALES needs for one company.
 * Master failures are collected rather than thrown: a missing cost centre
 * master degrades Salesman to null, it does not fail the pipeline.
 */
async function extractCompanySources(company, options = {}) {
  const companyId = company.companyId;
  const companyName = company.name;
  const context = { sourceCompanyId: companyId, extractionRunId: options.syncRunId };
  const errors = [];

  // Sequential for the same reason as getOverview: Tally is single-threaded.
  const [ledgers, stockGroups, stockItems, costCentres] = await sequential([
    () => extractCollection({
      xml: buildSalesLedgerRequest(companyName), source: "ledgerMaster",
      companyId, normalize: normalizeCanonicalLedger, context, company
    }),
    () => extractCollection({
      xml: buildSalesStockGroupRequest(companyName), source: "stockGroupMaster",
      companyId, normalize: normalizeCanonicalStockGroup, context, company
    }),
    () => extractCollection({
      xml: buildSalesStockItemRequest(companyName), source: "stockItemMaster",
      companyId, normalize: normalizeCanonicalStockItem, context, company
    }),
    () => extractCollection({
      xml: buildSalesCostCentreRequest(companyName), source: "costCentreMaster",
      companyId, normalize: normalizeCanonicalCostCentre, context, company
    })
  ]);

  for (const result of [ledgers, stockGroups, stockItems]) {
    if (!result.success) errors.push(result.error);
  }

  const vouchers = await extractCollection({
    xml: buildSalesVoucherRequest(companyName, resolveRange(company, options.range)),
    source: "salesVoucher",
    companyId,
    normalize: (node) => normalizeSalesVoucher(node, {
      companyId,
      companyGuid: company.guid || null,
      syncRunId: options.syncRunId,
      fetchedAt: new Date().toISOString()
    }),
    context,
    company
  });
  if (!vouchers.success) errors.push(vouchers.error);

  // Cost centres are optional in Tally; their absence is a capability fact.
  const costCentresEnabled = costCentres.success && costCentres.records.length > 0;

  return {
    companyId,
    companyGuid: company.guid || null,
    companyName,
    ledgers: ledgers.records,
    stockGroups: stockGroups.records,
    stockItems: stockItems.records,
    costCentres: costCentres.records,
    salesVouchers: vouchers.records,
    costCentresEnabled,
    salesmanAvailability: costCentresEnabled ? "available" : "unavailable",
    errors
  };
}

/**
 * Full FACT_SALES pipeline for one company: extract -> normalize -> join ->
 * generate -> reconcile -> readiness.
 *
 * @param {object} company TallyCompanyInfo
 * @param {object} [options]
 * @param {string} [options.syncRunId]
 * @param {Array}  [options.classifications] CustomerClassification records
 * @param {object} [options.range] { fromDate, toDate } in Tally date format
 */
async function runFactSalesForCompany(company, options = {}) {
  const syncRunId = options.syncRunId || `SYNC_${Date.now()}`;
  const sources = await extractCompanySources(company, { ...options, syncRunId });

  const fact = buildFactSales({
    companyId: sources.companyId,
    companyGuid: sources.companyGuid,
    salesVouchers: sources.salesVouchers,
    ledgers: sources.ledgers,
    stockItems: sources.stockItems,
    stockGroups: sources.stockGroups,
    costCentres: sources.costCentres,
    classifications: options.classifications || [],
    costCentresEnabled: sources.costCentresEnabled,
    syncRunId
  });

  const controlTotal = deriveSalesControlTotal(sources.ledgers, sources.companyId);
  const reconciliation = reconcileFactSales({
    companyId: sources.companyId,
    rows: fact.rows,
    controlTotal
  });

  return {
    success: sources.errors.length === 0,
    syncRunId,
    companyId: sources.companyId,
    companyGuid: sources.companyGuid,
    companyName: sources.companyName,
    salesmanAvailability: sources.salesmanAvailability,
    sourceCounts: {
      ledgers: sources.ledgers.length,
      stockGroups: sources.stockGroups.length,
      stockItems: sources.stockItems.length,
      costCentres: sources.costCentres.length,
      salesVouchers: sources.salesVouchers.length
    },
    factSales: fact.rows,
    rejected: fact.rejected,
    stats: fact.stats,
    reconciliation,
    dataReadiness: buildDataReadiness(fact.rows),
    errors: sources.errors
  };
}

/**
 * Run the pipeline for every discovered company, keeping results isolated.
 * Companies are processed sequentially so Tally is never flooded with
 * concurrent collection queries.
 */
async function runFactSalesIngestion(options = {}) {
  const discovery = await discoverCompanies();
  if (!discovery.success) {
    return { success: false, companies: [], results: [], error: discovery.error };
  }

  const targets = options.companyId
    ? discovery.companies.filter((c) => c.companyId === options.companyId)
    : discovery.companies;

  if (targets.length === 0) {
    return {
      success: false,
      companies: discovery.companies,
      results: [],
      error: ingestionError(INGESTION_ERROR_CODES.TALLY_COMPANY_NOT_FOUND, {
        companyId: options.companyId, source: "companyDiscovery", stage: "extract",
        message: `Company ${options.companyId} is not open in TallyPrime`
      })
    };
  }

  const results = [];
  for (const company of targets) {
    results.push(await runFactSalesForCompany(company, options));
  }

  return {
    success: results.every((r) => r.success),
    companyCount: targets.length,
    companies: targets,
    results
  };
}

module.exports = {
  resolveRange,
  runFactSalesIngestion,
  runFactSalesForCompany,
  extractCompanySources,
  discoverCompanies,
  extractCollection
};
