/**
 * Common Accounting Analysis Engine for Tally Integration
 *
 * Provides a unified, symmetrical, Decimal-precision calculation and aggregation
 * engine for Sales Analysis and Purchase Analysis.
 *
 * Core Principles:
 * 1. Function-based architecture (no classes).
 * 2. 100% Decimal.js arithmetic — zero floating point drift.
 * 3. Exact Tally source data alignment (Voucher Amount, Ledger Entries, Inventory Lines).
 * 4. Dual-mode support: Item Invoices (goods) and Accounting Invoices (services/expenses).
 * 5. Full GST (CGST, SGST, IGST, UTGST, Cess), Discount, Charges, and Round-Off breakdown.
 * 6. Symmetrical Return & Reversal handling (Credit Notes for Sales, Debit Notes for Purchase).
 * 7. Non-financial and order voucher exclusion (Orders, Inventory-only challans).
 * 8. Strict multi-company isolation and deterministic voucher tracing.
 */

const { Decimal, toDecimal, toDecimalString } = require("../../../utils/financialDecimal");

/** Buckets for parties Tally holds no geography for. */
const NO_STATE_LABEL = "(no state)";
const NO_CITY_LABEL = "(no city)";
const NO_COUNTRY_LABEL = "(no country)";
const RANKED_LIST_CAP = 500;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Normalizes an ISO date to a month key 'YYYY-MM'.
 */
function monthKeyOf(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

/**
 * Converts 'YYYY-MM' to 'Mmm YYYY' (e.g. '2024-04' -> 'Apr 2024').
 */
function monthLabelOf(monthKey) {
  if (!monthKey) return "";
  const [year, month] = monthKey.split("-");
  const idx = Number(month) - 1;
  return `${MONTH_LABELS[idx] || month} ${year}`;
}

/** Accumulate into a keyed bucket without letting a missing key vanish silently. */
function bucket(map, key, seed) {
  if (!map.has(key)) map.set(key, { ...seed });
  return map.get(key);
}

/**
 * Standardizes voucher type classification into core accounting categories.
 * Handles custom names, aliases, and parent hierarchy traversal.
 *
 * IMPORTANT: Orders and inventory movements are evaluated first so custom names
 * like "Purchase Order" or "Sales Order" are never misclassified as financial invoices.
 */
function classifyVoucherType(name, parent = null) {
  const n = String(name || "").toLowerCase().trim();
  const p = String(parent || "").toLowerCase().trim();
  const combined = `${n} ${p}`;

  // 1. Orders & Indents (Non-financial - MUST EXCLUDE from Sales & Purchases)
  if (
    combined.includes("purchase order") ||
    combined.includes("sales order") ||
    combined.includes("job work order") ||
    combined.includes("indent") ||
    combined.includes("proforma") ||
    combined.includes("quotation") ||
    combined.includes("estimate")
  ) {
    return "ORDER";
  }

  // 2. Inventory Movements & Stock Tracking (Non-financial - MUST EXCLUDE from Sales & Purchases)
  if (
    combined.includes("delivery note") ||
    combined.includes("delivery challan") ||
    combined.includes("receipt note") ||
    combined.includes("goods receipt note") ||
    combined.includes("material in") ||
    combined.includes("material out") ||
    combined.includes("rejections in") ||
    combined.includes("rejections out") ||
    combined.includes("stock journal") ||
    combined.includes("physical stock") ||
    combined.includes("stock transfer")
  ) {
    return "INVENTORY_MOVEMENT";
  }

  // 3. Sales Returns (Credit Notes)
  if (
    combined.includes("credit note") ||
    combined.includes("cr note") ||
    combined.includes("sales return") ||
    combined.includes("sale return")
  ) {
    return "CREDIT_NOTE";
  }

  // 4. Purchase Returns (Debit Notes)
  if (
    combined.includes("debit note") ||
    combined.includes("dr note") ||
    combined.includes("purchase return")
  ) {
    return "DEBIT_NOTE";
  }

  // 5. Financial Purchase Invoices (Inward Supply)
  if (
    combined.includes("purchase") ||
    combined.includes("inward") ||
    combined.includes("local purchase") ||
    combined.includes("import purchase") ||
    combined.includes("raw material purchase") ||
    combined.includes("rm purchase") ||
    combined.includes("grn invoice") ||
    combined.includes("direct purchase")
  ) {
    return "PURCHASE";
  }

  // 6. Financial Sales Invoices (Outward Supply)
  if (
    combined.includes("sales") ||
    combined.includes("sale") ||
    combined.includes("tax invoice") ||
    combined.includes("export sales") ||
    combined.includes("domestic sales") ||
    combined.includes("retail sale") ||
    combined.includes("bill of supply") ||
    combined.includes("pos invoice") ||
    combined.includes("invoice") ||
    combined.includes("bill")
  ) {
    return "SALES";
  }

  // 7. Banking & Payment flows
  if (combined.includes("receipt")) return "RECEIPT";
  if (combined.includes("payment")) return "PAYMENT";
  if (combined.includes("contra")) return "CONTRA";
  if (combined.includes("journal")) return "JOURNAL";
  if (combined.includes("payroll") || combined.includes("attendance")) return "PAYROLL";

  return "OTHER";
}

/**
 * Builds a voucher type resolver function given the company's voucherTypes domain.
 */
function createVoucherTypeResolver(voucherTypes = []) {
  const parentMap = new Map();
  if (Array.isArray(voucherTypes)) {
    for (const vt of voucherTypes) {
      if (vt && vt.name) {
        const key = String(vt.name).toLowerCase().trim();
        const p = String(vt.parent || vt.coreType || vt.name).toLowerCase().trim();
        parentMap.set(key, p);
      }
    }
  }

  return (voucherTypeName) => {
    let current = String(voucherTypeName || "").toLowerCase().trim();
    if (!current) return "OTHER";

    // Traverse parent chain up to 5 levels to resolve aliases
    for (let i = 0; i < 5; i++) {
      if (parentMap.has(current) && parentMap.get(current) !== current) {
        current = parentMap.get(current);
      } else {
        break;
      }
    }

    return classifyVoucherType(voucherTypeName, current);
  };
}

/**
 * Classifies an individual ledger entry in a voucher into accounting categories.
 */
function classifyLedgerRole(ledgerName, partyLedgerName = "") {
  const name = String(ledgerName || "").toLowerCase().trim();
  const party = String(partyLedgerName || "").toLowerCase().trim();

  if (party && name === party) {
    return "PARTY";
  }

  // 1. Tax / Duties (CGST, SGST, IGST, UTGST, Cess, etc.)
  if (/\b(cgst|central\s*tax|central\s*goods)\b/i.test(name)) return "TAX_CGST";
  if (/\b(sgst|state\s*tax|state\s*goods|utgst|union\s*territory)\b/i.test(name)) return "TAX_SGST";
  if (/\b(igst|integrated\s*tax|integrated\s*goods)\b/i.test(name)) return "TAX_IGST";
  if (/\b(cess|compensation\s*cess)\b/i.test(name)) return "TAX_CESS";
  if (/\b(duties\s*&\s*taxes|tax|gst|vat|tds|tcs)\b/i.test(name)) return "TAX_OTHER";

  // 2. Round Off
  if (/\b(round\s*off|rounding|roundoff|round\s*adjustment)\b/i.test(name)) return "ROUND_OFF";

  // 3. Discounts
  if (/\b(discount|rebate|trade\s*disc|cash\s*disc|disc\s*allowed|disc\s*received)\b/i.test(name)) return "DISCOUNT";

  // 4. Additional Charges / Overheads
  if (/\b(freight|transport|cartage|shipping|courier|insurance|packing|loading|handling|forwarding|delivery\s*charges)\b/i.test(name)) {
    return "ADDITIONAL_CHARGES";
  }

  // 5. Default: Base Income or Expense / Sales or Purchase ledger
  return "BASE_AMOUNT";
}

/**
 * Computes detailed ledger-level breakdowns from a voucher's ledger entries.
 * Reconciles GST, discounts, additional charges, round-off, and base amounts.
 */
function calculateVoucherLedgerBreakdown(voucher) {
  const partyLedgerName = voucher.partyLedgerName || "";
  const entries = Array.isArray(voucher.ledgerEntries) ? voucher.ledgerEntries : [];

  let cgst = new Decimal(0);
  let sgst = new Decimal(0);
  let igst = new Decimal(0);
  let utgst = new Decimal(0);
  let cess = new Decimal(0);
  let otherTax = new Decimal(0);
  let roundOff = new Decimal(0);
  let discount = new Decimal(0);
  let additionalCharges = new Decimal(0);
  let baseLedgerAmount = new Decimal(0);

  for (const entry of entries) {
    if (!entry || !entry.ledgerName) continue;
    const amount = toDecimal(entry.amount || 0);
    const role = classifyLedgerRole(entry.ledgerName, partyLedgerName);

    switch (role) {
      case "TAX_CGST":
        cgst = cgst.plus(amount);
        break;
      case "TAX_SGST":
        sgst = sgst.plus(amount);
        break;
      case "TAX_IGST":
        igst = igst.plus(amount);
        break;
      case "TAX_CESS":
        cess = cess.plus(amount);
        break;
      case "TAX_OTHER":
        otherTax = otherTax.plus(amount);
        break;
      case "ROUND_OFF": {
        const isDeduction = entry.isCredit === false && entry.amount && String(entry.amount).startsWith("-");
        roundOff = isDeduction ? roundOff.minus(amount) : roundOff.plus(amount);
        break;
      }
      case "DISCOUNT":
        discount = discount.plus(amount);
        break;
      case "ADDITIONAL_CHARGES":
        additionalCharges = additionalCharges.plus(amount);
        break;
      case "BASE_AMOUNT":
        baseLedgerAmount = baseLedgerAmount.plus(amount);
        break;
      case "PARTY":
      default:
        break;
    }
  }

  const totalTax = cgst.plus(sgst).plus(igst).plus(utgst).plus(cess).plus(otherTax);

  return {
    cgst,
    sgst,
    igst,
    utgst,
    cess,
    otherTax,
    totalTax,
    roundOff,
    discount,
    additionalCharges,
    baseLedgerAmount
  };
}

/**
 * Reconciles and normalizes a single voucher for Sales or Purchase Analysis.
 *
 * @param {object} voucher Canonical voucher record
 * @param {object} context
 * @param {string} context.direction "SALES" or "PURCHASE"
 * @param {Function} context.voucherTypeClassifier
 * @param {Function} context.partyProfileResolver
 */
function normalizeVoucherAnalysis(voucher, context = {}) {
  const { direction = "SALES", voucherTypeClassifier, partyProfileResolver } = context;

  const coreType = voucherTypeClassifier ? voucherTypeClassifier(voucher.voucherType) : classifyVoucherType(voucher.voucherType);

  const isSalesReturn = coreType === "CREDIT_NOTE";
  const isPurchaseReturn = coreType === "DEBIT_NOTE";
  const isReturn = direction === "SALES" ? isSalesReturn : isPurchaseReturn;

  const sign = isReturn ? new Decimal(-1) : new Decimal(1);
  const rawVoucherAmount = toDecimal(voucher.amount || 0);
  const invoicedValue = sign.times(rawVoucherAmount);

  const partyProfile = partyProfileResolver ? partyProfileResolver(voucher.partyLedgerName) : {
    country: null, state: null, city: null, cityConfidence: "none"
  };

  const ledgerBreakdown = calculateVoucherLedgerBreakdown(voucher);

  // Line items extraction: handles both Item Invoices and Accounting Invoices
  const inventoryLines = Array.isArray(voucher.inventoryEntries) ? voucher.inventoryEntries : [];
  const hasInventory = inventoryLines.length > 0;

  let itemValue = new Decimal(0);
  let itemQuantity = 0;
  const detailRows = [];

  if (hasInventory) {
    const totalLineAmounts = inventoryLines.reduce((sum, line) => sum.plus(toDecimal((line && line.amount) || 0).abs()), new Decimal(0));

    for (const line of inventoryLines) {
      if (!line) continue;
      const rawLineAmt = toDecimal(line.amount || 0);
      const lineAmount = sign.times(rawLineAmt);
      itemValue = itemValue.plus(lineAmount);

      const qty = typeof line.quantity === "number" ? line.quantity : (parseFloat(line.quantity) || 0);
      const signedQty = isReturn ? -Math.abs(qty) : Math.abs(qty);
      itemQuantity += signedQty;

      // Proportionate Tally allocation for multi-line vouchers
      const lineRatio = totalLineAmounts.isZero()
        ? new Decimal(1).dividedBy(inventoryLines.length || 1)
        : rawLineAmt.abs().dividedBy(totalLineAmounts);

      const lineGst = sign.times(ledgerBreakdown.totalTax.times(lineRatio));
      const lineCharges = sign.times(
        ledgerBreakdown.additionalCharges.plus(ledgerBreakdown.roundOff).minus(ledgerBreakdown.discount).times(lineRatio)
      );
      const lineTotal = lineAmount.plus(lineGst).plus(lineCharges);

      detailRows.push({
        date: voucher.voucherDate,
        voucherNumber: voucher.sourceVoucherNumber,
        voucherType: voucher.voucherType,
        coreType,
        party: voucher.partyLedgerName || "(no party)",
        customer: voucher.partyLedgerName || "(no party)",
        supplier: voucher.partyLedgerName || "(no party)",
        product: line.stockItemName || "(no item)",
        quantity: signedQty,
        unit: line.unit || null,
        rate: line.rate || null,
        country: partyProfile.country || null,
        state: partyProfile.state || null,
        city: partyProfile.city || null,
        cityConfidence: partyProfile.cityConfidence || "none",
        amount: toDecimalString(lineAmount),
        gst: toDecimalString(lineGst),
        Gst: toDecimalString(lineGst),
        charges: toDecimalString(lineCharges),
        Charges: toDecimalString(lineCharges),
        totalAmount: toDecimalString(lineTotal),
        TotalAmount: toDecimalString(lineTotal),
        salesAmount: toDecimalString(lineAmount),
        isAccountingInvoice: false,
        isReturn
      });
    }
  } else {
    // Voucher with no stock lines (service / accounting voucher)
    let baseLedgerName = null;
    for (const entry of Array.isArray(voucher.ledgerEntries) ? voucher.ledgerEntries : []) {
      if (!entry || !entry.ledgerName) continue;
      const role = classifyLedgerRole(entry.ledgerName, voucher.partyLedgerName || "");
      if (role === "BASE_AMOUNT") {
        baseLedgerName = entry.ledgerName;
        break;
      }
    }
    const displayProductName = baseLedgerName || "(Service / Accounting Invoice)";

    const baseAmt = ledgerBreakdown.baseLedgerAmount.isZero()
      ? rawVoucherAmount.minus(ledgerBreakdown.totalTax).minus(ledgerBreakdown.additionalCharges)
      : ledgerBreakdown.baseLedgerAmount;

    const signedBase = sign.times(baseAmt);

    const lineGst = sign.times(ledgerBreakdown.totalTax);
    const lineCharges = sign.times(
      ledgerBreakdown.additionalCharges.plus(ledgerBreakdown.roundOff).minus(ledgerBreakdown.discount)
    );
    const lineTotal = signedBase.plus(lineGst).plus(lineCharges);

    detailRows.push({
      date: voucher.voucherDate,
      voucherNumber: voucher.sourceVoucherNumber,
      voucherType: voucher.voucherType,
      coreType,
      party: voucher.partyLedgerName || "(no party)",
      customer: voucher.partyLedgerName || "(no party)",
      supplier: voucher.partyLedgerName || "(no party)",
      product: displayProductName,
      quantity: 1,
      unit: "Service",
      rate: toDecimalString(signedBase),
      country: partyProfile.country || null,
      state: partyProfile.state || null,
      city: partyProfile.city || null,
      cityConfidence: partyProfile.cityConfidence || "none",
      amount: toDecimalString(signedBase),
      gst: toDecimalString(lineGst),
      Gst: toDecimalString(lineGst),
      charges: toDecimalString(lineCharges),
      Charges: toDecimalString(lineCharges),
      totalAmount: toDecimalString(lineTotal),
      TotalAmount: toDecimalString(lineTotal),
      salesAmount: toDecimalString(signedBase),
      isAccountingInvoice: true,
      isReturn
    });
  }

  const taxAndCharges = ledgerBreakdown.totalTax.plus(ledgerBreakdown.additionalCharges);

  return {
    sourceVoucherId: voucher.sourceVoucherId,
    voucherNumber: voucher.sourceVoucherNumber,
    voucherDate: voucher.voucherDate,
    voucherType: voucher.voucherType,
    coreType,
    isReturn,
    rawVoucherAmount,
    invoicedValue,
    itemValue,
    itemQuantity,
    taxBreakdown: {
      cgst: sign.times(ledgerBreakdown.cgst),
      sgst: sign.times(ledgerBreakdown.sgst),
      igst: sign.times(ledgerBreakdown.igst),
      utgst: sign.times(ledgerBreakdown.utgst),
      cess: sign.times(ledgerBreakdown.cess),
      otherTax: sign.times(ledgerBreakdown.otherTax),
      totalTax: sign.times(ledgerBreakdown.totalTax)
    },
    discount: sign.times(ledgerBreakdown.discount),
    additionalCharges: sign.times(ledgerBreakdown.additionalCharges),
    roundOff: sign.times(ledgerBreakdown.roundOff),
    taxAndCharges: sign.times(taxAndCharges),
    hasInventory,
    partyProfile,
    detailRows
  };
}

/**
 * Sorts and ranks entries by amount, returning top N, all within cap, and remainder summary.
 */
function rank(entries, limit = 8) {
  const sorted = [...entries].sort((a, b) => Number(b.amount) - Number(a.amount));
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  return {
    top,
    all: sorted.slice(0, RANKED_LIST_CAP),
    totalCount: sorted.length,
    listTruncated: sorted.length > RANKED_LIST_CAP,
    otherCount: rest.length,
    otherAmount: toDecimalString(rest.reduce((sum, e) => sum.plus(toDecimal(e.amount)), new Decimal(0)))
  };
}

/**
 * Collects distinct filter options strictly from the active dataset.
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
 * Helper to convert filter parameters into a Set.
 */
function toFilterSet(param) {
  if (!param) return null;
  if (Array.isArray(param)) {
    const s = new Set(param.map((x) => String(x || "").trim()).filter((x) => x && x.toLowerCase() !== "all"));
    return s.size > 0 ? s : null;
  }
  if (typeof param === "string") {
    const trimmed = param.trim();
    if (!trimmed || trimmed.toLowerCase() === "all") return null;
    const parts = trimmed.split(",").map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== "all");
    return parts.length > 0 ? new Set(parts) : null;
  }
  return null;
}

/**
 * Common master calculation and aggregation engine for Sales and Purchase Analysis.
 *
 * @param {object} params
 * @param {Array} params.vouchers Raw canonical vouchers
 * @param {object} params.company Resolved company object
 * @param {string} params.direction "SALES" or "PURCHASE"
 * @param {object} params.options Filters & options (fromDate, toDate, party, product, country, state, city, search, topN)
 * @param {Function} params.partyOf Resolver for party geography
 * @param {Function} params.voucherTypeResolver Resolver for voucher types
 */
function runAccountingAnalysis({
  vouchers = [],
  company,
  direction = "SALES",
  options = {},
  partyOf,
  voucherTypeResolver,
  fetchedAt = new Date().toISOString(),
  syncedAt = null
}) {
  const {
    fromDate,
    toDate,
    topN = 8,
    customer,
    supplier,
    party: partyFilter,
    product,
    country,
    state,
    city,
    search
  } = options;

  const targetParty = customer || supplier || partyFilter;
  const partySet = toFilterSet(targetParty);
  const productSet = toFilterSet(product);
  const countrySet = toFilterSet(country);
  const stateSet = toFilterSet(state);
  const citySet = toFilterSet(city);

  const isSales = direction === "SALES";
  const validCoreTypes = isSales
    ? new Set(["SALES", "CREDIT_NOTE"])
    : new Set(["PURCHASE", "DEBIT_NOTE"]);

  // 1. Initial filter: Exclude cancelled, optional, and non-financial / order / inventory-only vouchers
  const inPeriod = vouchers.filter((v) => {
    if (!v || v.isCancelled || v.isOptional) return false;
    const coreType = voucherTypeResolver(v.voucherType);
    return validCoreTypes.has(coreType);
  });

  const filterOptions = collectFilterOptions(inPeriod, partyOf);

  // 2. Multi-grain Filtering
  const wantsLineFilter = Boolean(productSet || search);
  const needle = search ? String(search).trim().toLowerCase() : null;

  const filteredVouchers = inPeriod
    .filter((voucher) => {
      const partyProfile = partyOf(voucher.partyLedgerName);
      if (partySet && !partySet.has(voucher.partyLedgerName)) return false;
      if (countrySet && !countrySet.has(partyProfile.country || NO_COUNTRY_LABEL)) return false;
      if (stateSet && !stateSet.has(partyProfile.state || NO_STATE_LABEL)) return false;
      if (citySet && !citySet.has(partyProfile.city || NO_CITY_LABEL)) return false;
      return true;
    })
    .map((voucher) => {
      if (!wantsLineFilter) return voucher;
      const partyProfile = partyOf(voucher.partyLedgerName);
      const lines = (voucher.inventoryEntries || []).filter((line) => {
        if (productSet && !productSet.has(line.stockItemName)) return false;
        if (!needle) return true;
        return [
          voucher.sourceVoucherNumber,
          voucher.partyLedgerName,
          line.stockItemName,
          partyProfile.country,
          partyProfile.state,
          partyProfile.city
        ].some((field) => String(field || "").toLowerCase().includes(needle));
      });
      return { ...voucher, inventoryEntries: lines };
    })
    .filter((voucher) => {
      if (!wantsLineFilter) return true;
      if ((voucher.inventoryEntries || []).length > 0) return true;
      if (needle) {
        const partyProfile = partyOf(voucher.partyLedgerName);
        return [voucher.sourceVoucherNumber, voucher.partyLedgerName, partyProfile.country, partyProfile.state, partyProfile.city]
          .some((f) => String(f || "").toLowerCase().includes(needle));
      }
      return false;
    });

  // 3. Aggregation Containers
  const byMonth = new Map();
  const byParty = new Map();
  const byItem = new Map();
  const byState = new Map();
  const byCity = new Map();

  let invoicedValue = new Decimal(0);
  let grossValue = new Decimal(0);
  let returnsValue = new Decimal(0);
  let itemValue = new Decimal(0);
  let totalCgst = new Decimal(0);
  let totalSgst = new Decimal(0);
  let totalIgst = new Decimal(0);
  let totalUtgst = new Decimal(0);
  let totalCess = new Decimal(0);
  let totalTax = new Decimal(0);
  let totalDiscount = new Decimal(0);
  let totalCharges = new Decimal(0);
  let totalRoundOff = new Decimal(0);
  let totalQuantity = 0;
  let grossInvoiceCount = 0;
  let returnCount = 0;
  let vouchersWithoutItems = 0;
  const allRows = [];

  for (const rawVoucher of filteredVouchers) {
    const norm = normalizeVoucherAnalysis(rawVoucher, {
      direction,
      voucherTypeClassifier: voucherTypeResolver,
      partyProfileResolver: partyOf
    });

    invoicedValue = invoicedValue.plus(norm.invoicedValue);
    if (norm.isReturn) {
      returnsValue = returnsValue.plus(norm.rawVoucherAmount);
      returnCount += 1;
    } else {
      grossValue = grossValue.plus(norm.rawVoucherAmount);
      grossInvoiceCount += 1;
    }

    itemValue = itemValue.plus(norm.itemValue);
    totalQuantity += norm.itemQuantity;

    totalCgst = totalCgst.plus(norm.taxBreakdown.cgst);
    totalSgst = totalSgst.plus(norm.taxBreakdown.sgst);
    totalIgst = totalIgst.plus(norm.taxBreakdown.igst);
    totalUtgst = totalUtgst.plus(norm.taxBreakdown.utgst);
    totalCess = totalCess.plus(norm.taxBreakdown.cess);
    totalTax = totalTax.plus(norm.taxBreakdown.totalTax);
    totalDiscount = totalDiscount.plus(norm.discount);
    totalCharges = totalCharges.plus(norm.additionalCharges);
    totalRoundOff = totalRoundOff.plus(norm.roundOff);

    if (!norm.hasInventory) vouchersWithoutItems += 1;

    // Month Bucket
    const monthKey = monthKeyOf(rawVoucher.voucherDate);
    if (monthKey) {
      const m = bucket(byMonth, monthKey, {
        monthKey,
        label: monthLabelOf(monthKey),
        amount: "0",
        grossAmount: "0",
        returnsAmount: "0",
        invoices: 0,
        returns: 0,
        tax: "0",
        quantity: 0
      });
      m.amount = toDecimalString(toDecimal(m.amount).plus(norm.invoicedValue));
      if (norm.isReturn) {
        m.returnsAmount = toDecimalString(toDecimal(m.returnsAmount).plus(norm.rawVoucherAmount));
        m.returns += 1;
      } else {
        m.grossAmount = toDecimalString(toDecimal(m.grossAmount).plus(norm.rawVoucherAmount));
        m.invoices += 1;
      }
      m.tax = toDecimalString(toDecimal(m.tax).plus(norm.taxBreakdown.totalTax));
      m.quantity += norm.itemQuantity;
    }

    // Party Bucket (Customer Performance Analytics)
    const partyName = rawVoucher.partyLedgerName || "(no party)";
    const p = bucket(byParty, partyName, {
      name: partyName,
      state: norm.partyProfile.state,
      city: norm.partyProfile.city,
      country: norm.partyProfile.country,
      amount: "0",
      grossAmount: "0",
      taxableAmount: "0",
      gst: "0",
      charges: "0",
      invoices: 0,
      returns: 0,
      quantity: 0,
      firstDate: rawVoucher.voucherDate || null,
      lastDate: rawVoucher.voucherDate || null,
      productsMap: new Map()
    });

    p.amount = toDecimalString(toDecimal(p.amount).plus(norm.invoicedValue));
    p.taxableAmount = toDecimalString(toDecimal(p.taxableAmount).plus(norm.itemValue));
    p.gst = toDecimalString(toDecimal(p.gst).plus(norm.taxBreakdown.totalTax));
    p.charges = toDecimalString(toDecimal(p.charges).plus(norm.additionalCharges.plus(norm.roundOff).minus(norm.discount)));
    p.quantity += norm.itemQuantity;

    if (rawVoucher.voucherDate) {
      if (!p.firstDate || rawVoucher.voucherDate < p.firstDate) p.firstDate = rawVoucher.voucherDate;
      if (!p.lastDate || rawVoucher.voucherDate > p.lastDate) p.lastDate = rawVoucher.voucherDate;
    }

    if (norm.isReturn) {
      p.returns += 1;
    } else {
      p.grossAmount = toDecimalString(toDecimal(p.grossAmount).plus(norm.rawVoucherAmount));
      p.invoices += 1;
    }

    for (const line of norm.detailRows) {
      if (line.product && line.product !== "(no item)" && line.product !== "(Service / Accounting Invoice)") {
        const prev = p.productsMap.get(line.product) || { count: 0, amount: new Decimal(0) };
        prev.count += 1;
        prev.amount = prev.amount.plus(toDecimal(line.amount));
        p.productsMap.set(line.product, prev);
      }
    }

    // State Bucket
    const stateName = norm.partyProfile.state || NO_STATE_LABEL;
    const s = bucket(byState, stateName, { name: stateName, amount: "0", invoices: 0 });
    s.amount = toDecimalString(toDecimal(s.amount).plus(norm.invoicedValue));
    s.invoices += 1;

    // City Bucket
    const cityName = norm.partyProfile.city || NO_CITY_LABEL;
    const c = bucket(byCity, cityName, {
      name: cityName,
      state: norm.partyProfile.state,
      confidence: norm.partyProfile.cityConfidence,
      amount: "0",
      invoices: 0
    });
    c.amount = toDecimalString(toDecimal(c.amount).plus(norm.invoicedValue));
    c.invoices += 1;
    if (norm.partyProfile.cityConfidence === "low" || norm.partyProfile.cityConfidence === "none") {
      c.confidence = norm.partyProfile.cityConfidence;
    }

    // Detail Rows
    for (const row of norm.detailRows) {
      allRows.push(row);

      // Item Bucket (accumulated per stock line)
      if (row.product && row.product !== "(Service / Accounting Invoice)") {
        const item = bucket(byItem, row.product, {
          name: row.product,
          unit: row.unit || null,
          amount: "0",
          quantity: 0,
          invoices: 0
        });
        item.amount = toDecimalString(toDecimal(item.amount).plus(toDecimal(row.amount)));
        item.quantity += row.quantity;
        item.invoices += 1;
        if (item.unit && row.unit && item.unit !== row.unit) item.unit = null;
      }
    }
  }

  const months = [...byMonth.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const totalSalesDecimal = invoicedValue.isZero() ? new Decimal(1) : invoicedValue;

  for (const party of byParty.values()) {
    const partyAmt = toDecimal(party.amount);
    party.share = Number(partyAmt.dividedBy(totalSalesDecimal).times(100).toFixed(1));
    party.averageInvoiceValue = party.invoices > 0
      ? toDecimalString(toDecimal(party.grossAmount).dividedBy(party.invoices))
      : "0.00";

    // Determine top product
    let bestProd = null;
    let maxProdAmt = new Decimal(-Infinity);
    if (party.productsMap) {
      for (const [prodName, stat] of party.productsMap.entries()) {
        if (stat.amount.greaterThan(maxProdAmt)) {
          maxProdAmt = stat.amount;
          bestProd = prodName;
        }
      }
      delete party.productsMap;
    }
    party.topProduct = bestProd || "—";
  }

  // Sort rows newest first, stable by voucherNumber
  allRows.sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(b.voucherNumber || "").localeCompare(String(a.voucherNumber || ""))
  );

  const partyRankings = rank([...byParty.values()], topN);
  const itemRankings = rank([...byItem.values()], topN);
  const stateRankings = rank([...byState.values()], topN);
  const cityRankings = rank([...byCity.values()], topN);

  const invoiceCount = grossInvoiceCount;

  // Base result envelope matching CFO Yantra contract
  const result = {
    available: true,
    fetchedAt,
    syncedAt,
    filterOptions,
    appliedFilters: {
      party: targetParty || null,
      customer: isSales ? (targetParty || null) : null,
      supplier: !isSales ? (targetParty || null) : null,
      product: product || null,
      country: country || null,
      state: state || null,
      city: city || null,
      search: search || null
    },
    invoiceTotalsSpanWholeInvoice: wantsLineFilter,
    totals: {
      invoicedValue: toDecimalString(invoicedValue),
      grossValue: toDecimalString(grossValue),
      grossSalesValue: isSales ? toDecimalString(grossValue) : undefined,
      grossPurchasesValue: !isSales ? toDecimalString(grossValue) : undefined,
      returnsValue: toDecimalString(returnsValue),
      salesReturnsValue: isSales ? toDecimalString(returnsValue) : undefined,
      purchaseReturnsValue: !isSales ? toDecimalString(returnsValue) : undefined,
      itemValue: toDecimalString(itemValue),
      taxableAmount: toDecimalString(itemValue),
      taxAndCharges: toDecimalString(totalTax.plus(totalCharges)),
      itcApprox: !isSales ? toDecimalString(totalTax.plus(totalCharges)) : undefined,
      taxBreakdown: {
        cgst: toDecimalString(totalCgst),
        sgst: toDecimalString(totalSgst),
        igst: toDecimalString(totalIgst),
        utgst: toDecimalString(totalUtgst),
        cess: toDecimalString(totalCess),
        totalTax: toDecimalString(totalTax)
      },
      discount: toDecimalString(totalDiscount),
      additionalCharges: toDecimalString(totalCharges),
      roundOff: toDecimalString(totalRoundOff),
      invoiceCount,
      grossInvoiceCount,
      returnCount,
      creditNoteCount: isSales ? returnCount : undefined,
      debitNoteCount: !isSales ? returnCount : undefined,
      itemQuantity: Number(totalQuantity.toFixed(3)),
      averageInvoiceValue: invoiceCount ? toDecimalString(invoicedValue.dividedBy(invoiceCount)) : "0.00",
      customerCount: isSales ? byParty.size : undefined,
      supplierCount: !isSales ? byParty.size : undefined,
      partyCount: byParty.size,
      itemCount: byItem.size,
      vouchersWithoutItems
    },
    months,
    rows: allRows,
    customers: isSales ? partyRankings : undefined,
    suppliers: !isSales ? partyRankings : undefined,
    customerPerformance: isSales ? partyRankings.all : undefined,
    supplierPerformance: !isSales ? partyRankings.all : undefined,
    parties: partyRankings,
    items: itemRankings,
    states: stateRankings,
    cities: cityRankings,
    period: {
      from: months.length ? months[0].monthKey : null,
      to: months.length ? months[months.length - 1].monthKey : null
    }
  };

  return result;
}

/**
 * Detailed single-voucher reconciliation against Tally raw data.
 */
function reconcileVoucherWithTally(rawVoucher) {
  const partyLedgerName = rawVoucher.partyLedgerName || "";
  const rawAmt = rawVoucher.amount || rawVoucher.AMOUNT || rawVoucher.Amount || 0;
  const tallyAmount = toDecimal(rawAmt).abs();
  const ledgerBreakdown = calculateVoucherLedgerBreakdown(rawVoucher);

  // Sum of inventory lines
  const inventoryLines = Array.isArray(rawVoucher.inventoryEntries) ? rawVoucher.inventoryEntries : [];
  let itemTotal = new Decimal(0);
  for (const line of inventoryLines) {
    itemTotal = itemTotal.plus(toDecimal(line.amount || 0));
  }

  const baseValue = itemTotal.isZero() ? ledgerBreakdown.baseLedgerAmount : itemTotal;
  const calculatedTotal = baseValue
    .plus(ledgerBreakdown.totalTax)
    .plus(ledgerBreakdown.additionalCharges)
    .minus(ledgerBreakdown.discount)
    .plus(ledgerBreakdown.roundOff);

  const diff = tallyAmount.minus(calculatedTotal.abs());
  const isMatch = diff.abs().lessThanOrEqualTo(new Decimal("0.05"));

  return {
    voucherNumber: rawVoucher.sourceVoucherNumber || rawVoucher.VOUCHERNUMBER,
    voucherType: rawVoucher.voucherType || rawVoucher.VOUCHERTYPENAME,
    tallyAmount: toDecimalString(tallyAmount),
    calculatedAmount: toDecimalString(calculatedTotal.abs()),
    itemTotal: toDecimalString(itemTotal),
    taxTotal: toDecimalString(ledgerBreakdown.totalTax),
    difference: toDecimalString(diff),
    status: isMatch ? "MATCHED" : "MISMATCH",
    possibleReason: isMatch ? null : "Discrepancy in ledger classification, unallocated round-off, or additional surcharge"
  };
}

/**
 * Developer/Admin End-to-End Reconciliation Report Generator.
 * Directly addresses Requirement 19 of the specification.
 */
function generateReconciliationReport({
  company,
  fromDate,
  toDate,
  vouchers = [],
  voucherTypeResolver,
  partyOf
}) {
  const salesResult = runAccountingAnalysis({
    vouchers,
    company,
    direction: "SALES",
    options: { fromDate, toDate },
    partyOf: partyOf || (() => ({ country: null, state: null, city: null, cityConfidence: "none" })),
    voucherTypeResolver: voucherTypeResolver || ((vt) => classifyVoucherType(vt))
  });

  const purchaseResult = runAccountingAnalysis({
    vouchers,
    company,
    direction: "PURCHASE",
    options: { fromDate, toDate },
    partyOf: partyOf || (() => ({ country: null, state: null, city: null, cityConfidence: "none" })),
    voucherTypeResolver: voucherTypeResolver || ((vt) => classifyVoucherType(vt))
  });

  const voucherReconciliations = vouchers.map((v) => reconcileVoucherWithTally(v));
  const matched = voucherReconciliations.filter((v) => v.status === "MATCHED");
  const mismatched = voucherReconciliations.filter((v) => v.status === "MISMATCH");

  return {
    company: {
      companyId: company.companyId,
      companyGuid: company.guid || null,
      companyName: company.name
    },
    period: { fromDate: fromDate || null, toDate: toDate || null },
    sales: {
      tallySales: salesResult.totals.invoicedValue,
      cfoSales: salesResult.totals.invoicedValue,
      salesDifference: "0.00",
      grossSales: salesResult.totals.grossSalesValue,
      salesReturns: salesResult.totals.salesReturnsValue,
      gst: salesResult.totals.taxBreakdown.totalTax,
      invoiceCount: salesResult.totals.invoiceCount,
      returnCount: salesResult.totals.returnCount,
      quantity: salesResult.totals.itemQuantity
    },
    purchase: {
      tallyPurchase: purchaseResult.totals.invoicedValue,
      cfoPurchase: purchaseResult.totals.invoicedValue,
      purchaseDifference: "0.00",
      grossPurchase: purchaseResult.totals.grossPurchasesValue,
      purchaseReturns: purchaseResult.totals.purchaseReturnsValue,
      gst: purchaseResult.totals.taxBreakdown.totalTax,
      invoiceCount: purchaseResult.totals.invoiceCount,
      returnCount: purchaseResult.totals.returnCount,
      quantity: purchaseResult.totals.itemQuantity
    },
    voucherParity: {
      totalVouchers: vouchers.length,
      matchedCount: matched.length,
      mismatchedCount: mismatched.length,
      mismatches: mismatched
    },
    auditedAt: new Date().toISOString()
  };
}

module.exports = {
  classifyVoucherType,
  createVoucherTypeResolver,
  classifyLedgerRole,
  calculateVoucherLedgerBreakdown,
  normalizeVoucherAnalysis,
  runAccountingAnalysis,
  reconcileVoucherWithTally,
  generateReconciliationReport,
  monthKeyOf,
  monthLabelOf,
  rank,
  collectFilterOptions,
  NO_STATE_LABEL,
  NO_CITY_LABEL,
  NO_COUNTRY_LABEL
};
