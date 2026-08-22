/**
 * Company Data Explorer controllers.
 *
 * Thin by design: validate input, resolve company scope, delegate to the
 * service, shape the response. No business logic lives here.
 */

const { z } = require("zod");
const { listCompanies, resolveCompany, paginate } = require("../services/companyScope.service");
const service = require("../services/companyData.service");
const dashboardService = require("../services/dashboard.service");

/** Every list endpoint accepts the same paging/search contract. */
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  search: z.string().max(200).optional()
});

const voucherQuerySchema = listQuerySchema.extend({
  type: z.string().max(100).optional(),
  fromDate: z.string().regex(/^\d{8}$/, "fromDate must be yyyymmdd").optional(),
  toDate: z.string().regex(/^\d{8}$/, "toDate must be yyyymmdd").optional()
});

/** Sales analysis adds dimension filters on top of the period. */
const salesAnalysisQuerySchema = voucherQuerySchema.extend({
  customer: z.string().max(200).optional(),
  product: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  city: z.string().max(100).optional()
});

/** Purchase analysis adds dimension filters for suppliers and products. */
const purchaseAnalysisQuerySchema = voucherQuerySchema.extend({
  supplier: z.string().max(200).optional(),
  product: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  city: z.string().max(100).optional()
});

/**
 * Resolve the companyId from the route and reject anything Tally does not know.
 * Wraps every company-scoped handler so scope can never be forgotten.
 */
function withCompany(handler) {
  return async (req, res) => {
    try {
      // resolveCompany must be inside the try: Express 4 does not catch async
      // errors, so anything thrown here would surface as an unhandled promise
      // rejection and terminate the process.
      const scope = await resolveCompany(req.params.companyId);
      if (!scope.ok) {
        return res.status(scope.status).json({ success: false, ...scope.error });
      }
      return await handler(req, res, scope.company);
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}

/** Parse a list query, returning null and responding on failure. */
function parseQuery(schema, req, res) {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: "Invalid query parameters",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    });
    return null;
  }
  return parsed.data;
}

/** Tally yyyymmdd -> ISO yyyy-mm-dd for comparison against canonical dates. */
function toIsoBound(compact) {
  if (!compact) return null;
  const match = String(compact).match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Shape a domain result into the standard list envelope. */
function listResponse(res, company, result, query, searchFields) {
  if (!result.available) {
    return res.status(200).json({
      success: false,
      companyId: company.companyId,
      available: false,
      reason: result.reason,
      items: [],
      pagination: { page: 1, limit: 0, total: 0, totalPages: 0, hasMore: false }
    });
  }

  const { items, pagination } = paginate(result.records, query, searchFields);
  return res.json({
    success: true,
    companyId: company.companyId,
    available: true,
    source: { system: result.source || "tally", fetchedAt: result.fetchedAt, responseTimeMs: result.responseTimeMs, syncedAt: result.syncedAt || null },
    items,
    pagination
  });
}

async function getCompanies(req, res) {
  try {
    // Display only: a momentary Tally stall should not blank the company list.
    // ?force=1 comes from the Refresh button and retries even during a cooldown.
    const force = req.query.force === "1" || req.query.force === "true";
    const discovery = await listCompanies({ allowStale: !force, force });
    if (!discovery.success) {
      return res.status(502).json({ success: false, companies: [], ...discovery.error });
    }
    return res.json({
      success: true,
      // Present when the list came from cache because Tally was unreachable.
      stale: discovery.stale === true,
      staleAt: discovery.staleAt || null,
      companyCount: discovery.companies.length,
      companies: discovery.companies.map((c) => ({
        companyId: c.companyId,
        companyGuid: c.guid || null,
        companyName: c.name,
        startingAt: c.startingAt || null,
        masterId: c.masterId || null,
        tallyStatus: "connected"
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, companies: [], error: err.message });
  }
}

const getCompany = withCompany(async (req, res, company) => {
  const capabilities = await service.getCapabilityMap(company);
  return res.json({
    success: true,
    company: {
      companyId: company.companyId,
      companyGuid: company.guid || null,
      companyName: company.name,
      startingAt: company.startingAt || null,
      masterId: company.masterId || null
    },
    capabilities
  });
});

const getOverview = withCompany(async (req, res, company) => {
  const overview = await service.getOverview(company);
  return res.json({ success: true, ...overview });
});

/** Factory for the simple master list endpoints. */
function domainHandler(domain, searchFields = ["name"]) {
  return withCompany(async (req, res, company) => {
    const query = parseQuery(listQuerySchema, req, res);
    if (!query) return;
    const result = await service.getDomain(company, domain);
    return listResponse(res, company, result, query, searchFields);
  });
}

const getLedgers = domainHandler("ledgers", ["name", "parent", "classification", "address.stateName"]);
const getGroups = domainHandler("groups", ["name", "parent"]);
const getStockItems = domainHandler("stockItems", ["name", "parent", "category"]);
const getCostCentres = domainHandler("costCentres", ["name", "parent"]);
const getGodowns = domainHandler("godowns", ["name", "parent"]);
const getUnits = domainHandler("units", ["name"]);
const getVoucherTypes = domainHandler("voucherTypes", ["name", "parent"]);

const getLedger = withCompany(async (req, res, company) => {
  const result = await service.getDomain(company, "ledgers");
  if (!result.available) {
    return res.status(502).json({ success: false, available: false, reason: result.reason });
  }
  const ledger = result.records.find((l) => l.sourceObjectId === req.params.ledgerId);
  if (!ledger) {
    return res.status(404).json({
      success: false,
      error: "Ledger not found in this company",
      companyId: company.companyId
    });
  }
  return res.json({
    success: true,
    companyId: company.companyId,
    ledger,
    source: { system: result.source || "tally", sourceType: "Ledger Master", sourceId: ledger.sourceObjectId, fetchedAt: result.fetchedAt, syncedAt: result.syncedAt || null }
  });
});

const getStockItem = withCompany(async (req, res, company) => {
  // Sequential: Tally is single-threaded, and both are cached after the first hit.
  const items = await service.getDomain(company, "stockItems");
  const groups = await service.getDomain(company, "stockGroups");
  if (!items.available) {
    return res.status(502).json({ success: false, available: false, reason: items.reason });
  }
  const item = items.records.find((s) => s.sourceObjectId === req.params.stockItemId);
  if (!item) {
    return res.status(404).json({ success: false, error: "Stock item not found in this company", companyId: company.companyId });
  }
  const stockGroup = groups.available ? groups.records.find((g) => g.name === item.parent) || null : null;
  return res.json({
    success: true,
    companyId: company.companyId,
    stockItem: item,
    stockGroup,
    source: { system: items.source || "tally", sourceType: "Stock Item Master", sourceId: item.sourceObjectId, fetchedAt: items.fetchedAt, syncedAt: items.syncedAt || null }
  });
});

const getStockGroups = withCompany(async (req, res, company) => {
  const groups = await service.getDomain(company, "stockGroups");
  const items = await service.getDomain(company, "stockItems");
  if (!groups.available) {
    return res.status(200).json({ success: false, available: false, reason: groups.reason, tree: [], items: [] });
  }
  return res.json({
    success: true,
    companyId: company.companyId,
    available: true,
    tree: service.buildStockGroupTree(groups.records, items.available ? items.records : []),
    groupCount: groups.records.length,
    source: { system: groups.source || "tally", fetchedAt: groups.fetchedAt, syncedAt: groups.syncedAt || null }
  });
});

/**
 * Item-level summary of one voucher for the register row: the lines themselves,
 * a flat name list for search, and a total quantity when the lines share a unit.
 * Vouchers without inventory (Payment, Receipt, Journal) summarize to empties.
 */
function summarizeItems(inventoryEntries = []) {
  const lines = inventoryEntries.map((entry) => ({
    name: entry.stockItemName,
    quantity: entry.quantity,
    unit: entry.unit || null,
    rate: entry.rate,
    amount: entry.amount
  }));

  const units = new Set(lines.map((line) => line.unit).filter(Boolean));
  const quantities = lines.map((line) => line.quantity).filter((q) => typeof q === "number");

  return {
    items: lines,
    itemNames: lines.map((line) => line.name),
    // Summing across different units would be meaningless, so a mixed-unit
    // voucher reports its lines and no total.
    totalQuantity: quantities.length && units.size <= 1
      ? Number(quantities.reduce((sum, q) => sum + q, 0).toFixed(4))
      : null,
    quantityUnit: units.size === 1 ? [...units][0] : null
  };
}

const getVouchers = withCompany(async (req, res, company) => {
  const query = parseQuery(voucherQuerySchema, req, res);
  if (!query) return;

  const result = await service.getVouchers(company, { fromDate: query.fromDate, toDate: query.toDate });
  if (!result.available) {
    return res.status(200).json({ success: false, available: false, reason: result.reason, items: [] });
  }

  let records = result.records;
  if (query.type) {
    const wanted = query.type.toLowerCase();
    records = records.filter((v) => String(v.voucherType || "").toLowerCase() === wanted);
  }

  // SVFROMDATE/SVTODATE are sent to Tally, but verified against the live
  // instance Tally does NOT honour them for a Voucher collection (a May range
  // still returned June vouchers). The range is therefore enforced here so the
  // response always matches what the caller asked for.
  const isoFrom = toIsoBound(query.fromDate);
  const isoTo = toIsoBound(query.toDate);
  if (isoFrom) records = records.filter((v) => v.voucherDate && v.voucherDate >= isoFrom);
  if (isoTo) records = records.filter((v) => v.voucherDate && v.voucherDate <= isoTo);

  // The party's state lives on the ledger master, not on the voucher. The
  // master is cached, and an unavailable one leaves the column empty rather
  // than failing the register.
  const partyState = await service.getPartyStateResolver(company);

  // List view stays light on ledger detail, but item lines ride along: a live
  // Tally returns ALLINVENTORYENTRIES with the register whether or not they are
  // requested, so naming the items costs no extra round trip.
  const summaries = records.map((v) => ({
    sourceVoucherId: v.sourceVoucherId,
    voucherNumber: v.sourceVoucherNumber,
    voucherType: v.voucherType,
    voucherDate: v.voucherDate,
    partyLedgerName: v.partyLedgerName,
    partyState: partyState(v.partyLedgerName),
    amount: v.amount,
    amountIsCredit: v.amountIsCredit,
    isCancelled: v.isCancelled,
    ledgerEntryCount: v.ledgerEntries.length,
    inventoryEntryCount: v.inventoryEntries.length,
    ...summarizeItems(v.inventoryEntries)
  }));

  const { items, pagination } = paginate(summaries, query, [
    "voucherNumber", "voucherType", "partyLedgerName", "partyState", "itemNames"
  ]);
  return res.json({
    success: true,
    companyId: company.companyId,
    available: true,
    voucherTypes: [...new Set(result.records.map((v) => v.voucherType).filter(Boolean))].sort(),
    appliedFilters: { type: query.type || null, fromDate: isoFrom, toDate: isoTo },
    // Whether item columns are worth showing at all for this filtered set —
    // computed over every matching voucher, not just the page on screen, so
    // the table does not gain and lose columns as the user pages through.
    hasInventory: summaries.some((v) => v.inventoryEntryCount > 0),
    items,
    pagination,
    source: { system: result.source || "tally", fetchedAt: result.fetchedAt, syncedAt: result.syncedAt || null }
  });
});

const getSalesAnalysis = withCompany(async (req, res, company) => {
  const query = parseQuery(salesAnalysisQuerySchema, req, res);
  if (!query) return;

  const result = await service.getSalesAnalysis(company, {
    fromDate: query.fromDate,
    toDate: query.toDate,
    customer: query.customer,
    product: query.product,
    country: query.country,
    state: query.state,
    city: query.city,
    search: query.search
  });

  if (!result.available) {
    return res.status(200).json({ success: false, available: false, reason: result.reason });
  }

  // The aggregates are always computed over the whole period; only the detail
  // table is paged, so a total on screen never disagrees with the rows below it.
  const { rows, ...analysis } = result;
  const paged = paginate(rows, { page: query.page, limit: query.limit || 50 }, []);

  return res.json({
    success: true,
    companyId: company.companyId,
    available: true,
    ...analysis,
    rows: paged.items,
    rowPagination: paged.pagination,
    source: { system: result.source || "tally", sourceType: "Voucher Register", fetchedAt: result.fetchedAt, syncedAt: result.syncedAt || null }
  });
});

const getPurchaseAnalysis = withCompany(async (req, res, company) => {
  const query = parseQuery(purchaseAnalysisQuerySchema, req, res);
  if (!query) return;

  const result = await service.getPurchaseAnalysis(company, {
    fromDate: query.fromDate,
    toDate: query.toDate,
    supplier: query.supplier,
    product: query.product,
    country: query.country,
    state: query.state,
    city: query.city,
    search: query.search
  });

  if (!result.available) {
    return res.status(200).json({ success: false, available: false, reason: result.reason });
  }

  const { rows, ...analysis } = result;
  const paged = paginate(rows, { page: query.page, limit: query.limit || 50 }, []);

  return res.json({
    success: true,
    companyId: company.companyId,
    available: true,
    ...analysis,
    rows: paged.items,
    rowPagination: paged.pagination,
    source: { system: result.source || "tally", sourceType: "Voucher Register", fetchedAt: result.fetchedAt, syncedAt: result.syncedAt || null }
  });
});

/** The dashboard reads one period; the aggregate itself needs no paging. */
const dashboardQuerySchema = z.object({
  fromDate: z.string().regex(/^\d{8}$/, "fromDate must be yyyymmdd").optional(),
  toDate: z.string().regex(/^\d{8}$/, "toDate must be yyyymmdd").optional()
});

/**
 * Aggregated business overview for the dashboard.
 *
 * Served from the same cached voucher register the other company pages read,
 * so opening the dashboard costs TallyPrime nothing extra.
 */
const getDashboard = withCompany(async (req, res, company) => {
  const query = parseQuery(dashboardQuerySchema, req, res);
  if (!query) return;

  const result = await dashboardService.getDashboard(company, {
    fromDate: query.fromDate,
    toDate: query.toDate
  });

  if (!result.available) {
    return res.status(200).json({ success: false, available: false, reason: result.reason });
  }

  const { source, fetchedAt, syncedAt, ...analysis } = result;
  return res.json({
    success: true,
    companyId: company.companyId,
    company: {
      companyId: company.companyId,
      companyName: company.name,
      startingAt: company.startingAt || null
    },
    ...analysis,
    source: { system: source, sourceType: "Voucher Register", fetchedAt, syncedAt }
  });
});

const getVoucher = withCompany(async (req, res, company) => {
  const result = await service.getVoucherById(company, req.params.voucherId);
  if (!result.available) {
    return res.status(502).json({ success: false, available: false, reason: result.reason });
  }
  if (!result.voucher) {
    return res.status(404).json({ success: false, error: "Voucher not found in this company", companyId: company.companyId });
  }
  return res.json({
    success: true,
    companyId: company.companyId,
    voucher: result.voucher,
    source: { system: result.source || "tally", sourceType: "Voucher", sourceId: result.voucher.sourceVoucherId, fetchedAt: result.fetchedAt, syncedAt: result.syncedAt || null }
  });
});

const getParties = withCompany(async (req, res, company) => {
  const query = parseQuery(listQuerySchema, req, res);
  if (!query) return;
  const kind = req.path.includes("customers") ? "customers" : "suppliers";
  const result = await service.getParties(company, kind);
  return listResponse(res, company, result, query, ["name", "address.stateName"]);
});

/**
 * Readiness tiers T0–T4. Each tier reports what is actually missing rather
 * than a bare pass/fail.
 */
const getReadiness = withCompany(async (req, res, company) => {
  const overview = await service.getOverview(company);
  const capabilities = await service.getCapabilityMap(company);

  const tiers = [
    { tier: "T0", name: "Connection", status: "ready", detail: "TallyPrime responded over HTTP/XML" },
    {
      tier: "T1", name: "Company Identity",
      status: company.guid ? "ready" : "partial",
      detail: company.guid ? `Stable GUID ${company.guid}` : "No GUID returned; identity falls back to name"
    },
    {
      tier: "T2", name: "Masters",
      status: overview.counts.ledgers > 0 ? "ready" : "blocked",
      detail: `${overview.counts.ledgers ?? 0} ledgers, ${overview.counts.stockItems ?? 0} stock items, ${overview.counts.stockGroups ?? 0} stock groups`
    },
    { tier: "T3", name: "Transactions", status: "unknown", detail: "Open the Vouchers module to extract transactions" },
    { tier: "T4", name: "Reconciliation", status: "unknown", detail: "Requires transactions to be extracted first" }
  ];

  return res.json({ success: true, companyId: company.companyId, tiers, capabilities });
});

module.exports = {
  getCompanies,
  getCompany,
  getOverview,
  getLedgers,
  getLedger,
  getGroups,
  getStockItems,
  getStockItem,
  getStockGroups,
  getCostCentres,
  getGodowns,
  getUnits,
  getVoucherTypes,
  getVouchers,
  getVoucher,
  getSalesAnalysis,
  getPurchaseAnalysis,
  getDashboard,
  getParties,
  getReadiness,
  // Exported for tests: the register row's item summary carries its own rules.
  summarizeItems
};
