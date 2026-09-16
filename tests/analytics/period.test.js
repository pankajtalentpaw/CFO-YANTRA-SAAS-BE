const {
  toOrdinal,
  fromOrdinal,
  parseDateParts,
  makePeriod,
  resolveRowPeriod,
  findModalYear,
  buildPeriodAxis,
  rowPeriodKey,
  MAX_PERIODS,
  SYNTHETIC_YEAR
} = require("../../src/analytics/compute/shared/period");

/** A live-pipeline row: carries _meta.voucherDate. */
const dated = (isoDate, amount = "1000") => ({
  SalesAmount: amount,
  Month: null,
  MonthNum: null,
  _meta: { voucherDate: isoDate }
});

/** A legacy/fixture row: Month + MonthNum only, no _meta. */
const legacy = (monthName, monthNum, amount = "1000") => ({
  SalesAmount: amount,
  Month: monthName,
  MonthNum: monthNum
});

describe("period — ordinals", () => {
  test("round-trips year/month through the ordinal", () => {
    for (const [year, monthNum] of [[2025, 1], [2025, 12], [2026, 1], [1999, 7]]) {
      expect(fromOrdinal(toOrdinal(year, monthNum))).toEqual({ year, monthNum });
    }
  });

  test("consecutive months are consecutive ordinals across a year boundary", () => {
    expect(toOrdinal(2026, 1) - toOrdinal(2025, 12)).toBe(1);
  });
});

describe("period — date parsing", () => {
  test("accepts ISO dates from _meta.voucherDate", () => {
    expect(parseDateParts("2025-01-17")).toEqual({ year: 2025, monthNum: 1 });
  });

  test("accepts the compact yyyymmdd form used by the query params", () => {
    expect(parseDateParts("20260131")).toEqual({ year: 2026, monthNum: 1 });
  });

  test("rejects junk rather than guessing", () => {
    for (const bad of ["", null, undefined, "January", "2025", "not-a-date", "2025-13-01"]) {
      expect(parseDateParts(bad)).toBeNull();
    }
  });
});

describe("period — labels", () => {
  test("labels match the workbook's Jan-25 format", () => {
    expect(makePeriod(2025, 1, 0).label).toBe("Jan-25");
    expect(makePeriod(2026, 1, 0).label).toBe("Jan-26");
    expect(makePeriod(2025, 12, 0).label).toBe("Dec-25");
  });

  test("keys sort lexicographically in chronological order", () => {
    const keys = [makePeriod(2026, 1, 0), makePeriod(2025, 2, 0), makePeriod(2025, 12, 0)]
      .map((p) => p.key)
      .sort();
    expect(keys).toEqual(["2025-02", "2025-12", "2026-01"]);
  });
});

describe("period — the fallback ladder", () => {
  test("1. uses the real year when _meta.voucherDate is present", () => {
    expect(resolveRowPeriod(dated("2025-03-09"), null)).toEqual({ year: 2025, monthNum: 3, fallback: false });
  });

  test("2. falls back to the modal year of the dated rows", () => {
    const rows = [dated("2025-01-01"), dated("2025-06-01"), dated("2026-01-01")];
    expect(findModalYear(rows)).toBe(2025);
    expect(resolveRowPeriod(legacy("March", 3), 2025)).toEqual({ year: 2025, monthNum: 3, fallback: true });
  });

  test("3. falls back to a synthetic year when nothing is dated", () => {
    expect(findModalYear([legacy("April", 4)])).toBeNull();
    expect(resolveRowPeriod(legacy("April", 4), null)).toEqual({
      year: SYNTHETIC_YEAR,
      monthNum: 4,
      fallback: true
    });
  });

  test("resolves the month from the name when MonthNum is missing", () => {
    expect(resolveRowPeriod({ Month: "September" }, 2025).monthNum).toBe(9);
    expect(resolveRowPeriod({ Month: "Sep-25" }, 2025).monthNum).toBe(9);
  });

  test("returns null for a row with no usable month at all", () => {
    expect(resolveRowPeriod({ SalesAmount: "100" }, 2025)).toBeNull();
    expect(rowPeriodKey({ SalesAmount: "100" }, 2025)).toBeNull();
  });
});

describe("buildPeriodAxis — the 13-month window crossing a year boundary", () => {
  const rows = [];
  for (let m = 1; m <= 12; m++) rows.push(dated(`2025-${String(m).padStart(2, "0")}-15`));
  rows.push(dated("2026-01-15"));

  test("produces 13 distinct periods, not 12 merged ones", () => {
    const { periods } = buildPeriodAxis(rows, { fromDate: "20250101", toDate: "20260131" });
    expect(periods).toHaveLength(13);
    expect(periods[0].label).toBe("Jan-25");
    expect(periods[12].label).toBe("Jan-26");
  });

  test("keeps the two Januaries apart", () => {
    const { periods, periodIndex } = buildPeriodAxis(rows, { fromDate: "20250101", toDate: "20260131" });
    const januaries = periods.filter((p) => p.monthName === "January");
    expect(januaries).toHaveLength(2);
    expect(periodIndex.get("2025-01")).toBeDefined();
    expect(periodIndex.get("2026-01")).toBeDefined();
  });

  test("flags the collision the legacy filters would silently merge", () => {
    const { meta } = buildPeriodAxis(rows, { fromDate: "20250101", toDate: "20260131" });
    expect(meta.legacyMonthCollision).toBe(true);
  });

  test("a window inside one year reports no collision", () => {
    const { meta, periods } = buildPeriodAxis(rows.slice(0, 12), { fromDate: "20250101", toDate: "20251231" });
    expect(periods).toHaveLength(12);
    expect(meta.legacyMonthCollision).toBe(false);
  });
});

describe("buildPeriodAxis — density", () => {
  test("inserts a period for a month with no rows at all", () => {
    // Jan, Feb, then nothing until May.
    const rows = [dated("2025-01-10"), dated("2025-02-10"), dated("2025-05-10")];
    const { periods } = buildPeriodAxis(rows);
    expect(periods.map((p) => p.label)).toEqual(["Jan-25", "Feb-25", "Mar-25", "Apr-25", "May-25"]);
  });

  test("honours the requested window when the trailing month has no sales", () => {
    // The spec case: 13 months asked for, data stops in Dec.
    const rows = [dated("2025-01-10"), dated("2025-12-10")];
    const { periods } = buildPeriodAxis(rows, { fromDate: "20250101", toDate: "20260131" });
    expect(periods).toHaveLength(13);
    expect(periods[12].key).toBe("2026-01");
  });

  test("indices are dense and match array position", () => {
    const rows = [dated("2025-01-10"), dated("2025-06-10")];
    const { periods } = buildPeriodAxis(rows);
    periods.forEach((p, i) => expect(p.index).toBe(i));
  });

  test("widens rather than dropping rows that fall outside the window", () => {
    const rows = [dated("2024-11-10"), dated("2025-03-10")];
    const { periods } = buildPeriodAxis(rows, { fromDate: "20250101", toDate: "20250331" });
    expect(periods[0].key).toBe("2024-11");
    expect(periods[periods.length - 1].key).toBe("2025-03");
  });
});

describe("buildPeriodAxis — legacy rows with no _meta", () => {
  test("orders by MonthNum alone, exactly as the legacy engine does", () => {
    const rows = [legacy("July", 7), legacy("April", 4), legacy("June", 6), legacy("May", 5)];
    const { periods, meta } = buildPeriodAxis(rows);
    expect(periods.map((p) => p.monthName)).toEqual(["April", "May", "June", "July"]);
    expect(meta.periodsFromFallback).toBe(4);
    expect(meta.legacyMonthCollision).toBe(false);
  });

  test("counts fallbacks instead of degrading silently", () => {
    const rows = [dated("2025-01-10"), legacy("February", 2), legacy("March", 3)];
    const { meta } = buildPeriodAxis(rows);
    expect(meta.periodsFromFallback).toBe(2);
    expect(meta.unresolvedRows).toBe(0);
  });

  test("counts rows it cannot place", () => {
    const { meta } = buildPeriodAxis([dated("2025-01-10"), { SalesAmount: "50" }]);
    expect(meta.unresolvedRows).toBe(1);
  });
});

describe("buildPeriodAxis — degenerate input", () => {
  test("empty input yields an empty axis, not a throw", () => {
    for (const input of [[], null, undefined]) {
      const { periods, periodIndex } = buildPeriodAxis(input);
      expect(periods).toEqual([]);
      expect(periodIndex.size).toBe(0);
    }
  });

  test("a window with no data still enumerates the requested months", () => {
    const { periods } = buildPeriodAxis([], { fromDate: "20250101", toDate: "20250331" });
    expect(periods.map((p) => p.key)).toEqual(["2025-01", "2025-02", "2025-03"]);
  });

  test("a single month yields a single period", () => {
    const { periods, meta } = buildPeriodAxis([dated("2025-07-04")]);
    expect(periods).toHaveLength(1);
    expect(periods[0].label).toBe("Jul-25");
    expect(meta.legacyMonthCollision).toBe(false);
  });

  test("caps an absurd span rather than enumerating centuries", () => {
    const rows = [dated("1900-01-10"), dated("2999-12-10")];
    const { periods, meta } = buildPeriodAxis(rows);
    expect(periods).toHaveLength(MAX_PERIODS);
    expect(meta.truncated).toBe(true);
  });

  test("preserves the requested range in meta for the response envelope", () => {
    const { meta } = buildPeriodAxis([], { fromDate: "20250101", toDate: "20260131" });
    expect(meta.requestedRange).toEqual({ fromDate: "20250101", toDate: "20260131" });
  });
});
