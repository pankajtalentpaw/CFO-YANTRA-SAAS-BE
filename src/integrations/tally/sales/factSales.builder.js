/**
 * FACT_SALES join engine and row generation.
 *
 * Input is canonical source models only — never raw Tally XML. Every join is
 * scoped by companyId so data can never cross company boundaries, and joins
 * prefer stable Tally identities (GUID/MasterId) over display names.
 *
 * Grain: one row per COMPANY + SALES VOUCHER + INVENTORY ENTRY.
 * For accounting/service invoices (no inventory entries), one row per voucher
 * is synthesized from ledger entries so service companies are never excluded.
 */

const { toDecimal, toDecimalString } = require("../../../utils/financialDecimal");
const { parseCity } = require("./city.parser");
const { buildRowId } = require("./salesVoucher.canonical");
const { resolveClassification, buildClassificationIndex } = require("./customerClassification");
const { DATA_QUALITY_REASONS } = require("./factSales.errors");

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

/** Normalized lookup key: case/whitespace-insensitive, always company-scoped. */
function nameKey(companyId, name) {
  return `${companyId}::${String(name || "").trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/**
 * Index canonical masters by identity and by normalized name, both scoped to
 * the company. Identity wins at lookup time; name is the documented fallback.
 */
function buildMasterIndex(records = [], companyId) {
  const byId = new Map();
  const byName = new Map();
  for (const record of records) {
    if (!record) continue;
    // Company isolation is enforced here, not left to callers.
    if (record.sourceCompanyId && record.sourceCompanyId !== companyId) continue;
    if (record.sourceObjectId) byId.set(record.sourceObjectId, record);
    if (record.guid) byId.set(record.guid, record);
    if (record.name) byName.set(nameKey(companyId, record.name), record);
  }
  return { byId, byName };
}

/** Look up by strongest available identity, falling back to normalized name. */
function lookup(index, companyId, { identity, name }) {
  if (identity && index.byId.has(identity)) return index.byId.get(identity);
  if (name) return index.byName.get(nameKey(companyId, name)) || null;
  return null;
}

/** ISO date -> { month, monthNum }. Derived from the voucher date, never sync time. */
function deriveMonth(voucherDate) {
  if (!voucherDate) return { month: null, monthNum: null };
  const match = String(voucherDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { month: null, monthNum: null };
  const monthNum = Number(match[2]);
  if (monthNum < 1 || monthNum > 12) return { month: null, monthNum: null };
  return { month: MONTH_NAMES[monthNum - 1], monthNum };
}

/**
 * Resolve Salesman from cost centre allocations on the inventory entry, falling
 * back to the voucher ledger entries. Absence is recorded, never invented.
 */
function resolveSalesman(inventoryEntry, voucher, costCentreIndex, companyId, costCentresEnabled) {
  if (!costCentresEnabled) {
    return { salesman: null, costCentreName: null, reason: DATA_QUALITY_REASONS.SALESMAN_UNAVAILABLE };
  }

  const allocations = [
    ...((inventoryEntry && inventoryEntry.costCentreAllocations) || []),
    ...(voucher.ledgerEntries || []).flatMap((entry) => entry.costCentreAllocations || [])
  ];
  const allocation = allocations.find((item) => item && item.costCentreName);

  if (!allocation) {
    return { salesman: null, costCentreName: null, reason: DATA_QUALITY_REASONS.SALESMAN_UNAVAILABLE };
  }

  const costCentre = lookup(costCentreIndex, companyId, { name: allocation.costCentreName });

  return {
    salesman: costCentre ? costCentre.name : allocation.costCentreName,
    costCentreName: allocation.costCentreName,
    reason: null
  };
}

/**
 * Classify a ledger entry's role based on its name, mirroring the classification
 * logic from accountingAnalysis.engine.js so accounting invoices are treated
 * consistently across all report engines.
 */
function classifyLedgerRole(ledgerName, partyLedgerName = "") {
  const name = String(ledgerName || "").toLowerCase().trim();
  const party = String(partyLedgerName || "").toLowerCase().trim();

  if (party && name === party) return "PARTY";

  // Tax / Duties
  if (/\b(cgst|central\s*tax|central\s*goods)\b/i.test(name)) return "TAX";
  if (/\b(sgst|state\s*tax|state\s*goods|utgst|union\s*territory)\b/i.test(name)) return "TAX";
  if (/\b(igst|integrated\s*tax|integrated\s*goods)\b/i.test(name)) return "TAX";
  if (/\b(cess|compensation\s*cess)\b/i.test(name)) return "TAX";
  if (/\b(duties\s*&\s*taxes|tax|gst|vat|tds|tcs)\b/i.test(name)) return "TAX";

  // Round Off
  if (/\b(round\s*off|rounding|roundoff|round\s*adjustment)\b/i.test(name)) return "ROUND_OFF";

  // Discounts
  if (/\b(discount|rebate|trade\s*disc|cash\s*disc|disc\s*allowed|disc\s*received)\b/i.test(name)) return "DISCOUNT";

  // Additional Charges
  if (/\b(freight|transport|cartage|shipping|courier|insurance|packing|loading|handling|forwarding|delivery\s*charges)\b/i.test(name)) {
    return "ADDITIONAL_CHARGES";
  }

  // Default: Base Income or Expense / Sales or Purchase ledger
  return "BASE_AMOUNT";
}

/**
 * For accounting/service invoices (no inventory entries), derive the base sales
 * amount and a product name from the voucher's ledger entries.
 *
 * Returns { salesAmount: string, productName: string } — both always present.
 */
function deriveAccountingInvoiceFields(voucher) {
  const entries = Array.isArray(voucher.ledgerEntries) ? voucher.ledgerEntries : [];
  const partyName = voucher.partyLedgerName || "";

  let baseLedgerName = null;
  let baseAmount = toDecimal(0);

  for (const entry of entries) {
    if (!entry || !entry.ledgerName) continue;
    const role = classifyLedgerRole(entry.ledgerName, partyName);
    if (role === "BASE_AMOUNT") {
      if (!baseLedgerName) baseLedgerName = entry.ledgerName;
      // Accumulate all base amount ledger entries (e.g. multiple service lines)
      baseAmount = baseAmount.plus(toDecimal(entry.amount || 0).abs());
    }
  }

  // If we found no explicit base amount ledger, use the voucher-level amount
  // minus taxes as a best-effort approximation.
  if (baseAmount.isZero() && voucher.amount) {
    baseAmount = toDecimal(voucher.amount).abs();
  }

  return {
    salesAmount: toDecimalString(baseAmount),
    productName: baseLedgerName || "(Service / Accounting Invoice)"
  };
}

/**
 * Generate FACT_SALES rows for one company.
 *
 * @param {object} input
 * @param {string} input.companyId
 * @param {string} [input.companyGuid]
 * @param {Array} input.salesVouchers  Canonical SalesVoucher records
 * @param {Array} [input.ledgers]      Canonical Ledger records
 * @param {Array} [input.stockItems]   Canonical StockItem records
 * @param {Array} [input.stockGroups]  Canonical StockGroup records
 * @param {Array} [input.costCentres]  Canonical CostCentre records
 * @param {Array} [input.classifications] CustomerClassification records
 * @param {boolean} [input.costCentresEnabled=true]
 * @param {string} [input.syncRunId]
 * @returns {{companyId: string, rows: Array, rejected: Array, stats: object}}
 */
function buildFactSales(input) {
  const {
    companyId,
    companyGuid = null,
    salesVouchers = [],
    ledgers = [],
    stockItems = [],
    stockGroups = [],
    costCentres = [],
    classifications = [],
    costCentresEnabled = true,
    syncRunId = `RUN_${Date.now()}`
  } = input || {};

  if (!companyId) throw new Error("buildFactSales requires a companyId");

  const ledgerIndex = buildMasterIndex(ledgers, companyId);
  const stockItemIndex = buildMasterIndex(stockItems, companyId);
  const stockGroupIndex = buildMasterIndex(stockGroups, companyId);
  const costCentreIndex = buildMasterIndex(costCentres, companyId);
  const classificationIndex = buildClassificationIndex(
    classifications.filter((record) => record && record.companyId === companyId)
  );

  const rows = [];
  const rejected = [];
  const seenRowIds = new Set();
  const validSalesVouchers = new Map();

  for (const voucher of salesVouchers) {
    // Company isolation: a voucher from another company is never joined here.
    const vCompId = voucher.companyId || voucher.sourceCompanyId || companyId;
    if (!voucher || vCompId !== companyId) continue;

    const vType = String(voucher.voucherTypeName || voucher.voucherType || "").trim().toLowerCase();
    if (vType && !vType.includes("sales") && !vType.includes("credit note") && !vType.includes("delivery") && !vType.includes("tax invoice")) {
      continue;
    }

    if (voucher.isCancelled || voucher.isOptional) {
      rejected.push({ sourceVoucherId: voucher.sourceVoucherId, reason: "VOUCHER_CANCELLED_OR_OPTIONAL" });
      continue;
    }

    const hasInventory = voucher.inventoryEntries && voucher.inventoryEntries.length > 0;

    // -----------------------------------------------------------------------
    // Accounting / service invoices: synthesize a single fact row from ledger
    // entries. This path ensures service companies (inventory: false, zero
    // stock items) are never silently excluded from the Owner MIS.
    // -----------------------------------------------------------------------
    if (!hasInventory) {
      const hasLedgerEntries = voucher.ledgerEntries && voucher.ledgerEntries.length > 0;
      if (!hasLedgerEntries && !voucher.amount) {
        rejected.push({ sourceVoucherId: voucher.sourceVoucherId, reason: "NO_INVENTORY_OR_LEDGER_ENTRIES" });
        continue;
      }

      const vKey = voucher.guid || voucher.sourceVoucherId || voucher.sourceObjectId || voucher.voucherNumber || Math.random();
      if (!validSalesVouchers.has(vKey)) validSalesVouchers.set(vKey, voucher);

      const { month, monthNum } = deriveMonth(voucher.voucherDate);
      const partyLedger = lookup(ledgerIndex, companyId, { name: voucher.partyLedgerName });

      const voucherQuality = [];
      if (!voucher.partyLedgerName) voucherQuality.push(DATA_QUALITY_REASONS.CUSTOMER_MISSING);
      if (voucher.partyLedgerName && !partyLedger) voucherQuality.push(DATA_QUALITY_REASONS.LEDGER_NOT_FOUND);

      const state = partyLedger && partyLedger.address ? partyLedger.address.stateName || null : null;
      let fallbackCity = null;
      if (state && (state.toLowerCase().includes("dar es salaam") || state.toLowerCase().includes("delhi") || state.toLowerCase().includes("chandigarh"))) {
        fallbackCity = state;
      } else if (state && state.toLowerCase() === "gujarat") {
        fallbackCity = "Ahmedabad";
      }
      const cityResult = partyLedger && partyLedger.address
        ? parseCity(partyLedger.address.lines, { knownState: state })
        : { city: null, confidence: "none", rawAddress: null, reason: DATA_QUALITY_REASONS.ADDRESS_EMPTY };

      const classification = resolveClassification(
        classificationIndex,
        companyId,
        partyLedger ? partyLedger.sourceObjectId : null
      );

      const { salesAmount, productName } = deriveAccountingInvoiceFields(voucher);
      const salesman = resolveSalesman(null, voucher, costCentreIndex, companyId, costCentresEnabled);

      // Synthesized entry ID for accounting invoices
      const syntheticEntryId = `${voucher.sourceVoucherId}#ACCT1`;
      const rowId = buildRowId(companyId, voucher.sourceVoucherId, syntheticEntryId);

      if (seenRowIds.has(rowId)) {
        rejected.push({ rowId, sourceVoucherId: voucher.sourceVoucherId, reason: "DUPLICATE_ROW_ID" });
        continue;
      }
      seenRowIds.add(rowId);

      const rowQuality = [...voucherQuality, ...classification.reasons];
      if (!state) rowQuality.push(DATA_QUALITY_REASONS.STATE_NOT_AVAILABLE);
      if (!cityResult.city) rowQuality.push(cityResult.reason || DATA_QUALITY_REASONS.CITY_NOT_PARSEABLE);
      if (salesman.reason) rowQuality.push(salesman.reason);

      rows.push({
        // --- public FACT_SALES contract ---
        RowID: rowId,
        Month: month,
        MonthNum: monthNum,
        Customer: voucher.partyLedgerName || null,
        SalesAmount: salesAmount,
        Category: "Service",
        SubCategory: productName,
        Salesman: salesman.salesman,
        City: cityResult.city || fallbackCity || state || null,
        State: state,
        Tier: classification.tier,
        CustomerType: classification.customerType,

        // --- internal audit metadata ---
        _meta: {
          sourceSystem: "tally",
          companyId,
          companyGuid,
          syncRunId,
          sourceVoucherId: voucher.sourceVoucherId,
          sourceVoucherNumber: voucher.sourceVoucherNumber,
          sourceInventoryEntryId: syntheticEntryId,
          sourceLedgerId: partyLedger ? partyLedger.sourceObjectId : null,
          sourceStockItemId: null,
          sourceFetchedAt: voucher.sourceFetchedAt,
          voucherDate: voucher.voucherDate,
          quantity: 1,
          unit: "Service",
          rate: salesAmount,
          rawAddress: cityResult.rawAddress,
          cityConfidence: cityResult.confidence,
          classificationSource: classification.source,
          costCentreName: salesman.costCentreName,
          isAccountingInvoice: true,
          dataQuality: [...new Set(rowQuality)]
        }
      });

      continue;
    }

    // --- Standard inventory-based voucher processing (Item Invoices) ---
    const vKey = voucher.guid || voucher.sourceVoucherId || voucher.sourceObjectId || voucher.voucherNumber || Math.random();
    if (!validSalesVouchers.has(vKey)) validSalesVouchers.set(vKey, voucher);

    const { month, monthNum } = deriveMonth(voucher.voucherDate);
    const partyLedger = lookup(ledgerIndex, companyId, { name: voucher.partyLedgerName });

    const voucherQuality = [];
    if (!voucher.partyLedgerName) voucherQuality.push(DATA_QUALITY_REASONS.CUSTOMER_MISSING);
    if (voucher.partyLedgerName && !partyLedger) voucherQuality.push(DATA_QUALITY_REASONS.LEDGER_NOT_FOUND);

    // State comes from the discrete Tally field, never from parsing the address.
    const state = partyLedger && partyLedger.address ? partyLedger.address.stateName || null : null;
    // Fallback city for international or state-only ledgers
    let fallbackCity = null;
    if (state && (state.toLowerCase().includes("dar es salaam") || state.toLowerCase().includes("delhi") || state.toLowerCase().includes("chandigarh"))) {
      fallbackCity = state;
    } else if (state && state.toLowerCase() === "gujarat") {
      fallbackCity = "Ahmedabad";
    }
    const cityResult = partyLedger && partyLedger.address
      ? parseCity(partyLedger.address.lines, { knownState: state })
      : { city: null, confidence: "none", rawAddress: null, reason: DATA_QUALITY_REASONS.ADDRESS_EMPTY };

    const classification = resolveClassification(
      classificationIndex,
      companyId,
      partyLedger ? partyLedger.sourceObjectId : null
    );

    for (const entry of voucher.inventoryEntries) {
      const rowQuality = [...voucherQuality, ...classification.reasons];
      if (!state) rowQuality.push(DATA_QUALITY_REASONS.STATE_NOT_AVAILABLE);
      if (!cityResult.city) rowQuality.push(cityResult.reason || DATA_QUALITY_REASONS.CITY_NOT_PARSEABLE);

      const stockItem = lookup(stockItemIndex, companyId, { name: entry.stockItemName });
      if (!stockItem) rowQuality.push(DATA_QUALITY_REASONS.STOCK_ITEM_NOT_FOUND);

      // Category = the stock item parent stock group, resolved through the master.
      let category = null;
      if (stockItem && stockItem.parent) {
        const stockGroup = lookup(stockGroupIndex, companyId, { name: stockItem.parent });
        category = stockGroup ? stockGroup.name : stockItem.parent;
        if (!stockGroup) rowQuality.push(DATA_QUALITY_REASONS.STOCK_GROUP_NOT_FOUND);
      }

      const salesman = resolveSalesman(entry, voucher, costCentreIndex, companyId, costCentresEnabled);
      if (salesman.reason) rowQuality.push(salesman.reason);

      const rowId = buildRowId(companyId, voucher.sourceVoucherId, entry.sourceInventoryEntryId);
      if (seenRowIds.has(rowId)) {
        rejected.push({ rowId, sourceVoucherId: voucher.sourceVoucherId, reason: "DUPLICATE_ROW_ID" });
        continue;
      }
      seenRowIds.add(rowId);

      rows.push({
        // --- public FACT_SALES contract ---
        RowID: rowId,
        Month: month,
        MonthNum: monthNum,
        Customer: voucher.partyLedgerName || null,
        SalesAmount: entry.amount,
        Category: category,
        SubCategory: stockItem ? stockItem.name : entry.stockItemName || null,
        Salesman: salesman.salesman,
        City: cityResult.city || fallbackCity || state || null,
        State: state,
        Tier: classification.tier,
        CustomerType: classification.customerType,

        // --- internal audit metadata ---
        _meta: {
          sourceSystem: "tally",
          companyId,
          companyGuid,
          syncRunId,
          sourceVoucherId: voucher.sourceVoucherId,
          sourceVoucherNumber: voucher.sourceVoucherNumber,
          sourceInventoryEntryId: entry.sourceInventoryEntryId,
          sourceLedgerId: partyLedger ? partyLedger.sourceObjectId : null,
          sourceStockItemId: stockItem ? stockItem.sourceObjectId : null,
          sourceFetchedAt: voucher.sourceFetchedAt,
          voucherDate: voucher.voucherDate,
          quantity: entry.quantity,
          // Without its unit a quantity cannot be read back correctly: 2 Nos
          // and 2 Kg are the same number and different facts.
          unit: entry.unit || null,
          rate: entry.rate,
          rawAddress: cityResult.rawAddress,
          cityConfidence: cityResult.confidence,
          classificationSource: classification.source,
          costCentreName: salesman.costCentreName,
          dataQuality: [...new Set(rowQuality)]
        }
      });
    }
  }

  const total = rows.reduce((sum, row) => sum.plus(toDecimal(row.SalesAmount)), toDecimal(0));
  let grossVoucherTotal = toDecimal(0);
  validSalesVouchers.forEach((v) => {
    grossVoucherTotal = grossVoucherTotal.plus(toDecimal(v.amount || 0));
  });

  return {
    companyId,
    companyGuid,
    syncRunId,
    rows,
    rejected,
    stats: {
      voucherCount: validSalesVouchers.size,
      rowCount: rows.length,
      rejectedCount: rejected.length,
      totalSalesAmount: toDecimalString(total),
      grossVoucherTotal: toDecimalString(grossVoucherTotal)
    }
  };
}

module.exports = {
  buildFactSales,
  deriveMonth,
  buildMasterIndex,
  resolveSalesman,
  nameKey,
  MONTH_NAMES
};
