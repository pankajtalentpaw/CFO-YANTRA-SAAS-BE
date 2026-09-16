/**
 * The cube must reproduce 02_MAIN_MIS from 01_RAW_DATA. Both sides of that
 * comparison are generated from the workbook (scripts/extractWorkbookFixture.js),
 * so this is a direct check against the spec rather than against a prior run.
 */

const { buildAnalyticsCube } = require("../../src/analytics/compute/shared/analyticsCube.builder");
const { resolveCity } = require("../../src/integrations/tally/sales/misReport5/misReport5.engine");
const stats = require("../../src/analytics/compute/shared/stats");
const {
  WORKBOOK_FACTS,
  WORKBOOK_MONTHS,
  EXPECTED_MAIN_MIS,
  WORKBOOK_TOTALS
} = require("./fixtures/workbook");

const WINDOW = { fromDate: "20250101", toDate: "20260131" };

/**
 * The cube places rows on the same canonical city names the legacy engine uses,
 * so the two views of one dataset can never disagree about where revenue sits.
 * That mapping renames the workbook's "New Delhi" to "Delhi". The revenue is
 * identical; only the label is canonical, so expectations translate through the
 * same function rather than the cube skipping canonicalisation.
 */
const canon = (city) => resolveCity({ City: city });

const near = (actual, expected, precision = 4) => {
  expect(actual).not.toBeNull();
  expect(Number(actual.toString())).toBeCloseTo(expected, precision);
};

describe("analytics cube — fixture sanity", () => {
  test("the generated fixture is the workbook's own dataset", () => {
    expect(WORKBOOK_FACTS).toHaveLength(156);
    expect(WORKBOOK_TOTALS.grandTotal).toBe(3387500);
    expect(WORKBOOK_TOTALS.cities).toEqual(["Ahmedabad", "Jaipur", "Mumbai", "New Delhi"]);
    expect(WORKBOOK_TOTALS.stockGroups).toEqual(["Chair", "Laptop", "Mobile", "Shirts", "Shoes", "Sofa"]);
    expect(EXPECTED_MAIN_MIS).toHaveLength(24);
  });
});

describe("analytics cube — axes", () => {
  const cube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);

  test("13 dense periods, Jan-25 through Jan-26", () => {
    expect(cube.periods).toHaveLength(13);
    expect(cube.periods.map((p) => p.label)).toEqual(WORKBOOK_MONTHS);
  });

  test("the two Januaries stay distinct", () => {
    expect(cube.meta.legacyMonthCollision).toBe(true);
    expect(cube.periodIndex.has("2025-01")).toBe(true);
    expect(cube.periodIndex.has("2026-01")).toBe(true);
    near(cube.periodTotal("2025-01"), 296500);
    near(cube.periodTotal("2026-01"), 255500);
  });

  test("groups the Stock Group axis, not the stock item", () => {
    expect(cube.groups.slice().sort()).toEqual(WORKBOOK_TOTALS.stockGroups);
  });

  test("cities and groups are ordered by revenue, strongest first", () => {
    expect(cube.cities).toEqual(["Ahmedabad", "Mumbai", "Jaipur", canon("New Delhi")]);
    expect(cube.groups[0]).toBe("Mobile"); // 12,10,500 — the largest group
  });

  test("every row is placed on the axis", () => {
    expect(cube.meta.rowsOffAxis).toBe(0);
    expect(cube.meta.unresolvedRows).toBe(0);
    expect(cube.meta.periodsFromFallback).toBe(0); // all rows carry _meta.voucherDate
  });
});

describe("analytics cube — reproduces 02_MAIN_MIS", () => {
  const cube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);

  test("grand total matches to the rupee", () => {
    near(cube.totals.total, WORKBOOK_TOTALS.grandTotal, 2);
  });

  test.each(EXPECTED_MAIN_MIS.map((c) => [`${c.subCategory} x ${c.city}`, c]))(
    "combo total: %s",
    (_label, expected) => {
      near(cube.comboTotal(canon(expected.city), expected.subCategory), expected.total, 2);
    }
  );

  test("every month cell of every combo matches", () => {
    for (const expected of EXPECTED_MAIN_MIS) {
      const series = cube.comboSeries(canon(expected.city), expected.subCategory);
      WORKBOOK_MONTHS.forEach((label, i) => {
        expect(Number(series[i].toString())).toBeCloseTo(expected.monthly[label], 2);
      });
    }
  });

  test("contribution % matches for every combo with revenue", () => {
    for (const expected of EXPECTED_MAIN_MIS) {
      if (!expected.total) continue;
      const share = cube.comboTotal(canon(expected.city), expected.subCategory).dividedBy(cube.totals.total);
      expect(Number(share.toString())).toBeCloseTo(expected.contributionPct, 6);
    }
  });

  test("per-combo HHI and diversification score match", () => {
    for (const expected of EXPECTED_MAIN_MIS) {
      if (!expected.total || expected.hhi === null) continue;
      const series = cube.comboSeries(canon(expected.city), expected.subCategory);
      near(stats.hhi(series), expected.hhi, 6);
      near(stats.diversificationScore(series), expected.diversificationScore, 4);
    }
  });

  test("the pivot is complete: 6 groups x 4 cities = 24 combos, 12 of them zero", () => {
    const combos = cube.allCombos();
    expect(combos).toHaveLength(24);
    expect(combos.filter((c) => c.isActive)).toHaveLength(12);
  });
});

describe("analytics cube — partition sums", () => {
  const cube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);
  const sumOf = (map) => [...map.values()].reduce((a, b) => a.plus(b), cube.totals.total.times(0));

  test("city totals sum to the grand total", () => {
    near(sumOf(cube.totals.byCity), WORKBOOK_TOTALS.grandTotal, 2);
  });

  test("group totals sum to the grand total", () => {
    near(sumOf(cube.totals.byGroup), WORKBOOK_TOTALS.grandTotal, 2);
  });

  test("period totals sum to the grand total", () => {
    near(sumOf(cube.totals.byPeriod), WORKBOOK_TOTALS.grandTotal, 2);
  });

  test("combo totals sum to the grand total", () => {
    const combos = cube.allCombos().reduce((a, c) => a.plus(c.revenue), cube.totals.total.times(0));
    near(combos, WORKBOOK_TOTALS.grandTotal, 2);
  });

  test("city totals match sheet 07 Table 2", () => {
    near(cube.cityTotal("Ahmedabad"), 1413000, 2);
    near(cube.cityTotal("Jaipur"), 564500, 2);
    near(cube.cityTotal("Mumbai"), 1103500, 2);
    near(cube.cityTotal(canon("New Delhi")), 306500, 2);
  });
});

describe("analytics cube — both matrix directions are built", () => {
  const cube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);

  test("cityGroup and groupCity agree cell for cell", () => {
    for (const city of cube.cities) {
      for (const group of cube.groups) {
        const a = cube.matrix.cityGroup.get(city)?.get(group);
        const b = cube.matrix.groupCity.get(group)?.get(city);
        if (a === undefined && b === undefined) continue;
        expect(Number((a || 0).toString())).toBeCloseTo(Number((b || 0).toString()), 2);
      }
    }
  });

  test("active-combo helpers reflect the workbook's sparse matrix", () => {
    // Ahmedabad sells 4 of 6 groups; Jaipur and New Delhi only 2 (sheet 08).
    expect(cube.activeGroupsInCity("Ahmedabad")).toHaveLength(4);
    expect(cube.activeGroupsInCity("Mumbai")).toHaveLength(4);
    expect(cube.activeGroupsInCity("Jaipur")).toHaveLength(2);
    expect(cube.activeGroupsInCity(canon("New Delhi"))).toHaveLength(2);
    // Every group sells in exactly 2 cities.
    for (const group of cube.groups) expect(cube.activeCitiesForGroup(group)).toHaveLength(2);
  });
});

describe("analytics cube — series are dense and axis-aligned", () => {
  const cube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);

  test("every series has one entry per period", () => {
    expect(cube.companySeries()).toHaveLength(13);
    for (const city of cube.cities) expect(cube.citySeries(city)).toHaveLength(13);
    for (const group of cube.groups) expect(cube.groupSeries(group)).toHaveLength(13);
    expect(cube.comboSeries("Ahmedabad", "Chair")).toHaveLength(13); // a zero combo
  });

  test("city series match sheet 07 Table 1", () => {
    const expected = {
      Ahmedabad: [112500, 111000, 112000, 110000, 112500, 111500, 110000, 108000, 107500, 104500, 104500, 107000, 102000],
      Jaipur: [55000, 36500, 30500, 34000, 35500, 32500, 34500, 34500, 31000, 32500, 83000, 69500, 55500],
      Mumbai: [76000, 78000, 79000, 78500, 82000, 86500, 84500, 87000, 90500, 88500, 90000, 90500, 92500],
      [canon("New Delhi")]: [53000, 49500, 50500, 50000, 24500, 20500, 17000, 14000, 5500, 5500, 5500, 5500, 5500]
    };
    for (const [city, values] of Object.entries(expected)) {
      const series = cube.citySeries(city).map((d) => Number(d.toString()));
      expect(series).toEqual(values);
    }
  });

  test("a zero combo is all zeroes, not an empty array", () => {
    const series = cube.comboSeries("Ahmedabad", "Chair");
    expect(series.every((d) => d.isZero())).toBe(true);
  });

  test("the derived city trends match the workbook's red flags", () => {
    expect(stats.declineStreak(cube.citySeries(canon("New Delhi"))).longest).toBe(6);
    expect(stats.declineStreak(cube.citySeries("Ahmedabad")).longest).toBe(5);
    near(stats.linearSlope(cube.citySeries(canon("New Delhi"))), -4741.7582);
  });
});

describe("analytics cube — sales returns", () => {
  const withReturn = [
    ...WORKBOOK_FACTS,
    {
      RowID: "credit-1",
      Category: "Mobile",
      SubCategory: "Mobile",
      City: "Ahmedabad",
      Month: "January",
      MonthNum: 1,
      SalesAmount: "10000",
      _meta: { voucherDate: "2025-01-20", isCredit: true }
    }
  ];

  test("a credit note is netted off, not added", () => {
    const cube = buildAnalyticsCube(withReturn, WINDOW);
    near(cube.totals.total, WORKBOOK_TOTALS.grandTotal - 10000, 2);
    near(cube.comboTotal("Ahmedabad", "Mobile"), 619000 - 10000, 2);
  });

  test("the credit is counted in meta so the netting is visible", () => {
    const cube = buildAnalyticsCube(withReturn, WINDOW);
    expect(cube.meta.creditRows).toBe(1);
    near(cube.meta.creditAmount, 10000, 2);
    expect(cube.meta.netReturns).toBe(true);
  });

  test("netReturns:false reproduces the current inflated behaviour", () => {
    const cube = buildAnalyticsCube(withReturn, { ...WINDOW, netReturns: false });
    near(cube.totals.total, WORKBOOK_TOTALS.grandTotal + 10000, 2);
  });
});

describe("analytics cube — degenerate input", () => {
  test("no rows yields an empty but well-formed cube", () => {
    for (const input of [[], null, undefined]) {
      const cube = buildAnalyticsCube(input);
      expect(cube.periods).toEqual([]);
      expect(cube.cities).toEqual([]);
      expect(cube.companySeries()).toEqual([]);
      expect(cube.allCombos()).toEqual([]);
      expect(cube.totals.total.isZero()).toBe(true);
    }
  });

  test("unknown entities fall back to labels rather than dropping the revenue", () => {
    const cube = buildAnalyticsCube([
      { City: "Mumbai", SalesAmount: "500", _meta: { voucherDate: "2025-01-05" } }
    ]);
    expect(cube.groups).toEqual(["Uncategorised"]);
    near(cube.totals.total, 500, 2);
  });

  test("legacy rows with no _meta still build a usable cube", () => {
    const cube = buildAnalyticsCube([
      { City: "Delhi", Category: "Footwear", Month: "April", MonthNum: 4, SalesAmount: "100" },
      { City: "Delhi", Category: "Footwear", Month: "May", MonthNum: 5, SalesAmount: "90" }
    ]);
    expect(cube.periods).toHaveLength(2);
    expect(cube.meta.periodsFromFallback).toBe(2);
    near(cube.totals.total, 190, 2);
  });
});
