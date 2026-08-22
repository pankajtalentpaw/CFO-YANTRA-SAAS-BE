/**
 * Tally Master Data Extraction Service
 * Gated by strict Read-Only security policy.
 */

const { sendXmlRequest } = require("./transports/xml.transport");
const {
  buildCompanyDetailedRequest,
  buildGroupsRequest,
  buildLedgersRequest,
  buildVoucherTypesRequest,
  buildCostCategoriesRequest,
  buildCostCentresRequest,
  buildCurrenciesRequest,
  buildUnitsRequest,
  buildStockGroupsRequest,
  buildStockCategoriesRequest,
  buildStockItemsRequest,
  buildGodownsRequest
} = require("./tally.requests");

const { normalizeCanonicalCompany } = require("./canonical/company.canonical");
const { normalizeCanonicalGroup, normalizeCanonicalLedger } = require("./canonical/accounting.canonical");
const { normalizeCanonicalVoucherType } = require("./canonical/voucherType.canonical");
const { normalizeCanonicalCostCategory, normalizeCanonicalCostCentre } = require("./canonical/dimensions.canonical");
const { normalizeCanonicalCurrency, normalizeCanonicalUnit } = require("./canonical/currency.canonical");
const {
  normalizeCanonicalStockGroup,
  normalizeCanonicalStockCategory,
  normalizeCanonicalStockItem,
  normalizeCanonicalGodown
} = require("./canonical/inventory.canonical");

const { buildCapabilityManifest } = require("./canonical/manifest.canonical");
const { calculateFieldCoverage } = require("./canonical/fieldCoverage");
const { reconcileMasters } = require("./canonical/reconciliation.engine");
const { recordChecksum } = require("../../utils/checksum");

/**
 * Helper to fetch a collection from Tally XML
 */
async function fetchCollection(xmlBuilderFn, companyName, timeoutMs = 5000) {
  const xml = xmlBuilderFn(companyName);
  const res = await sendXmlRequest({ xml, timeoutMs });
  if (!res.success) {
    return { items: [], rawCount: 0, error: res.errorMessage || res.errorCode };
  }

  const parsed = res.parsedResponse;
  const items = parsed && parsed.collection ? parsed.collection : [];
  return { items, rawCount: items.length, error: null };
}

/**
 * Extract all master data for active company
 * @param {object} options - { companyName, timeoutMs, extractionRunId }
 */
async function extractAllMasters(options = {}) {
  const { companyName, timeoutMs = 5000 } = options;
  const extractionRunId = options.extractionRunId || `RUN_${Date.now()}`;

  // 1. Extract Company Details
  const companyRes = await fetchCollection(buildCompanyDetailedRequest, companyName, timeoutMs);
  if (!companyRes.items || companyRes.items.length === 0) {
    return {
      success: false,
      errorCode: "NO_COMPANY_LOADED",
      errorMessage: "No active company found or Tally returned empty company list"
    };
  }

  const rawCompany = companyRes.items[0];
  const company = normalizeCanonicalCompany(rawCompany, {
    sourceFormat: "XML",
    extractionRunId
  });

  const activeCompanyName = company ? company.displayName : companyName;
  const context = {
    sourceCompanyId: company ? company.sourceCompanyId : "UNKNOWN_COMPANY",
    sourceFormat: "XML",
    extractionRunId
  };

  // 2. Fetch all collections in parallel
  const [
    groupsRes,
    ledgersRes,
    voucherTypesRes,
    costCategoriesRes,
    costCentresRes,
    currenciesRes,
    unitsRes,
    stockGroupsRes,
    stockCategoriesRes,
    stockItemsRes,
    godownsRes
  ] = await Promise.all([
    fetchCollection(buildGroupsRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildLedgersRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildVoucherTypesRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildCostCategoriesRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildCostCentresRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildCurrenciesRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildUnitsRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildStockGroupsRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildStockCategoriesRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildStockItemsRequest, activeCompanyName, timeoutMs),
    fetchCollection(buildGodownsRequest, activeCompanyName, timeoutMs)
  ]);

  // 3. Normalize into Canonical models
  const groups = (groupsRes.items || []).map((i) => normalizeCanonicalGroup(i, context)).filter(Boolean);
  const ledgers = (ledgersRes.items || []).map((i) => normalizeCanonicalLedger(i, context)).filter(Boolean);
  const voucherTypes = (voucherTypesRes.items || []).map((i) => normalizeCanonicalVoucherType(i, context)).filter(Boolean);
  const costCategories = (costCategoriesRes.items || []).map((i) => normalizeCanonicalCostCategory(i, context)).filter(Boolean);
  const costCentres = (costCentresRes.items || []).map((i) => normalizeCanonicalCostCentre(i, context)).filter(Boolean);
  const currencies = (currenciesRes.items || []).map((i) => normalizeCanonicalCurrency(i, context)).filter(Boolean);
  const units = (unitsRes.items || []).map((i) => normalizeCanonicalUnit(i, context)).filter(Boolean);
  const stockGroups = (stockGroupsRes.items || []).map((i) => normalizeCanonicalStockGroup(i, context)).filter(Boolean);
  const stockCategories = (stockCategoriesRes.items || []).map((i) => normalizeCanonicalStockCategory(i, context)).filter(Boolean);
  const stockItems = (stockItemsRes.items || []).map((i) => normalizeCanonicalStockItem(i, context)).filter(Boolean);
  const godowns = (godownsRes.items || []).map((i) => normalizeCanonicalGodown(i, context)).filter(Boolean);

  const rawCounts = {
    groups: groupsRes.rawCount,
    ledgers: ledgersRes.rawCount,
    voucherTypes: voucherTypesRes.rawCount,
    costCategories: costCategoriesRes.rawCount,
    costCentres: costCentresRes.rawCount,
    currencies: currenciesRes.rawCount,
    units: unitsRes.rawCount,
    stockGroups: stockGroupsRes.rawCount,
    stockCategories: stockCategoriesRes.rawCount,
    stockItems: stockItemsRes.rawCount,
    godowns: godownsRes.rawCount
  };

  const canonicalMasters = {
    company,
    groups,
    ledgers,
    voucherTypes,
    costCategories,
    costCentres,
    currencies,
    units,
    stockGroups,
    stockCategories,
    stockItems,
    godowns
  };

  // Master counts summary
  const summaryCounts = {
    companies: 1,
    groups: groups.length,
    ledgers: ledgers.length,
    ledgersWithBillWise: ledgers.filter((l) => l.billWise && l.billWise.enabled).length,
    voucherTypes: voucherTypes.length,
    costCategories: costCategories.length,
    costCentres: costCentres.length,
    currencies: currencies.length,
    units: units.length,
    stockGroups: stockGroups.length,
    stockCategories: stockCategories.length,
    stockItems: stockItems.length,
    godowns: godowns.length
  };

  // 4. Capability Manifest
  const capabilityManifest = buildCapabilityManifest(company, summaryCounts);

  // 5. Field Coverage
  const fieldCoverage = calculateFieldCoverage(canonicalMasters);

  // 6. Reconciliation
  const reconciliation = reconcileMasters(rawCounts, canonicalMasters);

  // Global Checksum of extraction
  const datasetChecksum = recordChecksum({
    companyChecksum: company ? company.checksum : "",
    summaryCounts,
    groupChecksums: groups.map((g) => g.checksum),
    ledgerChecksums: ledgers.map((l) => l.checksum),
    voucherChecksums: voucherTypes.map((v) => v.checksum)
  });

  return {
    success: true,
    extractionRunId,
    timestamp: new Date().toISOString(),
    datasetChecksum,
    company,
    masterCounts: summaryCounts,
    rawCounts,
    masters: canonicalMasters,
    capabilityManifest,
    fieldCoverage,
    reconciliation
  };
}

module.exports = {
  fetchCollection,
  extractAllMasters
};
