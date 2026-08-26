/**
 * Automated Test Suite for Owner-POV 16-Filter Analytical Engine (Report #5).
 */

const { generateMisReport5, buildMisCube } = require("../src/integrations/tally/sales/misReport5/misReport5.engine");
const { calculateSlope, calculateDeclineStreak } = require("../src/integrations/tally/sales/misReport5/filters/trendAndMix.filter");

describe("Owner-POV 16-Filter MIS Report #5 Engine", () => {
  // Sample test fixture representing canonical FACT_SALES rows
  const sampleFactRows = [
    // Month 1: April
    { RowID: "1", Month: "April", MonthNum: 4, City: "Delhi", Category: "Footwear", SubCategory: "Shoes", SalesAmount: "100000" },
    { RowID: "2", Month: "April", MonthNum: 4, City: "Delhi", Category: "Apparel", SubCategory: "Shirts", SalesAmount: "50000" },
    { RowID: "3", Month: "April", MonthNum: 4, City: "Mumbai", Category: "Footwear", SubCategory: "Shoes", SalesAmount: "120000" },
    { RowID: "4", Month: "April", MonthNum: 4, City: "Mumbai", Category: "Apparel", SubCategory: "Shirts", SalesAmount: "80000" },

    // Month 2: May
    { RowID: "5", Month: "May", MonthNum: 5, City: "Delhi", Category: "Footwear", SubCategory: "Shoes", SalesAmount: "90000" },
    { RowID: "6", Month: "May", MonthNum: 5, City: "Delhi", Category: "Apparel", SubCategory: "Shirts", SalesAmount: "45000" },
    { RowID: "7", Month: "May", MonthNum: 5, City: "Mumbai", Category: "Footwear", SubCategory: "Shoes", SalesAmount: "130000" },
    { RowID: "8", Month: "May", MonthNum: 5, City: "Mumbai", Category: "Apparel", SubCategory: "Shirts", SalesAmount: "85000" },

    // Month 3: June
    { RowID: "9", Month: "June", MonthNum: 6, City: "Delhi", Category: "Footwear", SubCategory: "Shoes", SalesAmount: "80000" },
    { RowID: "10", Month: "June", MonthNum: 6, City: "Delhi", Category: "Apparel", SubCategory: "Shirts", SalesAmount: "40000" },
    { RowID: "11", Month: "June", MonthNum: 6, City: "Mumbai", Category: "Footwear", SubCategory: "Shoes", SalesAmount: "140000" },
    { RowID: "12", Month: "June", MonthNum: 6, City: "Mumbai", Category: "Apparel", SubCategory: "Shirts", SalesAmount: "90000" },

    // Month 4: July (Delhi declines further - 4th consecutive drop)
    { RowID: "13", Month: "July", MonthNum: 7, City: "Delhi", Category: "Footwear", SubCategory: "Shoes", SalesAmount: "70000" },
    { RowID: "14", Month: "July", MonthNum: 7, City: "Delhi", Category: "Apparel", SubCategory: "Shirts", SalesAmount: "30000" },
    { RowID: "15", Month: "July", MonthNum: 7, City: "Mumbai", Category: "Footwear", SubCategory: "Shoes", SalesAmount: "150000" },
    { RowID: "16", Month: "July", MonthNum: 7, City: "Mumbai", Category: "Apparel", SubCategory: "Shirts", SalesAmount: "95000" }
  ];

  test("Math Utilities: Slope & Streak calculation", () => {
    // Declining series
    const declining = [100, 90, 80, 70];
    expect(calculateDeclineStreak(declining)).toBe(3);
    expect(calculateSlope(declining)).toBeLessThan(0);

    // Growing series
    const growing = [50, 60, 70, 80];
    expect(calculateDeclineStreak(growing)).toBe(0);
    expect(calculateSlope(growing)).toBeGreaterThan(0);
  });

  test("Cube Building & Core Aggregations", () => {
    const cube = buildMisCube(sampleFactRows);
    expect(cube.cities).toEqual(["Mumbai", "Delhi"]);
    expect(cube.subCategories).toEqual(["Shoes", "Shirts"]);
    expect(cube.months).toEqual(["April", "May", "June", "July"]);
    // Total Revenue = (100+50+120+80) + (90+45+130+85) + (80+40+140+90) + (70+30+150+95) = 350 + 350 + 350 + 345 = 1395000
    expect(cube.totalRevenue.toString()).toBe("1395000");
  });

  test("Filters 1 & 2: City Trend, Streaks, and Equal Share Benchmark", () => {
    const report = generateMisReport5({ factSalesRows: sampleFactRows });
    const f1 = report.filters.filter1_cityRevenueTrend;
    const f2 = report.filters.filter2_cityTotalsReference;

    expect(f1.filterId).toBe(1);
    expect(f1.data.length).toBe(2);

    const delhiTrend = f1.data.find((c) => c.city === "Delhi");
    expect(delhiTrend.streakMonths).toBe(3); // 150k -> 135k -> 120k -> 100k (3 drops)
    expect(delhiTrend.hasSustainedDecline).toBe(true);
    expect(Number(delhiTrend.costOfInaction)).toBeGreaterThan(0);

    const mumbaiTrend = f1.data.find((c) => c.city === "Mumbai");
    expect(mumbaiTrend.streakMonths).toBe(0);
    expect(mumbaiTrend.hasSustainedDecline).toBe(false);

    expect(f2.citiesAboveBenchmark).toBe(1); // Mumbai total (890k) > benchmark (697.5k)
    expect(f2.equalShareBenchmark).toBe("697500.00");
  });

  test("Filters 3 & 4: SubCategory dependency & contribution share", () => {
    const report = generateMisReport5({ factSalesRows: sampleFactRows });
    const f3 = report.filters.filter3_subCategoryTotalByCity;
    const f4 = report.filters.filter4_subCategoryContributionShare;

    expect(f3.filterId).toBe(3);
    expect(f3.data.length).toBe(2);
    // Both cities have around 60-65% Shoes, so neither exceeds 75% dependency
    expect(f3.singleProductDependentCities).toBe(0);

    expect(f4.filterId).toBe(4);
    expect(f4.overConcentratedSubCategories).toBe(0);
  });

  test("Filters 5 & 6: Macro month mix & SubCategory monthly drivers", () => {
    const report = generateMisReport5({ factSalesRows: sampleFactRows });
    const f5 = report.filters.filter5_monthTrendCompanyWide;
    const f6 = report.filters.filter6_monthMixBySubCategory;

    expect(f5.filterId).toBe(5);
    expect(f5.data.length).toBe(4); // 4 months

    expect(f6.filterId).toBe(6);
    const shoesMix = f6.data.find((s) => s.subCategory === "Shoes");
    expect(shoesMix.driverMonth).toBe("April"); // Ties in monthly amounts pick first peak month
    expect(shoesMix.driverMonthRevenue).toBe("220000.00");
  });

  test("Filter 7: SubCategory Head-to-Head Comparison", () => {
    const report = generateMisReport5({
      factSalesRows: sampleFactRows,
      options: { subCatA: "Shoes", subCatB: "Shirts" }
    });
    const f7 = report.filters.filter7_subCategoryHeadToHead;

    expect(f7.filterId).toBe(7);
    expect(f7.itemA.name).toBe("Shoes");
    expect(f7.itemB.name).toBe("Shirts");
    // Shoes = 880k, Shirts = 515k -> Gap = (880 - 515) / 880 = 41.48% > 30%
    expect(f7.gapPercentage).toBeGreaterThan(30);
    expect(f7.status).toBe("WATCH -- gap exceeds 30%");
  });

  test("Filter 8: SubCategory Ranking by City", () => {
    const report = generateMisReport5({ factSalesRows: sampleFactRows });
    const f8 = report.filters.filter8_subCategoryRankingByCity;

    expect(f8.filterId).toBe(8);
    const shoesRank = f8.rankings.find((r) => r.subCategory === "Shoes");
    expect(shoesRank.avgRank).toBe(1); // #1 in both Delhi and Mumbai
    expect(shoesRank.status).toBe("STRONG");
  });

  test("Filter 9: Herfindahl-Hirschman Index (HHI) Concentration", () => {
    const report = generateMisReport5({ factSalesRows: sampleFactRows });
    const f9 = report.filters.filter9_concentrationRiskHhi;

    expect(f9.filterId).toBe(9);
    // Well distributed across 4 months, so HHI should be low (Diversified)
    f9.data.forEach((item) => {
      expect(item.hhi).toBeLessThan(0.5);
      expect(item.riskLevel).toBe("DIVERSIFIED");
    });
  });

  test("Filter 10: Top SubCategory x City Combos (Pareto)", () => {
    const report = generateMisReport5({ factSalesRows: sampleFactRows });
    const f10 = report.filters.filter10_topCombos;

    expect(f10.filterId).toBe(10);
    expect(f10.topCombos[0].combo).toBe("Shoes x Mumbai"); // 540k of 1395k = 38.7%
    expect(f10.concentrationMetrics.top1SharePercent).toBeGreaterThan(15);
    expect(f10.concentrationMetrics.flags.top1Exceeds15Percent).toBe(true);
  });

  test("Filters 11 & 12: Contribution Waterfall Bridge", () => {
    const report = generateMisReport5({ factSalesRows: sampleFactRows });
    const f11 = report.filters.filter11_contributionBridgeSubCategory;
    const f12 = report.filters.filter12_contributionBridgeMonth;

    expect(f11.filterId).toBe(11);
    expect(f11.bridge.length).toBe(2);

    expect(f12.filterId).toBe(12);
    expect(f12.type).toBe("Attribution");
  });

  test("Filters 13 & 14: Month Head-to-Head & Ranking by City", () => {
    const report = generateMisReport5({
      factSalesRows: sampleFactRows,
      options: { monthA: "April", monthB: "July" }
    });
    const f13 = report.filters.filter13_monthHeadToHead;
    const f14 = report.filters.filter14_monthRankingByCity;

    expect(f13.filterId).toBe(13);
    expect(f13.monthA.name).toBe("April");
    expect(f13.monthB.name).toBe("July");

    expect(f14.filterId).toBe(14);
    expect(f14.rankings.length).toBe(4);
  });

  test("Filters 15 & 16: Peak & Trough Volatility Finder", () => {
    const report = generateMisReport5({ factSalesRows: sampleFactRows });
    const f15 = report.filters.filter15_peakTroughSubCategory;
    const f16 = report.filters.filter16_peakTroughMonth;

    expect(f15.filterId).toBe(15);
    expect(f15.data.length).toBe(2);
    // Shoes: Peak July (220k), Trough May (220k) or April (220k)
    f15.data.forEach((item) => {
      expect(Number(item.swing)).toBeGreaterThanOrEqual(0);
      expect(["GREEN", "AMBER", "RED"]).toContain(item.status);
    });

    expect(f16.filterId).toBe(16);
    expect(f16.peakMonth).toBeDefined();
    expect(f16.troughMonth).toBeDefined();
  });

  test("Filter Query by ID returns selectedFilter", () => {
    const report = generateMisReport5({
      factSalesRows: sampleFactRows,
      options: { filterId: 7 }
    });
    expect(report.selectedFilter).toBeDefined();
    expect(report.selectedFilter.filterId).toBe(7);
  });
});
