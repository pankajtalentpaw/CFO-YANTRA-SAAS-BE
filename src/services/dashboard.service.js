/**
 * Company dashboard aggregation.
 *
 * One question, answered once, on the server: what did this company book in the
 * selected period, how does that compare with the period before it, and where
 * did the money come from and go to.
 *
 * Two rules shape everything below.
 *
 * 1. No second extraction. The aggregate is built from the SAME cached voucher
 *    register the Vouchers and Sales Analysis pages already read — requested
 *    with no date bounds, so it shares their cache key. A cold register costs
 *    about 11s against a live Tally; paying that twice for one screen would be
 *    indefensible. The period is then applied in memory, which is also what
 *    makes the previous-period comparison free.
 *
 * 2. Nothing is invented. Every figure is a sum of voucher amounts Tally
 *    returned. Where a classification is uncertain the voucher lands in
 *    `other` and is still reported, never quietly folded into revenue.
 */

const { Decimal, toDecimal, toDecimalString } = require("../utils/financialDecimal");
const { classifyVoucherType } = require("../integrations/tally/canonical/voucherType.canonical");
const service = require("./companyData.service");

/* ------------------------------------------------------------------ */
/* Voucher flow classification                                         */
/* ------------------------------------------------------------------ */

/**
 * What a voucher does to the business, as opposed to what Tally calls it.
 *
 * A company renames and clones voucher types freely — this one books revenue
 * under "Domestic Sales" and "Export Sales" and has no type literally named
 * "Sales" at all. Matching on the name alone would therefore miss every one of
 * its sales invoices, so the voucher type MASTER decides: its `coreType` is
 * derived from the type's name and its parent chain by the canonical layer, and
 * that is the classification used here.
 */
const FLOW = {
  SALES: "sales",
  SALES_RETURN: "salesReturns",
  PURCHASE: "purchases",
  PURCHASE_RETURN: "purchaseReturns",
  RECEIPT: "receipts",
  PAYMENT: "payments",
  CONTRA: "contra",
  ORDER: "orders",
  INVENTORY: "inventory",
  OTHER: "other"
};

/** Flows that represent money actually booked. The KPI row reports these. */
const MONEY_FLOWS = new Set([FLOW.SALES, FLOW.PURCHASE, FLOW.RECEIPT, FLOW.PAYMENT]);

/**
 * Types that move goods rather than money. Tally's core classification calls a
 * "Receipt Note" a RECEIPT, but no cash arrives with it — counting one as money
 * in would overstate collections.
 */
const INVENTORY_MOVEMENT =
  /delivery note|delivery challan|receipt note|material in|material out|rejections|physical stock|stock journal/;

/**
 * Build the voucher-type to flow resolver for one company.
 *
 * Falls back to the canonical name/parent classifier when a voucher references
 * a type the master does not list, so an unlisted type is still classified
 * rather than dropped.
 */
function buildFlowResolver(voucherTypeRecords) {
  const byName = new Map();
  for (const type of voucherTypeRecords || []) {
    if (type && type.name) byName.set(type.name.toLowerCase(), type);
  }

  const memo = new Map();
  return (voucherTypeName) => {
    const name = String(voucherTypeName || "").toLowerCase();
    if (memo.has(name)) return memo.get(name);

    const master = byName.get(name);
    const parent = String((master && master.parent) || "").toLowerCase();
    const core = (master && master.coreType) || classifyVoucherType(name, parent);

    let flow;
    // Orders are commitments, not bookings. Tally's core classification sorts
    // "Purchase Order" under PURCHASE; counting those alongside the purchases
    // actually invoiced would nearly double the figure.
    if (name.includes("order") || parent.includes("order") || core === "ORDERS") flow = FLOW.ORDER;
    else if (INVENTORY_MOVEMENT.test(name) || INVENTORY_MOVEMENT.test(parent)) flow = FLOW.INVENTORY;
    else if (core === "CREDIT_NOTE") flow = FLOW.SALES_RETURN;
    else if (core === "DEBIT_NOTE") flow = FLOW.PURCHASE_RETURN;
    else if (core === "SALES") flow = FLOW.SALES;
    else if (core === "PURCHASE") flow = FLOW.PURCHASE;
    else if (core === "RECEIPT") flow = FLOW.RECEIPT;
    else if (core === "PAYMENT") flow = FLOW.PAYMENT;
    else if (core === "CONTRA") flow = FLOW.CONTRA;
    else flow = FLOW.OTHER;

    memo.set(name, flow);
    return flow;
  };
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** yyyymmdd (the wire format every endpoint here uses) to yyyy-mm-dd. */
function toIsoBound(compact) {
  if (!compact) return null;
  const match = String(compact).match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function toUtcDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`);
}

function toIsoString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoString(date);
}

/** Whole days between two ISO dates, counting both ends. */
function daysBetween(fromIso, toIso) {
  const ms = toUtcDate(toIso).getTime() - toUtcDate(fromIso).getTime();
  return Math.round(ms / 86400000) + 1;
}

function monthKeyOf(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function monthLabelOf(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

/**
 * Every month between two keys inclusive.
 *
 * The series is built from the calendar, not from the data: a month in which
 * the company booked nothing must appear as a zero, otherwise a gap in trading
 * reads on the chart as a shorter axis rather than as a quiet month.
 */
function monthRange(fromKey, toKey) {
  const keys = [];
  if (!fromKey || !toKey) return keys;
  let [year, month] = fromKey.split("-").map(Number);
  const [endYear, endMonth] = toKey.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/* Accumulation                                                        */
/* ------------------------------------------------------------------ */

/** Running totals for one window of time. */
function emptyTotals() {
  const totals = {};
  for (const flow of Object.values(FLOW)) {
    totals[flow] = { amount: new Decimal(0), count: 0 };
  }
  return totals;
}

function addTo(totals, flow, amount) {
  const target = totals[flow];
  target.amount = target.amount.plus(amount);
  target.count += 1;
}

/** Percentage change, or null when there is no base to compare against. */
function changePct(current, previous) {
  const now = Number(current);
  const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return Number((((now - before) / Math.abs(before)) * 100).toFixed(1));
}

/** One KPI: the value, the same value last period, and the movement between. */
function kpi(current, previous, extra = {}) {
  return {
    amount: toDecimalString(current.amount),
    count: current.count,
    previousAmount: toDecimalString(previous.amount),
    previousCount: previous.count,
    changePct: changePct(current.amount, previous.amount),
    ...extra
  };
}

/** Sort by amount, keep the top N, and report what the tail holds. */
function rank(entries, limit) {
  const sorted = entries.sort((a, b) => Number(b.amount) - Number(a.amount));
  return {
    top: sorted.slice(0, limit),
    otherCount: Math.max(sorted.length - limit, 0),
    otherAmount: toDecimalString(
      sorted.slice(limit).reduce((sum, entry) => sum.plus(toDecimal(entry.amount)), new Decimal(0))
    )
  };
}

function bucket(map, key, seed) {
  if (!map.has(key)) map.set(key, { ...seed });
  return map.get(key);
}

/* ------------------------------------------------------------------ */
/* The aggregate                                                       */
/* ------------------------------------------------------------------ */

const NO_PARTY_LABEL = "(no party)";
const NO_STATE_LABEL = "(no state)";

/**
 * Everything the dashboard draws, for one company and one period.
 *
 * @param {object} company Resolved company scope
 * @param {object} [options]
 * @param {string} [options.fromDate] yyyymmdd — defaults to the last 12 months
 * @param {string} [options.toDate]   yyyymmdd
 * @param {number} [options.topN]
 * @param {number} [options.recentLimit]
 */
async function getDashboard(company, options = {}) {
  const { topN = 7, recentLimit = 8 } = options;

  // No date bounds: deliberately the whole register, so this shares the cache
  // entry the other company pages already populated, and so the
  // previous-period comparison has the history it needs.
  // Entries included: the top-items panel and the recent-voucher item counts
  // below both read voucher.inventoryEntries, and the mirror only serves the
  // shape it was asked for.
  const register = await service.getVouchers(company, { includeEntries: true });
  if (!register.available) return { available: false, reason: register.reason };

  const voucherTypes = await service.getDomain(company, "voucherTypes");
  const flowOf = buildFlowResolver(voucherTypes.available ? voucherTypes.records : []);
  const partyOf = await service.getPartyProfileResolver(company);

  const dated = register.records.filter((v) => v.voucherDate);
  const registerSpan = dated.length
    ? dated.reduce(
        (span, v) => ({
          from: v.voucherDate < span.from ? v.voucherDate : span.from,
          to: v.voucherDate > span.to ? v.voucherDate : span.to
        }),
        { from: dated[0].voucherDate, to: dated[0].voucherDate }
      )
    : { from: null, to: null };

  // Default window: the last 12 months up to today. Explicit bounds always win.
  const today = toIsoString(new Date());
  const periodTo = toIsoBound(options.toDate) || today;
  const periodFrom = toIsoBound(options.fromDate) || addDays(periodTo, -364);

  const periodDays = Math.max(daysBetween(periodFrom, periodTo), 1);
  // The window of equal length ending the day before this one starts.
  const previousTo = addDays(periodFrom, -1);
  const previousFrom = addDays(previousTo, -(periodDays - 1));

  const current = emptyTotals();
  const previous = emptyTotals();

  const byMonth = new Map();
  const byCustomer = new Map();
  const byItem = new Map();
  const byState = new Map();
  const customersBilled = new Set();
  const previousCustomersBilled = new Set();

  let cancelledInPeriod = 0;
  let salesItemValue = new Decimal(0);
  let salesItemQuantity = 0;
  const recent = [];

  for (const voucher of register.records) {
    const date = voucher.voucherDate;
    if (!date) continue;

    const inCurrent = date >= periodFrom && date <= periodTo;
    const inPrevious = date >= previousFrom && date <= previousTo;
    if (!inCurrent && !inPrevious) continue;

    // A cancelled voucher is a voucher that did not happen. It is counted so
    // the coverage note can say how many were skipped, and nothing else.
    if (voucher.isCancelled) {
      if (inCurrent) cancelledInPeriod += 1;
      continue;
    }

    const flow = flowOf(voucher.voucherType);
    const amount = toDecimal(voucher.amount || 0);

    if (inPrevious) {
      addTo(previous, flow, amount);
      if (flow === FLOW.SALES && voucher.partyLedgerName) {
        previousCustomersBilled.add(voucher.partyLedgerName);
      }
      continue;
    }

    addTo(current, flow, amount);

    const monthKey = monthKeyOf(date);
    if (monthKey && MONEY_FLOWS.has(flow)) {
      const month = bucket(byMonth, monthKey, {
        monthKey,
        label: monthLabelOf(monthKey),
        sales: "0", purchases: "0", receipts: "0", payments: "0", salesCount: 0
      });
      month[flow] = toDecimalString(toDecimal(month[flow]).plus(amount));
      if (flow === FLOW.SALES) month.salesCount += 1;
    }

    // Recent activity spans every category: an operator watching the register
    // wants the last thing that happened, not the last sale.
    recent.push({
      date,
      voucherNumber: voucher.sourceVoucherNumber,
      voucherType: voucher.voucherType,
      category: flow,
      party: voucher.partyLedgerName,
      amount: toDecimalString(amount),
      itemCount: (voucher.inventoryEntries || []).length
    });

    if (flow !== FLOW.SALES) continue;

    /* Sales-only breakdowns below. */
    const party = partyOf(voucher.partyLedgerName);
    const customerName = voucher.partyLedgerName || NO_PARTY_LABEL;
    if (voucher.partyLedgerName) customersBilled.add(voucher.partyLedgerName);

    const customer = bucket(byCustomer, customerName, {
      name: customerName, state: party.state, city: party.city, amount: "0", invoices: 0
    });
    customer.amount = toDecimalString(toDecimal(customer.amount).plus(amount));
    customer.invoices += 1;

    // A party Tally holds no state for is grouped as unknown, never guessed.
    const stateName = party.state || NO_STATE_LABEL;
    const state = bucket(byState, stateName, { name: stateName, amount: "0", invoices: 0 });
    state.amount = toDecimalString(toDecimal(state.amount).plus(amount));
    state.invoices += 1;

    for (const line of voucher.inventoryEntries || []) {
      if (!line.stockItemName) continue;
      const lineAmount = toDecimal(line.amount || 0);
      salesItemValue = salesItemValue.plus(lineAmount);
      if (typeof line.quantity === "number") salesItemQuantity += line.quantity;

      const item = bucket(byItem, line.stockItemName, {
        name: line.stockItemName, unit: line.unit || null, amount: "0", quantity: 0, invoices: 0
      });
      item.amount = toDecimalString(toDecimal(item.amount).plus(lineAmount));
      if (typeof line.quantity === "number") item.quantity += line.quantity;
      item.invoices += 1;
      // Two units cannot be summed into one number.
      if (item.unit && line.unit && item.unit !== line.unit) item.unit = null;
    }
  }

  /*
   * The month axis, zero-filled from the calendar so the plot never lies about
   * a quiet month — but clipped to the months the register actually covers.
   *
   * The distinction matters. A month inside the register with no vouchers is a
   * real zero: nothing was booked. A month after the last voucher Tally holds is
   * not zero, it is not yet recorded, and drawing it at the floor turns "we have
   * not entered August yet" into a line falling off a cliff.
   */
  const axisFrom = registerSpan.from && registerSpan.from > periodFrom ? registerSpan.from : periodFrom;
  const axisTo = registerSpan.to && registerSpan.to < periodTo ? registerSpan.to : periodTo;
  const monthly = (axisFrom <= axisTo ? monthRange(monthKeyOf(axisFrom), monthKeyOf(axisTo)) : []).map(
    (key) =>
      byMonth.get(key) || {
        monthKey: key,
        label: monthLabelOf(key),
        sales: "0", purchases: "0", receipts: "0", payments: "0", salesCount: 0
      }
  );

  recent.sort(
    (a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      String(b.voucherNumber || "").localeCompare(String(a.voucherNumber || ""))
  );

  const netCash = current[FLOW.RECEIPT].amount.minus(current[FLOW.PAYMENT].amount);
  const previousNetCash = previous[FLOW.RECEIPT].amount.minus(previous[FLOW.PAYMENT].amount);
  const avgInvoice = current[FLOW.SALES].count
    ? current[FLOW.SALES].amount.dividedBy(current[FLOW.SALES].count)
    : new Decimal(0);
  const previousAvgInvoice = previous[FLOW.SALES].count
    ? previous[FLOW.SALES].amount.dividedBy(previous[FLOW.SALES].count)
    : new Decimal(0);

  return {
    available: true,
    fetchedAt: register.fetchedAt,
    syncedAt: register.syncedAt || null,
    source: register.source || "tally",
    period: { from: periodFrom, to: periodTo, days: periodDays },
    previousPeriod: { from: previousFrom, to: previousTo },
    // What the register actually holds, so the UI can say "nothing in this
    // window" without implying the company has no data at all.
    registerSpan,
    kpis: {
      sales: kpi(current[FLOW.SALES], previous[FLOW.SALES]),
      purchases: kpi(current[FLOW.PURCHASE], previous[FLOW.PURCHASE]),
      receipts: kpi(current[FLOW.RECEIPT], previous[FLOW.RECEIPT]),
      payments: kpi(current[FLOW.PAYMENT], previous[FLOW.PAYMENT]),
      netCash: {
        amount: toDecimalString(netCash),
        previousAmount: toDecimalString(previousNetCash),
        changePct: changePct(netCash, previousNetCash)
      },
      avgInvoice: {
        amount: toDecimalString(avgInvoice),
        previousAmount: toDecimalString(previousAvgInvoice),
        changePct: changePct(avgInvoice, previousAvgInvoice)
      },
      customersBilled: {
        count: customersBilled.size,
        previousCount: previousCustomersBilled.size,
        changePct: changePct(customersBilled.size, previousCustomersBilled.size)
      },
      salesReturns: kpi(current[FLOW.SALES_RETURN], previous[FLOW.SALES_RETURN]),
      purchaseReturns: kpi(current[FLOW.PURCHASE_RETURN], previous[FLOW.PURCHASE_RETURN]),
      // Item value excludes tax — it sums stock lines, and tax sits on the
      // voucher. Reported beside invoiced value, never reconciled into it.
      salesItemValue: toDecimalString(salesItemValue),
      salesItemQuantity: Number(salesItemQuantity.toFixed(3))
    },
    monthly,
    topCustomers: rank([...byCustomer.values()], topN),
    topItems: rank([...byItem.values()], topN),
    topStates: rank([...byState.values()], topN),
    // Every category in the period, including the ones the KPI row does not
    // report, so nothing the company booked goes unaccounted for.
    voucherMix: Object.values(FLOW)
      .map((flow) => ({
        category: flow,
        count: current[flow].count,
        amount: toDecimalString(current[flow].amount)
      }))
      .filter((entry) => entry.count > 0),
    recentVouchers: recent.slice(0, recentLimit),
    coverage: {
      registerCount: register.records.length,
      periodCount: Object.values(current).reduce((sum, entry) => sum + entry.count, 0),
      cancelledInPeriod,
      // Orders are carried here rather than in sales/purchases, and the UI says so.
      orderCount: current[FLOW.ORDER].count,
      orderAmount: toDecimalString(current[FLOW.ORDER].amount),
      voucherTypesResolved: voucherTypes.available
    }
  };
}

module.exports = {
  getDashboard,
  // Exported for tests: classification is the one place a wrong answer would
  // silently misstate revenue.
  buildFlowResolver,
  monthRange,
  changePct,
  FLOW
};
