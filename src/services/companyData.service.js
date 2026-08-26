/**
 * Company-scoped Tally domain data.
 *
 * Every function here takes a resolved company and returns canonical records
 * for that company only. Modules are loaded on demand — opening a company never
 * pulls vouchers, ledger transactions or inventory movement.
 *
 * Nothing in this file invents data: a domain that Tally does not expose comes
 * back as unavailable with a reason.
 */

const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const {
  buildLedgersRequest,
  buildGroupsRequest,
  buildStockItemsRequest,
  buildStockGroupsRequest,
  buildStockCategoriesRequest,
  buildUnitsRequest,
  buildGodownsRequest,
  buildCostCentresRequest,
  buildCostCategoriesRequest,
  buildVoucherTypesRequest,
  buildCurrenciesRequest,
  buildVouchersRequest
} = require("../integrations/tally/tally.requests");
const { buildSalesLedgerRequest } = require("../integrations/tally/sales/sales.requests");
const { normalizeCanonicalLedger, normalizeCanonicalGroup } = require("../integrations/tally/canonical/accounting.canonical");
const {
  normalizeCanonicalStockItem,
  normalizeCanonicalStockGroup,
  normalizeCanonicalStockCategory,
  normalizeCanonicalGodown
} = require("../integrations/tally/canonical/inventory.canonical");
const { normalizeCanonicalCostCentre, normalizeCanonicalCostCategory } = require("../integrations/tally/canonical/dimensions.canonical");
const { normalizeCanonicalVoucherType } = require("../integrations/tally/canonical/voucherType.canonical");
const { normalizeCanonicalCurrency, normalizeCanonicalUnit } = require("../integrations/tally/canonical/currency.canonical");
const { normalizeSalesVoucher } = require("../integrations/tally/sales/salesVoucher.canonical");
const { nameKey } = require("../integrations/tally/sales/factSales.builder");
const { parseCity } = require("../integrations/tally/sales/city.parser");
const { Decimal, toDecimal, toDecimalString } = require("../utils/financialDecimal");
const { cached, paginate, isCompanyStillOpen, DEFAULT_TTL_MS } = require("./companyScope.service");
const mirror = require("./sync/mirror.service");
const env = require("../config/env");
const { ingestionError, classifyTransportFailure, INGESTION_ERROR_CODES } = require("../integrations/tally/sales/factSales.errors");
const {
  createVoucherTypeResolver,
  runAccountingAnalysis,
  reconcileVoucherWithTally,
  generateReconciliationReport
} = require("../integrations/tally/canonical/accountingAnalysis.engine");
const { buildFactSales } = require("../integrations/tally/sales/factSales.builder");
const { generateMisReport5 } = require("../integrations/tally/sales/misReport5/misReport5.engine");

/**
 * Run one read-only extraction for a company and normalize the collection.
 * Returns { available, records, reason } — never throws into a controller.
 */
async function extract(company, { builder, normalize, source, extraArgs = [] }) {
  // HARD SAFETY GATE. Sending SVCURRENTCOMPANY for a company that is not
  // currently loaded crashes TallyPrime outright (verified: the process died
  // and restarted). A stale cache entry must never be able to do that.
  if (!(await isCompanyStillOpen(company))) {
    return {
      available: false,
      records: [],
      reason: ingestionError(INGESTION_ERROR_CODES.TALLY_COMPANY_NOT_FOUND, {
        companyId: company.companyId,
        source,
        stage: "guard",
        message: `Company "${company.name}" is no longer open in TallyPrime. Open it in Tally and retry.`
      })
    };
  }

  const xml = builder(company.name, ...extraArgs);
  let transportResult;
  try {
    transportResult = await sendXmlRequest({ xml });
  } catch (error) {
    return {
      available: false,
      records: [],
      reason: ingestionError(INGESTION_ERROR_CODES.TALLY_CONNECTION_FAILED, {
        companyId: company.companyId, source, stage: "extract", message: error.message
      })
    };
  }

  if (!transportResult.success) {
    return {
      available: false,
      records: [],
      reason: ingestionError(classifyTransportFailure(transportResult), {
        companyId: company.companyId, source, stage: "extract",
        message: transportResult.errorMessage || "Extraction failed"
      })
    };
  }

  const parsed = transportResult.parsedResponse;
  if (!parsed || !parsed.success) {
    return {
      available: false,
      records: [],
      reason: ingestionError(INGESTION_ERROR_CODES.TALLY_XML_PARSE_ERROR, {
        companyId: company.companyId, source, stage: "parse",
        message: (parsed && (parsed.error || parsed.lineError)) || "Unparseable response"
      })
    };
  }

  const context = { sourceCompanyId: company.companyId };
  const records = (parsed.collection || [])
    .map((node) => {
      try { return normalize(node, context); } catch (e) { return null; }
    })
    .filter(Boolean);

  return {
    available: true,
    records,
    fetchedAt: new Date().toISOString(),
    responseTimeMs: transportResult.responseTimeMs
  };
}

/** Domain registry. Adding a module here exposes it everywhere consistently. */
const DOMAINS = {
  ledgers: { builder: buildSalesLedgerRequest, normalize: normalizeCanonicalLedger, source: "ledgerMaster" },
  groups: { builder: buildGroupsRequest, normalize: normalizeCanonicalGroup, source: "groupMaster" },
  stockItems: { builder: buildStockItemsRequest, normalize: normalizeCanonicalStockItem, source: "stockItemMaster" },
  stockGroups: { builder: buildStockGroupsRequest, normalize: normalizeCanonicalStockGroup, source: "stockGroupMaster" },
  stockCategories: { builder: buildStockCategoriesRequest, normalize: normalizeCanonicalStockCategory, source: "stockCategoryMaster" },
  units: { builder: buildUnitsRequest, normalize: normalizeCanonicalUnit, source: "unitMaster" },
  godowns: { builder: buildGodownsRequest, normalize: normalizeCanonicalGodown, source: "godownMaster" },
  costCentres: { builder: buildCostCentresRequest, normalize: normalizeCanonicalCostCentre, source: "costCentreMaster" },
  costCategories: { builder: buildCostCategoriesRequest, normalize: normalizeCanonicalCostCategory, source: "costCategoryMaster" },
  voucherTypes: { builder: buildVoucherTypesRequest, normalize: normalizeCanonicalVoucherType, source: "voucherTypeMaster" },
  currencies: { builder: buildCurrenciesRequest, normalize: normalizeCanonicalCurrency, source: "currencyMaster" }
};

/**
 * Fetch one registered domain for a company, cached briefly.
 * @param {object} company Resolved company
 * @param {string} domain Key of DOMAINS
 */
async function getDomain(company, domain, { bypassMirror = false } = {}) {
  const config = DOMAINS[domain];
  if (!config) throw new Error(`Unknown domain: ${domain}`);

  // DB-first. The local mirror answers when it actually holds this company's
  // domain; otherwise readDomain returns null and the live extraction path
  // below runs exactly as it did before the mirror existed. The sync engine
  // passes bypassMirror so filling the mirror never reads from it.
  if (!bypassMirror) {
    const mirrored = await mirror.readDomain(company.companyId, domain);
    if (mirrored) return mirrored;
  }

  const res = await cached(`${company.companyId}::${domain}`, () => extract(company, config), DEFAULT_TTL_MS, { allowStale: true });
  if (res && res.available) return res;

  const mirroredFallback = await mirror.readDomain(company.companyId, domain);
  if (mirroredFallback) return mirroredFallback;

  return res || { available: true, records: [], source: "mirror", fetchedAt: new Date().toISOString() };
}

/**
 * Fetch vouchers for a company, optionally filtered by type and date range.
 * Vouchers are never fetched as part of the overview.
 */
/** ISO yyyy-mm-dd -> Tally yyyymmdd. */
function toTallyCompact(isoDate) {
  if (!isoDate) return null;
  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

async function getVouchers(company, { fromDate, toDate, includeEntries = false, bypassMirror = false } = {}) {
  // With no period Tally serves only its current period, which hides most of
  // the history. Default to the company's own books-from date so the register
  // covers everything the company actually holds.
  const effectiveFrom = fromDate || toTallyCompact(company.startingAt);
  // Cache key carries company, date range and shape so a light list can never
  // be served where entries were requested, nor shared across companies.
  const key = `${company.companyId}::vouchers::${effectiveFrom || "*"}::${toDate || "*"}::${includeEntries ? "full" : "light"}`;

  const mirrorHasShape = !includeEntries || env.sync.voucherEntries;
  if (!bypassMirror && mirrorHasShape) {
    const mirrored = await mirror.readVouchers(company.companyId, { fromDate: effectiveFrom, toDate });
    if (mirrored) return mirrored;
  }
  const res = await cached(key, async () => {
    const fullResult = await extract(company, {
      builder: (name) => buildVouchersRequest(name, effectiveFrom || null, toDate || null, {
        includeLedgerEntries: includeEntries,
        includeInventoryEntries: includeEntries
      }),
      normalize: (node) => normalizeSalesVoucher(node, {
        companyId: company.companyId,
        companyGuid: company.guid || null
      }),
      source: "voucherRegister"
    });

    if (!fullResult.available && includeEntries) {
      const lightResult = await extract(company, {
        builder: (name) => buildVouchersRequest(name, effectiveFrom || null, toDate || null, {
          includeLedgerEntries: false,
          includeInventoryEntries: false
        }),
        normalize: (node) => normalizeSalesVoucher(node, {
          companyId: company.companyId,
          companyGuid: company.guid || null
        }),
        source: "voucherRegister"
      });
      if (lightResult.available) {
        return { ...lightResult, partial: true };
      }
    }

    if (!fullResult.available) {
      const mirrored = await mirror.readVouchers(company.companyId, { fromDate: effectiveFrom, toDate });
      if (mirrored) return mirrored;
    }

    return fullResult;
  }, DEFAULT_TTL_MS, { allowStale: true });

  if (res && res.available) return res;

  const mirroredFallback = await mirror.readVouchers(company.companyId, { fromDate: effectiveFrom, toDate });
  if (mirroredFallback) return mirroredFallback;

  return res || { available: true, records: [], source: "mirror", fetchedAt: new Date().toISOString() };
}

/**
 * Fetch one voucher with its nested entries.
 *
 * Finds the voucher in the light register first, then re-requests only its own
 * date as a one-day window. Pulling the full register with entries would be
 * megabytes of XML for a single record and can stall Tally.
 */
async function getVoucherById(company, voucherId) {
  const register = await getVouchers(company, {});
  if (!register.available) return { available: false, reason: register.reason, voucher: null };

  const summary = register.records.find((v) => v.sourceVoucherId === voucherId);
  if (!summary) return { available: true, voucher: null, notFound: true };

  const day = toTallyCompact(summary.voucherDate);
  if (!day) return { available: true, voucher: summary, partial: true };

  // One-day window keeps the detail request small.
  const detailed = await getVouchers(company, { fromDate: day, toDate: day, includeEntries: true });
  if (!detailed.available) return { available: false, reason: detailed.reason, voucher: null };

  const full = detailed.records.find((v) => v.sourceVoucherId === voucherId);
  return { available: true, voucher: full || summary, fetchedAt: detailed.fetchedAt };
}

/** A party with nothing resolved. Shared so callers never see undefined. */
const EMPTY_PARTY_PROFILE = Object.freeze({
  country: null, state: null, city: null, cityConfidence: "none"
});

/**
 * Resolve the geography of a voucher's party.
 *
 * Tally puts none of this on the voucher — it lives on the party ledger:
 * COUNTRYNAME and LEDSTATENAME are discrete fields and are read verbatim, while
 * City has no field of its own and is parsed from the free-text address by the
 * same heuristic FACT_SALES uses. The parse carries its own confidence and
 * returns null when it cannot tell, so a city is never invented.
 *
 * A ledger master that cannot be fetched yields empty profiles instead of
 * failing the register: the vouchers are still worth showing without geography.
 *
 * @returns {Promise<(partyName: string) => {country, state, city, cityConfidence}>}
 */
async function getPartyProfileResolver(company) {
  const ledgers = await getDomain(company, "ledgers");
  if (!ledgers.available) return () => EMPTY_PARTY_PROFILE;

  // Same normalized, company-scoped key the FACT_SALES join uses, so the two
  // never disagree about which ledger a party name refers to.
  const byName = new Map();
  for (const ledger of ledgers.records) {
    if (ledger.name) byName.set(nameKey(company.companyId, ledger.name), ledger);
  }

  // Each ledger's city is parsed once, not once per voucher line.
  const profiles = new Map();

  return (partyName) => {
    if (!partyName) return EMPTY_PARTY_PROFILE;
    const key = nameKey(company.companyId, partyName);
    if (profiles.has(key)) return profiles.get(key);

    const ledger = byName.get(key);
    if (!ledger) {
      profiles.set(key, EMPTY_PARTY_PROFILE);
      return EMPTY_PARTY_PROFILE;
    }

    const address = ledger.address || {};
    const state = address.stateName || null;
    const city = parseCity(address.lines, { knownState: state });
    const profile = {
      country: ledger.country || null,
      state,
      city: city.city || null,
      cityConfidence: city.confidence || "none"
    };
    profiles.set(key, profile);
    return profile;
  };
}

/**
 * The state alone, for callers that need nothing else.
 * @returns {Promise<(partyName: string) => string|null>}
 */
async function getPartyStateResolver(company) {
  const profileOf = await getPartyProfileResolver(company);
  return (partyName) => profileOf(partyName).state;
}

/** Party ledgers, split by the classification the canonical model already derives. */
async function getParties(company, kind) {
  const ledgers = await getDomain(company, "ledgers");
  if (!ledgers.available) return ledgers;
  const wanted = kind === "customers" ? "SUNDRY_DEBTOR" : "SUNDRY_CREDITOR";
  return { ...ledgers, records: ledgers.records.filter((l) => l.classification === wanted) };
}

/** Buckets for parties Tally holds no geography for. Never a guess. */
const NO_STATE_LABEL = "(no state)";
const NO_CITY_LABEL = "(no city)";
const NO_COUNTRY_LABEL = "(no country)";

/**
 * Voucher types that represent outward sales activity in Tally.
 *
 * SALES   : Outward supply invoice to customer → ADDS to gross sales.
 * CREDIT NOTE: Sales return from customer     → SUBTRACTS from net sales.
 *
 * NOTE: "Debit Note" is intentionally excluded here — in standard Tally
 * convention a Debit Note is a PURCHASE return (issued TO supplier), not a
 * sales-side document. Including it would inflate Sales figures.
 */
const SALES_VOUCHER_TYPES = new Set(["sales", "credit note"]);

/**
 * Voucher types that represent inward purchase activity in Tally.
 *
 * PURCHASE  : Inward supply invoice from supplier → ADDS to gross purchases.
 * DEBIT NOTE: Purchase return to supplier          → SUBTRACTS from net purchases.
 *
 * NOTE: "Credit Note" is intentionally excluded here — in standard Tally
 * convention a Credit Note is a SALES return document, not a purchase-side
 * document. Including it would inflate Purchase figures.
 */
const PURCHASE_VOUCHER_TYPES = new Set(["purchase", "debit note"]);

/** yyyy-mm -> "Apr 2024", ordered by the key so the axis never needs sorting twice. */
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthKeyOf(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function monthLabelOf(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

/** Accumulate into a keyed bucket without letting a missing key vanish silently. */
function bucket(map, key, seed) {
  if (!map.has(key)) map.set(key, { ...seed });
  return map.get(key);
}

/**
 * The distinct values the filters can offer, drawn from the data itself so a
 * dropdown never lists something that would return nothing.
 */
function collectFilterOptions(vouchers, partyOf) {
  const parties = new Set();
  const products = new Set();
  const countries = new Set();
  const states = new Set();
  const cities = new Set();

  for (const voucher of vouchers) {
    if (voucher.partyLedgerName) parties.add(voucher.partyLedgerName);
    const party = partyOf(voucher.partyLedgerName);
    countries.add(party.country || NO_COUNTRY_LABEL);
    states.add(party.state || NO_STATE_LABEL);
    cities.add(party.city || NO_CITY_LABEL);
    for (const line of voucher.inventoryEntries || []) {
      if (line.stockItemName) products.add(line.stockItemName);
    }
  }

  const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b));
  return {
    customers: sorted(parties),
    suppliers: sorted(parties),
    products: sorted(products),
    countries: sorted(countries),
    states: sorted(states),
    cities: sorted(cities)
  };
}

/**
 * How much of a ranking travels to the client in full.
 *
 * The leaders drive the charts, but the page also lets the reader page through
 * the tail, and doing that from data already in hand beats a round trip per
 * page. The cap is what stops a company with thousands of stock items from
 * turning one response into megabytes — past it the tail is still counted and
 * still reported, just not enumerated.
 */
const RANKED_LIST_CAP = 500;

/** Sort by amount, take the top N, and report what the remainder holds. */
function rank(entries, limit) {
  const sorted = entries.sort((a, b) => Number(b.amount) - Number(a.amount));
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  return {
    top,
    // The whole ranking, so the page can chart the leaders and still page
    // through the rest without asking again. `top` is its prefix.
    all: sorted.slice(0, RANKED_LIST_CAP),
    // Distinct entries before the cap, so a truncated list still reports its
    // real size rather than the number of rows that happened to fit.
    totalCount: sorted.length,
    listTruncated: sorted.length > RANKED_LIST_CAP,
    otherCount: rest.length,
    otherAmount: toDecimalString(rest.reduce((sum, e) => sum.plus(toDecimal(e.amount)), new Decimal(0)))
  };
}

/**
 * Resolves a voucher type name to its Tally parent class or core accounting type.
 *
 * In Tally, companies create custom voucher types that inherit from one of the
 * system voucher types ("Sales", "Purchase", "Credit Note", "Debit Note", etc.).
 *
 * This resolver uses hierarchy traversal and core classification from accountingAnalysis.engine.
 *
 * @returns {Promise<(voucherTypeName: string) => string>}
 */
async function getVoucherTypeResolver(company) {
  const domain = await getDomain(company, "voucherTypes");
  const records = domain.available && Array.isArray(domain.records) ? domain.records : [];
  return createVoucherTypeResolver(records);
}

/**
 * Sales analysis for one company.
 *
 * Built on the voucher register and computed via the symmetrical accounting analysis engine.
 * Full precision Decimal.js arithmetic, multi-company isolated, supports both Item and
 * Accounting invoices, detailed GST/tax breakdown, and Credit Note reversals.
 */
async function getSalesAnalysis(company, options = {}) {
  const register = await getVouchers(company, {
    fromDate: options.fromDate,
    toDate: options.toDate,
    includeEntries: true
  });
  if (!register.available) return { available: false, reason: register.reason };

  const [ledgerRes, itemRes, groupRes, ccRes, partyOf, voucherTypeResolver] = await Promise.all([
    getDomain(company, "ledgers"),
    getDomain(company, "stockItems"),
    getDomain(company, "stockGroups"),
    getDomain(company, "costCentres"),
    getPartyProfileResolver(company),
    getVoucherTypeResolver(company)
  ]);

  const analysis = runAccountingAnalysis({
    vouchers: register.records,
    company,
    direction: "SALES",
    options,
    partyOf,
    voucherTypeResolver,
    fetchedAt: register.fetchedAt,
    syncedAt: register.syncedAt
  });

  // Attach the 16-Filter Owner-POV Analytical Suite directly into Sales Analysis payload
  try {
    const factResult = buildFactSales({
      companyId: company.companyId,
      companyGuid: company.guid || null,
      salesVouchers: register.records || [],
      ledgers: (ledgerRes && ledgerRes.records) || [],
      stockItems: (itemRes && itemRes.records) || [],
      stockGroups: (groupRes && groupRes.records) || [],
      costCentres: (ccRes && ccRes.records) || [],
      costCentresEnabled: ccRes && ccRes.available
    });

    analysis.misReport5 = generateMisReport5({
      factSalesRows: factResult.rows || [],
      options
    });
  } catch (e) {
    analysis.misReport5 = null;
  }

  return analysis;
}

/**
 * Purchase analysis for one company.
 *
 * Built on the voucher register and computed via the symmetrical accounting analysis engine.
 * Full precision Decimal.js arithmetic, multi-company isolated, supports both Item and
 * Accounting invoices, detailed GST/tax breakdown, and Debit Note reversals.
 */
async function getPurchaseAnalysis(company, options = {}) {
  const register = await getVouchers(company, {
    fromDate: options.fromDate,
    toDate: options.toDate,
    includeEntries: true
  });
  if (!register.available) return { available: false, reason: register.reason };

  const partyOf = await getPartyProfileResolver(company);
  const voucherTypeResolver = await getVoucherTypeResolver(company);

  return runAccountingAnalysis({
    vouchers: register.records,
    company,
    direction: "PURCHASE",
    options,
    partyOf,
    voucherTypeResolver,
    fetchedAt: register.fetchedAt,
    syncedAt: register.syncedAt
  });
}

/**
 * Full End-to-End Reconciliation Report comparing Tally source data and CFO Yantra calculations.
 */
async function getReconciliationReport(company, options = {}) {
  const register = await getVouchers(company, {
    fromDate: options.fromDate,
    toDate: options.toDate,
    includeEntries: true
  });
  if (!register.available) return { available: false, reason: register.reason };

  const partyOf = await getPartyProfileResolver(company);
  const voucherTypeResolver = await getVoucherTypeResolver(company);

  return generateReconciliationReport({
    company,
    fromDate: options.fromDate,
    toDate: options.toDate,
    vouchers: register.records,
    voucherTypeResolver,
    partyOf
  });
}

/**
 * Owner-POV 16-Filter MIS Report #5 (SubCategory x City x Month).
 */
async function getMisReport5(company, options = {}) {
  const [voucherRes, ledgerRes, itemRes, groupRes, ccRes] = await Promise.all([
    getVouchers(company, { fromDate: options.fromDate, toDate: options.toDate, includeEntries: true }),
    getDomain(company, "ledgers"),
    getDomain(company, "stockItems"),
    getDomain(company, "stockGroups"),
    getDomain(company, "costCentres")
  ]);

  if (!voucherRes.available) return { available: false, reason: voucherRes.reason };

  const factResult = buildFactSales({
    companyId: company.companyId,
    companyGuid: company.guid || null,
    salesVouchers: voucherRes.records || [],
    ledgers: (ledgerRes && ledgerRes.records) || [],
    stockItems: (itemRes && itemRes.records) || [],
    stockGroups: (groupRes && groupRes.records) || [],
    costCentres: (ccRes && ccRes.records) || [],
    costCentresEnabled: ccRes && ccRes.available
  });

  const report = generateMisReport5({
    factSalesRows: factResult.rows || [],
    options
  });

  return {
    available: true,
    companyId: company.companyId,
    companyName: company.name,
    ...report
  };
}

/**
 * Company overview: identity plus record counts.
 * Counts come from actual extractions — a domain that failed reports null,
 * never zero, so "no data" is never confused with "not fetched".
 */
async function getOverview(company) {
  const domains = ["ledgers", "groups", "stockItems", "stockGroups", "costCentres", "voucherTypes", "godowns", "units"];

  // Sequential, not Promise.all: TallyPrime is a single-threaded desktop app and
  // eight concurrent collection queries is enough to stall it. Each result is
  // cached, so the tabs that follow do not pay this cost again.
  const results = [];
  for (const domain of domains) {
    results.push(await getDomain(company, domain));
  }

  const counts = {};
  const unavailable = {};
  domains.forEach((domain, index) => {
    const result = results[index];
    counts[domain] = result.available ? result.records.length : null;
    if (!result.available) unavailable[domain] = result.reason;
  });

  const ledgers = results[0].available ? results[0].records : [];
  return {
    company: {
      companyId: company.companyId,
      companyGuid: company.guid || null,
      companyName: company.name,
      startingAt: company.startingAt || null,
      masterId: company.masterId || null
    },
    counts,
    unavailable,
    parties: {
      customers: ledgers.filter((l) => l.classification === "SUNDRY_DEBTOR").length,
      suppliers: ledgers.filter((l) => l.classification === "SUNDRY_CREDITOR").length
    },
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Build the stock group hierarchy from the flat Tally master.
 * Groups whose parent is missing or "Primary" become roots.
 */
function buildStockGroupTree(stockGroups, stockItems = []) {
  const byName = new Map(stockGroups.map((g) => [g.name, { ...g, children: [], items: [] }]));

  for (const item of stockItems) {
    const parent = byName.get(item.parent);
    if (parent) parent.items.push({ sourceObjectId: item.sourceObjectId, name: item.name });
  }

  const roots = [];
  for (const node of byName.values()) {
    const parent = node.parent && node.parent !== "Primary" ? byName.get(node.parent) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Which modules this company can actually serve, and why not when it cannot.
 * Drives the UI so a tab is never shown promising data that does not exist.
 */
async function getCapabilityMap(company) {
  const overview = await getOverview(company);
  const has = (domain) => overview.counts[domain] !== null && overview.counts[domain] > 0;

  return {
    masters: { available: has("ledgers"), reason: has("ledgers") ? null : "No ledger master returned by Tally" },
    ledgers: { available: has("ledgers"), reason: has("ledgers") ? null : "No ledger master returned by Tally" },
    stockItems: { available: has("stockItems"), reason: has("stockItems") ? null : "This company has no stock items" },
    stockGroups: { available: has("stockGroups"), reason: has("stockGroups") ? null : "This company defines no stock groups" },
    inventory: { available: has("stockItems"), reason: has("stockItems") ? null : "Inventory is not in use for this company" },
    costCentres: { available: has("costCentres"), reason: has("costCentres") ? null : "Cost centres are not enabled for this company" },
    // Salesman depends entirely on cost centre tagging.
    salesman: { available: has("costCentres"), reason: has("costCentres") ? null : "Cost centres are not enabled, so Salesman cannot be resolved" },
    vouchers: { available: true, reason: null },
    accounting: { available: has("groups"), reason: has("groups") ? null : "No account groups returned by Tally" }
  };
}

module.exports = {
  DOMAINS,
  extract,
  getDomain,
  getVouchers,
  getVoucherById,
  getPartyStateResolver,
  getPartyProfileResolver,
  getSalesAnalysis,
  getPurchaseAnalysis,
  getReconciliationReport,
  getMisReport5,
  getVoucherTypeResolver,
  getParties,
  getOverview,
  getCapabilityMap,
  buildStockGroupTree,
  paginate
};
