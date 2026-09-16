/**
 * The workbook is the oracle. Every expectation below is a value the workbook
 * itself computed, quoted from sheet 07_CITY_TREND_GROWTH and 02_MAIN_MIS, so
 * a regression here means we have drifted from the spec rather than from a
 * previous guess of our own.
 */

const stats = require("../../src/analytics/compute/shared/stats");

/** 13-month city series, 01_RAW_DATA aggregated to city x month (sheet 07 Table 1). */
const CITY = {
  Ahmedabad: [112500, 111000, 112000, 110000, 112500, 111500, 110000, 108000, 107500, 104500, 104500, 107000, 102000],
  Jaipur:    [55000, 36500, 30500, 34000, 35500, 32500, 34500, 34500, 31000, 32500, 83000, 69500, 55500],
  Mumbai:    [76000, 78000, 79000, 78500, 82000, 86500, 84500, 87000, 90500, 88500, 90000, 90500, 92500],
  "New Delhi": [53000, 49500, 50500, 50000, 24500, 20500, 17000, 14000, 5500, 5500, 5500, 5500, 5500]
};

/** Mobile x Ahmedabad, the workbook's #1 combo (02_MAIN_MIS row 13). */
const MOBILE_AHMEDABAD = [38500, 38000, 40500, 42000, 46000, 47500, 50000, 48000, 51500, 51000, 53500, 57000, 55500];

const CITY_TOTALS = [1413000, 564500, 1103500, 306500]; // Ahm, Jai, Mum, ND
const GRAND_TOTAL = 3387500;

/** Assert a Decimal (or null) against a number, to the workbook's own precision. */
const near = (actual, expected, precision = 4) => {
  expect(actual).not.toBeNull();
  expect(Number(actual.toString())).toBeCloseTo(expected, precision);
};

describe("stats — central tendency and spread", () => {
  test("mean matches the workbook (analysis L01.A06)", () => {
    near(stats.mean(CITY.Ahmedabad), 108692.3077);
    near(stats.mean(CITY.Jaipur), 43423.0769);
    near(stats.mean(CITY.Mumbai), 84884.6154);
    near(stats.mean(CITY["New Delhi"]), 23576.9231);
  });

  test("stdDev is the SAMPLE form Excel STDEV.S uses, not population", () => {
    // Population would give 3296.4927 for Ahmedabad; the workbook says 3431.0984.
    near(stats.stdDev(CITY.Ahmedabad), 3431.0984);
    near(stats.stdDev(CITY.Jaipur), 16943.3445);
    near(stats.stdDev(CITY.Mumbai), 5609.3443);
    near(stats.stdDev(CITY["New Delhi"]), 19874.4456);
  });

  test("coefficient of variation matches the workbook's stability flags", () => {
    near(stats.coefficientOfVariation(CITY.Ahmedabad), 0.0316);
    near(stats.coefficientOfVariation(CITY.Jaipur), 0.3902);
    near(stats.coefficientOfVariation(CITY.Mumbai), 0.0661);
    near(stats.coefficientOfVariation(CITY["New Delhi"]), 0.843);
  });

  test("median of the four city totals", () => {
    near(stats.median(CITY_TOTALS), 834000);
    near(stats.mean(CITY_TOTALS), 846875); // the equal-share benchmark
  });

  test("spread of a single observation is undefined, not zero", () => {
    expect(stats.stdDev([100])).toBeNull();
    expect(stats.coefficientOfVariation([100])).toBeNull();
  });

  test("a zero mean has no coefficient of variation", () => {
    expect(stats.coefficientOfVariation([0, 0, 0])).toBeNull();
  });
});

describe("stats — trend", () => {
  test("slope matches Excel SLOPE (analysis L01.A08)", () => {
    near(stats.linearSlope(CITY.Ahmedabad), -785.7143);
    near(stats.linearSlope(CITY.Jaipur), 2013.7363);
    near(stats.linearSlope(CITY.Mumbai), 1390.1099);
    near(stats.linearSlope(CITY["New Delhi"]), -4741.7582);
  });

  test("slope needs at least two points", () => {
    expect(stats.linearSlope([100])).toBeNull();
    expect(stats.linearSlope([])).toBeNull();
  });

  test("running decline streak reproduces the workbook's table exactly", () => {
    // Sheet 07 rows 16-19, columns Feb-25 .. Jan-26 (index 1 onward).
    expect(stats.declineStreak(CITY.Ahmedabad).byIndex.slice(1)).toEqual([1, 0, 1, 0, 1, 2, 3, 4, 5, 0, 0, 1]);
    expect(stats.declineStreak(CITY.Jaipur).byIndex.slice(1)).toEqual([1, 2, 0, 0, 1, 0, 0, 1, 0, 0, 1, 2]);
    expect(stats.declineStreak(CITY.Mumbai).byIndex.slice(1)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0]);
    expect(stats.declineStreak(CITY["New Delhi"]).byIndex.slice(1)).toEqual([1, 0, 1, 2, 3, 4, 5, 6, 0, 0, 0, 0]);
  });

  test("longest streak matches the workbook's red flags", () => {
    expect(stats.declineStreak(CITY.Ahmedabad).longest).toBe(5);
    expect(stats.declineStreak(CITY.Jaipur).longest).toBe(2);
    expect(stats.declineStreak(CITY.Mumbai).longest).toBe(1);
    expect(stats.declineStreak(CITY["New Delhi"]).longest).toBe(6);
  });

  test("a flat month breaks a streak rather than continuing it", () => {
    // Ahmedabad's Oct->Nov is flat at 104,500 and the workbook resets to 0 there.
    expect(stats.declineStreak([100, 90, 90, 80]).byIndex).toEqual([0, 1, 0, 1]);
  });

  test("growth streak is the mirror image", () => {
    expect(stats.growthStreak([10, 20, 30, 30, 40]).byIndex).toEqual([0, 1, 2, 0, 1]);
    expect(stats.growthStreak(CITY.Mumbai).longest).toBeGreaterThan(0);
  });

  test("latest month-on-month growth (analysis L01.A02)", () => {
    near(stats.latestGrowth(CITY.Ahmedabad), -0.0467);
    near(stats.latestGrowth(CITY.Jaipur), -0.2014);
    near(stats.latestGrowth(CITY.Mumbai), 0.0221);
    near(stats.latestGrowth(CITY["New Delhi"]), 0); // flat at 5,500
  });

  test("3-month rolling momentum (analysis L01.A03)", () => {
    const ahm = stats.rollingMomentum(CITY.Ahmedabad, 3);
    near(ahm.recentAvg, 104500);
    near(ahm.priorAvg, 106666.6667);
    near(ahm.changeRate, -0.0203);

    const jai = stats.rollingMomentum(CITY.Jaipur, 3);
    near(jai.recentAvg, 69333.3333);
    near(jai.priorAvg, 32666.6667);
    near(jai.changeRate, 1.1224);

    near(stats.rollingMomentum(CITY["New Delhi"], 3).changeRate, -0.34);
  });

  test("rolling momentum refuses a partial prior window", () => {
    expect(stats.rollingMomentum([1, 2, 3, 4, 5], 3)).toBeNull(); // needs 6
    expect(stats.rollingMomentum([1, 2, 3, 4, 5, 6], 3)).not.toBeNull();
  });

  test("growth from a zero base is undefined, not infinite", () => {
    expect(stats.latestGrowth([0, 5000])).toBeNull();
  });
});

describe("stats — extremes", () => {
  test("peak-to-current gap (analysis L01.A04)", () => {
    const ahm = stats.peakToCurrent(CITY.Ahmedabad);
    near(ahm.peak, 112500);
    expect(ahm.peakIndex).toBe(0); // Jan-25
    near(ahm.gap, -10500);
    near(ahm.gapRate, -0.0933);

    const jai = stats.peakToCurrent(CITY.Jaipur);
    near(jai.peak, 83000);
    expect(jai.peakIndex).toBe(10); // Nov-25
    near(jai.gapRate, -0.3313);

    const nd = stats.peakToCurrent(CITY["New Delhi"]);
    near(nd.gap, -47500);
    near(nd.gapRate, -0.8962);
  });

  test("a city at its peak has no gap", () => {
    const mum = stats.peakToCurrent(CITY.Mumbai);
    near(mum.gap, 0);
    near(mum.gapRate, 0);
  });

  test("peak/trough ratio and swing", () => {
    const nd = stats.peakTrough(CITY["New Delhi"]);
    near(nd.peak, 53000);
    near(nd.trough, 5500);
    near(nd.swing, 47500);
    near(nd.ratio, 9.6364);
  });

  test("a zero trough has no ratio rather than a sentinel", () => {
    const pt = stats.peakTrough([1000, 0, 500]);
    expect(pt.ratio).toBeNull();
    near(pt.swing, 1000);
  });

  test("ties resolve to the earliest period", () => {
    const pt = stats.peakTrough([100, 100, 100]);
    expect(pt.peakIndex).toBe(0);
    expect(pt.troughIndex).toBe(0);
  });
});

describe("stats — concentration", () => {
  test("HHI and diversification score match 02_MAIN_MIS", () => {
    near(stats.hhi(MOBILE_AHMEDABAD), 0.0781695, 6);
    near(stats.diversificationScore(MOBILE_AHMEDABAD), 12.7927149, 5);
  });

  test("HHI bounds: even distribution is 1/n, single entity is 1", () => {
    near(stats.hhi([25, 25, 25, 25]), 0.25);
    near(stats.hhi([100, 0, 0, 0]), 1);
  });

  test("top-2 city dependency matches the workbook (analysis L01.A07)", () => {
    // Ahmedabad + Mumbai = 2,516,500 of 3,387,500.
    near(stats.topNShare(CITY_TOTALS, 2), 0.7429);
    near(stats.topNShare(CITY_TOTALS, 2).times(GRAND_TOTAL), 2516500, 0);
  });

  test("a zero total has no distribution to measure", () => {
    expect(stats.hhi([0, 0, 0])).toBeNull();
    expect(stats.topNShare([0, 0], 1)).toBeNull();
    expect(stats.hhi([])).toBeNull();
  });
});

describe("stats — ranking", () => {
  test("ranks cities by revenue descending", () => {
    // Ahm 1413000, Jai 564500, Mum 1103500, ND 306500
    expect(stats.rankDescending(CITY_TOTALS)).toEqual([1, 3, 2, 4]);
  });

  test("ties share the best rank and the next rank skips, as Excel RANK does", () => {
    expect(stats.rankDescending([100, 100, 50])).toEqual([1, 1, 3]);
    expect(stats.rankDescending([50, 100, 100, 25])).toEqual([3, 1, 1, 4]);
  });

  test("quartile classification puts the strongest entity in Q1", () => {
    const q = stats.quartileByRank(CITY_TOTALS);
    expect(q[0]).toBe(1); // Ahmedabad, rank 1
    expect(q[3]).toBe(4); // New Delhi, rank 4
  });
});

describe("stats — distribution shape", () => {
  test("growth vs decline balance across the four cities (analysis L01.A10)", () => {
    const balance = stats.growthDeclineBalance(Object.values(CITY));
    expect(balance).toEqual({ growing: 2, declining: 2, flat: 0, total: 4 });
  });

  test("halves split odd-length series with the extra month in the first half", () => {
    const h = stats.halves([1, 2, 3, 4, 5]);
    expect(h.first).toHaveLength(3);
    expect(h.second).toHaveLength(2);
  });

  test("degenerate input never throws", () => {
    expect(stats.mean([])).toBeNull();
    expect(stats.peakTrough([])).toBeNull();
    expect(stats.halves([1])).toBeNull();
    expect(stats.growthDeclineBalance([])).toEqual({ growing: 0, declining: 0, flat: 0, total: 0 });
  });
});
