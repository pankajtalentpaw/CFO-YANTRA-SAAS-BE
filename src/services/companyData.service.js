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
const { cached, paginate, isCompanyStillOpen } = require("./companyScope.service");
const mirror = require("./sync/mirror.service");
const env = require("../config/env");
const { ingestionError, classifyTransportFailure, INGESTION_ERROR_CODES } = require("../integrations/tally/sales/factSales.errors");

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

  return cached(`${company.companyId}::${domain}`, () => extract(company, config));
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

  // DB-first, but only for the register shape the mirror actually stores.
  // Serving a light mirror where ledger/inventory entries were asked for would
  // silently hand back a thinner record, so that case goes to Tally.
  if (!bypassMirror && includeEntries === env.sync.voucherEntries) {
    const mirrored = await mirror.readVouchers(company.companyId, { fromDate: effectiveFrom, toDate });
    if (mirrored) return mirrored;
  }
  return cached(key, () =>
    extract(company, {
      // Entries are opt-in: the plain register is the default, lighter and
      // proven safe against the live Tally instance.
      builder: (name) => buildVouchersRequest(name, effectiveFrom || null, toDate || null, {
        includeLedgerEntries: includeEntries,
        includeInventoryEntries: includeEntries
      }),
      normalize: (node) => normalizeSalesVoucher(node, {
        companyId: company.companyId,
        companyGuid: company.guid || null
      }),
      source: "voucherRegister"
    })
  );
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

/** Voucher types that represent outward sales in Tally. */
const SALES_VOUCHER_TYPES = new Set(["sales", "credit note", "debit note"]);

/** Voucher types that represent inward purchases in Tally. */
const PURCHASE_VOUCHER_TYPES = new Set(["purchase", "debit note", "credit note"]);

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
 * Sales analysis for one company.
 *
 * Built on the voucher register, which is already cached and which a live Tally
 * answers in well under a second — no second extraction is triggered for this
 * page. Cancelled vouchers are excluded; nothing is estimated.
 *
 * Two different money columns are reported deliberately and never mixed:
 *
 *   invoicedValue - the voucher total, which includes GST and any ledger-level
 *                   charges. This is what the customer was billed.
 *   itemValue     - the sum of the stock line amounts, which excludes tax.
 *
 * They do not add up to each other, and pretending otherwise would misstate
 * revenue. Item breakdowns can only use itemValue, because tax sits on the
 * voucher, not on the line.
 */
async function getSalesAnalysis(company, options = {}) {
  const { fromDate, toDate, topN = 8, customer, product, country, state, city, search } = options;

  const register = await getVouchers(company, { fromDate, toDate });
  if (!register.available) return { available: false, reason: register.reason };

  const partyOf = await getPartyProfileResolver(company);

  const inPeriod = register.records.filter(
    (v) => !v.isCancelled && SALES_VOUCHER_TYPES.has(String(v.voucherType || "").toLowerCase())
  );

  // Options are offered from the period alone, never from the narrowed set, so
  // choosing one filter can never make the others disappear.
  const filterOptions = collectFilterOptions(inPeriod, partyOf);

  // Two filter grains, applied in order:
  //   voucher-level (customer, geography) selects whole invoices;
  //   line-level (product, search) selects stock lines inside them.
  // An invoice survives only if a line of it does, so the invoice count and the
  // item breakdown always describe the same set of sales.
  const wantsLineFilter = Boolean(product || search);
  const needle = search ? String(search).trim().toLowerCase() : null;

  const sales = inPeriod
    .filter((voucher) => {
      const party = partyOf(voucher.partyLedgerName);
      if (customer && voucher.partyLedgerName !== customer) return false;
      if (country && party.country !== country) return false;
      if (state && (party.state || NO_STATE_LABEL) !== state) return false;
      if (city && (party.city || NO_CITY_LABEL) !== city) return false;
      return true;
    })
    .map((voucher) => {
      if (!wantsLineFilter) return voucher;
      const party = partyOf(voucher.partyLedgerName);
      const lines = (voucher.inventoryEntries || []).filter((line) => {
        if (product && line.stockItemName !== product) return false;
        if (!needle) return true;
        return [
          voucher.sourceVoucherNumber, voucher.partyLedgerName, line.stockItemName,
          party.country, party.state, party.city
        ].some((field) => String(field || "").toLowerCase().includes(needle));
      });
      // Rebuilt shallowly: the register's cached records must not be mutated.
      return { ...voucher, inventoryEntries: lines };
    })
    // A product or search filter is about stock lines, so an invoice with none
    // left is no longer part of the answer.
    .filter((voucher) => !wantsLineFilter || voucher.inventoryEntries.length > 0);

  const byMonth = new Map();
  const byCustomer = new Map();
  const byItem = new Map();
  const byState = new Map();
  const byCity = new Map();

  let invoicedValue = new Decimal(0);
  let itemValue = new Decimal(0);
  let itemQuantity = 0;
  let vouchersWithoutItems = 0;
  // One row per stock line — the grain the detail table is drawn at.
  const rows = [];

  for (const voucher of sales) {
    const amount = toDecimal(voucher.amount || 0);
    invoicedValue = invoicedValue.plus(amount);

    const monthKey = monthKeyOf(voucher.voucherDate);
    if (monthKey) {
      const month = bucket(byMonth, monthKey, { monthKey, label: monthLabelOf(monthKey), amount: "0", invoices: 0 });
      month.amount = toDecimalString(toDecimal(month.amount).plus(amount));
      month.invoices += 1;
    }

    const party = partyOf(voucher.partyLedgerName);
    const customerName = voucher.partyLedgerName || "(no party)";
    const customer = bucket(byCustomer, customerName, {
      name: customerName, state: party.state, city: party.city, country: party.country, amount: "0", invoices: 0
    });
    customer.amount = toDecimalString(toDecimal(customer.amount).plus(amount));
    customer.invoices += 1;

    // A party Tally holds no state for is grouped as unknown, never guessed.
    const stateName = party.state || NO_STATE_LABEL;
    const state = bucket(byState, stateName, { name: stateName, amount: "0", invoices: 0 });
    state.amount = toDecimalString(toDecimal(state.amount).plus(amount));
    state.invoices += 1;

    // City is a parse of the ledger's free-text address, not a field Tally
    // holds, so the confidence the parser reported travels with the bucket —
    // a city read out of an address line is not the same fact as a state.
    const cityName = party.city || NO_CITY_LABEL;
    const cityBucket = bucket(byCity, cityName, {
      name: cityName, state: party.state, confidence: party.cityConfidence, amount: "0", invoices: 0
    });
    cityBucket.amount = toDecimalString(toDecimal(cityBucket.amount).plus(amount));
    cityBucket.invoices += 1;
    // One city name reached by two different confidences is only as good as
    // its weakest read.
    if (party.cityConfidence === "low" || party.cityConfidence === "none") {
      cityBucket.confidence = party.cityConfidence;
    }

    const lines = voucher.inventoryEntries || [];
    if (lines.length === 0) vouchersWithoutItems += 1;

    for (const line of lines) {
      const lineAmount = toDecimal(line.amount || 0);
      itemValue = itemValue.plus(lineAmount);
      if (typeof line.quantity === "number") itemQuantity += line.quantity;

      rows.push({
        date: voucher.voucherDate,
        voucherNumber: voucher.sourceVoucherNumber,
        voucherType: voucher.voucherType,
        customer: voucher.partyLedgerName,
        product: line.stockItemName,
        quantity: line.quantity,
        unit: line.unit || null,
        country: party.country,
        state: party.state,
        city: party.city,
        // The stock line's own value. Tax sits on the voucher, not the line,
        // so this is the sales value excluding tax.
        amount: toDecimalString(lineAmount)
      });

      const item = bucket(byItem, line.stockItemName, {
        name: line.stockItemName, unit: line.unit || null, amount: "0", quantity: 0, invoices: 0
      });
      item.amount = toDecimalString(toDecimal(item.amount).plus(lineAmount));
      if (typeof line.quantity === "number") item.quantity += line.quantity;
      item.invoices += 1;
      // Mixed units cannot be summed into one figure.
      if (item.unit && line.unit && item.unit !== line.unit) item.unit = null;
    }
  }

  const months = [...byMonth.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const invoiceCount = sales.length;

  // Newest first, and stable within a day so paging never reshuffles a page.
  rows.sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(b.voucherNumber || "").localeCompare(String(a.voucherNumber || ""))
  );

  return {
    available: true,
    fetchedAt: register.fetchedAt,
    filterOptions,
    appliedFilters: {
      customer: customer || null, product: product || null, country: country || null,
      state: state || null, city: city || null, search: search || null
    },
    // True when invoice totals cover whole invoices that merely contain the
    // filtered lines — the caller should say so rather than imply otherwise.
    invoiceTotalsSpanWholeInvoice: wantsLineFilter,
    totals: {
      invoicedValue: toDecimalString(invoicedValue),
      itemValue: toDecimalString(itemValue),
      invoiceCount,
      itemQuantity: Number(itemQuantity.toFixed(3)),
      averageInvoiceValue: invoiceCount ? toDecimalString(invoicedValue.dividedBy(invoiceCount)) : "0.00",
      customerCount: byCustomer.size,
      itemCount: byItem.size,
      // Vouchers Tally returned no stock lines for. Their value is in
      // invoicedValue but cannot appear in any item breakdown.
      vouchersWithoutItems
    },
    months,
    rows,
    customers: rank([...byCustomer.values()], topN),
    items: rank([...byItem.values()], topN),
    states: rank([...byState.values()], topN),
    cities: rank([...byCity.values()], topN),
    // The period actually covered, taken from the data rather than the request.
    period: {
      from: months.length ? months[0].monthKey : null,
      to: months.length ? months[months.length - 1].monthKey : null
    }
  };
}

/**
 * Purchase analysis for one company.
 *
 * Built on the cached voucher register. Inward purchase vouchers are aggregated
 * by month, supplier, stock item, state and city.
 */
async function getPurchaseAnalysis(company, options = {}) {
  const { fromDate, toDate, topN = 8, supplier, product, country, state, city, search } = options;

  const register = await getVouchers(company, { fromDate, toDate });
  if (!register.available) return { available: false, reason: register.reason };

  const partyOf = await getPartyProfileResolver(company);

  const inPeriod = register.records.filter(
    (v) => !v.isCancelled && PURCHASE_VOUCHER_TYPES.has(String(v.voucherType || "").toLowerCase())
  );

  const filterOptions = collectFilterOptions(inPeriod, partyOf);

  const wantsLineFilter = Boolean(product || search);
  const needle = search ? String(search).trim().toLowerCase() : null;

  const purchases = inPeriod
    .filter((voucher) => {
      const party = partyOf(voucher.partyLedgerName);
      if (supplier && voucher.partyLedgerName !== supplier) return false;
      if (country && party.country !== country) return false;
      if (state && (party.state || NO_STATE_LABEL) !== state) return false;
      if (city && (party.city || NO_CITY_LABEL) !== city) return false;
      return true;
    })
    .map((voucher) => {
      if (!wantsLineFilter) return voucher;
      const party = partyOf(voucher.partyLedgerName);
      const lines = (voucher.inventoryEntries || []).filter((line) => {
        if (product && line.stockItemName !== product) return false;
        if (!needle) return true;
        return [
          voucher.sourceVoucherNumber, voucher.partyLedgerName, line.stockItemName,
          party.country, party.state, party.city
        ].some((field) => String(field || "").toLowerCase().includes(needle));
      });
      return { ...voucher, inventoryEntries: lines };
    })
    .filter((voucher) => !wantsLineFilter || voucher.inventoryEntries.length > 0);

  const byMonth = new Map();
  const bySupplier = new Map();
  const byItem = new Map();
  const byState = new Map();
  const byCity = new Map();

  let invoicedValue = new Decimal(0);
  let itemValue = new Decimal(0);
  let itemQuantity = 0;
  let vouchersWithoutItems = 0;
  const rows = [];

  for (const voucher of purchases) {
    const amount = toDecimal(voucher.amount || 0);
    invoicedValue = invoicedValue.plus(amount);

    const monthKey = monthKeyOf(voucher.voucherDate);
    if (monthKey) {
      const month = bucket(byMonth, monthKey, { monthKey, label: monthLabelOf(monthKey), amount: "0", invoices: 0 });
      month.amount = toDecimalString(toDecimal(month.amount).plus(amount));
      month.invoices += 1;
    }

    const party = partyOf(voucher.partyLedgerName);
    const supplierName = voucher.partyLedgerName || "(no party)";
    const supp = bucket(bySupplier, supplierName, {
      name: supplierName, state: party.state, city: party.city, country: party.country, amount: "0", invoices: 0
    });
    supp.amount = toDecimalString(toDecimal(supp.amount).plus(amount));
    supp.invoices += 1;

    const stateName = party.state || NO_STATE_LABEL;
    const stateBucket = bucket(byState, stateName, { name: stateName, amount: "0", invoices: 0 });
    stateBucket.amount = toDecimalString(toDecimal(stateBucket.amount).plus(amount));
    stateBucket.invoices += 1;

    const cityName = party.city || NO_CITY_LABEL;
    const cityBucket = bucket(byCity, cityName, {
      name: cityName, state: party.state, confidence: party.cityConfidence, amount: "0", invoices: 0
    });
    cityBucket.amount = toDecimalString(toDecimal(cityBucket.amount).plus(amount));
    cityBucket.invoices += 1;
    if (party.cityConfidence === "low" || party.cityConfidence === "none") {
      cityBucket.confidence = party.cityConfidence;
    }

    const lines = voucher.inventoryEntries || [];
    if (lines.length === 0) vouchersWithoutItems += 1;

    for (const line of lines) {
      const lineAmount = toDecimal(line.amount || 0);
      itemValue = itemValue.plus(lineAmount);
      if (typeof line.quantity === "number") itemQuantity += line.quantity;

      rows.push({
        date: voucher.voucherDate,
        voucherNumber: voucher.sourceVoucherNumber,
        voucherType: voucher.voucherType,
        supplier: voucher.partyLedgerName,
        product: line.stockItemName,
        quantity: line.quantity,
        unit: line.unit || null,
        country: party.country,
        state: party.state,
        city: party.city,
        amount: toDecimalString(lineAmount)
      });

      const item = bucket(byItem, line.stockItemName, {
        name: line.stockItemName, unit: line.unit || null, amount: "0", quantity: 0, invoices: 0
      });
      item.amount = toDecimalString(toDecimal(item.amount).plus(lineAmount));
      if (typeof line.quantity === "number") item.quantity += line.quantity;
      item.invoices += 1;
      if (item.unit && line.unit && item.unit !== line.unit) item.unit = null;
    }
  }

  const months = [...byMonth.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const invoiceCount = purchases.length;

  rows.sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(b.voucherNumber || "").localeCompare(String(a.voucherNumber || ""))
  );

  return {
    available: true,
    fetchedAt: register.fetchedAt,
    filterOptions,
    appliedFilters: {
      supplier: supplier || null, product: product || null, country: country || null,
      state: state || null, city: city || null, search: search || null
    },
    invoiceTotalsSpanWholeInvoice: wantsLineFilter,
    totals: {
      invoicedValue: toDecimalString(invoicedValue),
      itemValue: toDecimalString(itemValue),
      invoiceCount,
      itemQuantity: Number(itemQuantity.toFixed(3)),
      averageInvoiceValue: invoiceCount ? toDecimalString(invoicedValue.dividedBy(invoiceCount)) : "0.00",
      supplierCount: bySupplier.size,
      itemCount: byItem.size,
      vouchersWithoutItems
    },
    months,
    rows,
    suppliers: rank([...bySupplier.values()], topN),
    items: rank([...byItem.values()], topN),
    states: rank([...byState.values()], topN),
    cities: rank([...byCity.values()], topN),
    period: {
      from: months.length ? months[0].monthKey : null,
      to: months.length ? months[months.length - 1].monthKey : null
    }
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
  getParties,
  getOverview,
  getCapabilityMap,
  buildStockGroupTree,
  paginate
};
