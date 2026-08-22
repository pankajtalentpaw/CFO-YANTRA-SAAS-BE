/**
 * Dashboard aggregation.
 *
 * The classification tests carry the weight here. Every other figure on the
 * dashboard is a sum, and a sum is only as right as the bucket it lands in —
 * the live instance this was built against books revenue under "Domestic Sales"
 * and "Export Sales" and has no voucher type named "Sales" at all, so a
 * name-matching classifier would report zero revenue with total confidence.
 */

const service = require("../src/services/companyData.service");
const dashboard = require("../src/services/dashboard.service");
const { buildFlowResolver, monthRange, changePct, FLOW } = dashboard;

/** The voucher type master as this company actually has it. */
const VOUCHER_TYPES = [
  { name: "Domestic Sales", parent: "Export Sales", coreType: "SALES" },
  { name: "Export Sales", parent: "Export Sales", coreType: "SALES" },
  { name: "Credit Note", parent: "Credit Note", coreType: "CREDIT_NOTE" },
  { name: "Debit Note", parent: "Debit Note", coreType: "DEBIT_NOTE" },
  { name: "Purchase", parent: "Purchase", coreType: "PURCHASE" },
  { name: "Purchase Order", parent: "Purchase Order", coreType: "PURCHASE" },
  { name: "Sales Order", parent: "Sales Order", coreType: "SALES" },
  { name: "Receipt", parent: "Receipt", coreType: "RECEIPT" },
  { name: "Receipt Note", parent: "Receipt Note", coreType: "RECEIPT" },
  { name: "Payment", parent: "Payment", coreType: "PAYMENT" },
  { name: "Contra", parent: "Contra", coreType: "CONTRA" },
  { name: "Journal", parent: "Journal", coreType: "JOURNAL" },
  { name: "Stock Journal", parent: "Stock Journal", coreType: "JOURNAL" },
  { name: "Delivery Challan", parent: "Delivery Note", coreType: "OTHER" }
];

describe("Voucher flow classification", () => {
  const flowOf = buildFlowResolver(VOUCHER_TYPES);

  test("classifies renamed sales voucher types as sales", () => {
    expect(flowOf("Domestic Sales")).toBe(FLOW.SALES);
    expect(flowOf("Export Sales")).toBe(FLOW.SALES);
  });

  test("keeps orders out of sales and purchases", () => {
    // Tally's core classification files a Purchase Order under PURCHASE. Adding
    // its value to the purchases KPI would nearly double the figure.
    expect(flowOf("Purchase Order")).toBe(FLOW.ORDER);
    expect(flowOf("Sales Order")).toBe(FLOW.ORDER);
  });

  test("keeps goods movement out of the money flows", () => {
    // A Receipt Note is inventory arriving, not cash.
    expect(flowOf("Receipt Note")).toBe(FLOW.INVENTORY);
    expect(flowOf("Delivery Challan")).toBe(FLOW.INVENTORY);
    expect(flowOf("Stock Journal")).toBe(FLOW.INVENTORY);
  });

  test("separates returns from the bookings they reverse", () => {
    expect(flowOf("Credit Note")).toBe(FLOW.SALES_RETURN);
    expect(flowOf("Debit Note")).toBe(FLOW.PURCHASE_RETURN);
  });

  test("classifies the remaining money flows", () => {
    expect(flowOf("Receipt")).toBe(FLOW.RECEIPT);
    expect(flowOf("Payment")).toBe(FLOW.PAYMENT);
    expect(flowOf("Contra")).toBe(FLOW.CONTRA);
    expect(flowOf("Journal")).toBe(FLOW.OTHER);
  });

  test("falls back to the canonical classifier for a type the master omits", () => {
    // A voucher can reference a type the master did not return; it must still
    // be classified rather than silently dropped into `other`.
    expect(flowOf("Retail Sales")).toBe(FLOW.SALES);
    expect(flowOf("Bank Payment")).toBe(FLOW.PAYMENT);
    expect(flowOf("Something Unheard Of")).toBe(FLOW.OTHER);
  });

  test("is case-insensitive about voucher type names", () => {
    expect(flowOf("domestic sales")).toBe(FLOW.SALES);
    expect(flowOf("PAYMENT")).toBe(FLOW.PAYMENT);
  });
});

describe("Period arithmetic", () => {
  test("builds a continuous month axis across a year boundary", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  test("a single month is a one-entry axis", () => {
    expect(monthRange("2026-03", "2026-03")).toEqual(["2026-03"]);
  });

  test("reports no change against a zero base rather than infinity", () => {
    expect(changePct(100, 0)).toBeNull();
    expect(changePct(0, 0)).toBeNull();
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(50, 100)).toBe(-50);
  });
});

describe("Dashboard aggregate", () => {
  const COMPANY = { companyId: "guid-dash-1", name: "Dash Co", startingAt: "2025-04-01" };

  /** One register row, at the grain getVouchers returns. */
  function voucher(date, voucherType, amount, extra = {}) {
    return {
      sourceVoucherId: `${voucherType}-${date}-${amount}`,
      sourceVoucherNumber: extra.number || `${voucherType}/1`,
      voucherType,
      voucherDate: date,
      partyLedgerName: extra.party || "Acme Traders",
      amount: String(amount),
      isCancelled: extra.isCancelled || false,
      inventoryEntries: extra.inventoryEntries || [],
      ledgerEntries: []
    };
  }

  const REGISTER = [
    // In period (2026-01-01 .. 2026-03-31)
    voucher("2026-01-15", "Domestic Sales", 100000, { inventoryEntries: [{ stockItemName: "Pump", quantity: 2, unit: "NOS", amount: "90000" }] }),
    voucher("2026-02-10", "Export Sales", 300000, { party: "Overseas Ltd" }),
    voucher("2026-02-20", "Purchase Order", 500000),
    voucher("2026-03-01", "Purchase", 50000),
    voucher("2026-03-05", "Receipt", 80000),
    voucher("2026-03-06", "Payment", 30000),
    voucher("2026-03-07", "Credit Note", 5000),
    voucher("2026-03-08", "Domestic Sales", 999999, { isCancelled: true }),
    // Previous period (2025-10-03 .. 2025-12-31)
    voucher("2025-11-11", "Domestic Sales", 200000),
    voucher("2025-12-01", "Receipt", 40000),
    // Outside both windows entirely
    voucher("2024-06-01", "Domestic Sales", 777777)
  ];

  beforeEach(() => {
    jest.spyOn(service, "getVouchers").mockResolvedValue({
      available: true, records: REGISTER, fetchedAt: "2026-04-01T00:00:00.000Z", source: "voucherRegister"
    });
    jest.spyOn(service, "getDomain").mockResolvedValue({ available: true, records: VOUCHER_TYPES });
    jest.spyOn(service, "getPartyProfileResolver").mockResolvedValue((party) =>
      party === "Overseas Ltd"
        ? { country: "Poland", state: null, city: "Warsaw", cityConfidence: "high" }
        : { country: "India", state: "Gujarat", city: "Rajkot", cityConfidence: "high" }
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const run = () => dashboard.getDashboard(COMPANY, { fromDate: "20260101", toDate: "20260331" });

  test("totals each flow over the requested period only", async () => {
    const result = await run();
    expect(result.available).toBe(true);
    // 100000 + 300000. The cancelled sale and the 2024 sale are both excluded.
    expect(result.kpis.sales.amount).toBe("400000.00");
    expect(result.kpis.sales.count).toBe(2);
    expect(result.kpis.purchases.amount).toBe("50000.00");
    expect(result.kpis.receipts.amount).toBe("80000.00");
    expect(result.kpis.payments.amount).toBe("30000.00");
    expect(result.kpis.salesReturns.count).toBe(1);
  });

  test("compares against the preceding window of equal length", async () => {
    const result = await run();
    expect(result.period).toEqual({ from: "2026-01-01", to: "2026-03-31", days: 90 });
    expect(result.previousPeriod).toEqual({ from: "2025-10-03", to: "2025-12-31" });
    expect(result.kpis.sales.previousAmount).toBe("200000.00");
    expect(result.kpis.sales.changePct).toBe(100);
  });

  test("excludes orders from the money figures but still reports them", async () => {
    const result = await run();
    expect(result.kpis.purchases.amount).toBe("50000.00");
    expect(result.coverage.orderCount).toBe(1);
    expect(result.coverage.orderAmount).toBe("500000.00");
  });

  test("counts a cancelled voucher as excluded, never as a booking", async () => {
    const result = await run();
    expect(result.coverage.cancelledInPeriod).toBe(1);
  });

  test("breaks sales down by customer, state and item", async () => {
    const result = await run();
    expect(result.topCustomers.top[0]).toMatchObject({ name: "Overseas Ltd", amount: "300000.00", invoices: 1 });
    // A party with no state in Tally is grouped as unknown, never guessed.
    expect(result.topStates.top.map((s) => s.name)).toContain("(no state)");
    expect(result.topItems.top[0]).toMatchObject({ name: "Pump", amount: "90000.00", quantity: 2, unit: "NOS" });
    // Item value sums stock lines only, so it is below the invoiced total.
    expect(result.kpis.salesItemValue).toBe("90000.00");
  });

  test("clips the month axis to the months the register actually covers", async () => {
    // The period runs to 31 Mar but the register stops on 8 Mar; the axis must
    // not draw April as a zero, and must not stop before March either.
    const result = await run();
    expect(result.monthly.map((m) => m.monthKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(result.monthly[0].sales).toBe("100000.00");
    expect(result.monthly[1].sales).toBe("300000.00");
  });

  test("lists recent activity across every category, newest first", async () => {
    const result = await run();
    expect(result.recentVouchers[0].date).toBe("2026-03-07");
    expect(result.recentVouchers.map((v) => v.category)).toContain("payments");
    // The cancelled voucher never appears.
    expect(result.recentVouchers.some((v) => v.amount === "999999.00")).toBe(false);
  });

  test("reports unavailability instead of zeroes when the register cannot be read", async () => {
    service.getVouchers.mockResolvedValue({ available: false, reason: { code: "TALLY_UNREACHABLE" } });
    const result = await dashboard.getDashboard(COMPANY, {});
    expect(result.available).toBe(false);
    expect(result.reason.code).toBe("TALLY_UNREACHABLE");
  });
});
