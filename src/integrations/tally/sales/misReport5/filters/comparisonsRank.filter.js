/**
 * Comparisons and Ranking Filters (Filters 7, 8, 13, 14) for Report #5.
 */

const { Decimal, toDecimal, toDecimalString } = require("../../../../../utils/financialDecimal");
const { THRESHOLDS } = require("../misReport5.types");

/**
 * Filter 7: SubCategory vs SubCategory Head-to-Head
 * Answers: Pick any 2 SubCategories, compare revenue side by side.
 * Evaluates scale gap (> 30% gap = scale mismatch).
 */
function evaluateFilter7_SubCategoryHeadToHead(cube, options = {}) {
  const { subCategories, cities, subCategoryCityMatrix, subCategoryTotals } = cube;
  if (subCategories.length === 0) {
    return {
      filterId: 7,
      filterName: "SubCategory vs SubCategory Head-to-Head",
      ownerQuestion: "Pick any 2 SubCategories, compare revenue side by side.",
      type: "Comparison",
      summary: "No subcategories available to compare",
      itemA: null,
      itemB: null,
      gapPercentage: 0,
      status: "N/A"
    };
  }

  // Pick target subcategories from options or default to top 2 by total revenue
  let targetA = options.subCatA;
  let targetB = options.subCatB;

  if (!targetA || !subCategories.includes(targetA)) {
    targetA = subCategories[0];
  }
  if (!targetB || !subCategories.includes(targetB) || targetB === targetA) {
    targetB = subCategories.length > 1 ? subCategories[1] : targetA;
  }

  const totalA = subCategoryTotals.get(targetA) || new Decimal(0);
  const totalB = subCategoryTotals.get(targetB) || new Decimal(0);

  const maxVal = totalA.greaterThan(totalB) ? totalA : totalB;
  const minVal = totalA.greaterThan(totalB) ? totalB : totalA;
  const gapAmt = maxVal.minus(minVal);

  const gapPercentage = maxVal.isZero()
    ? 0
    : gapAmt.times(100).dividedBy(maxVal).toDecimalPlaces(2).toNumber();

  const exceedsGapThreshold = gapPercentage > THRESHOLDS.SCALE_GAP_THRESHOLD_PERCENT;
  const status = exceedsGapThreshold ? "WATCH -- gap exceeds 30%" : "Comparable scale";

  const cityComparisons = cities.map((city) => {
    const amtA = (subCategoryCityMatrix.get(targetA) && subCategoryCityMatrix.get(targetA).get(city)) || new Decimal(0);
    const amtB = (subCategoryCityMatrix.get(targetB) && subCategoryCityMatrix.get(targetB).get(city)) || new Decimal(0);
    const diff = amtA.minus(amtB);

    return {
      city,
      revenueA: toDecimalString(amtA),
      revenueB: toDecimalString(amtB),
      variance: toDecimalString(diff),
      winner: amtA.greaterThan(amtB) ? targetA : (amtB.greaterThan(amtA) ? targetB : "TIE")
    };
  });

  return {
    filterId: 7,
    filterName: "SubCategory vs SubCategory Head-to-Head",
    ownerQuestion: "Pick any 2 SubCategories, compare revenue side by side.",
    type: "Comparison",
    threshold: `Gap > ${THRESHOLDS.SCALE_GAP_THRESHOLD_PERCENT}% of the larger product = not comparable in scale`,
    summary: status,
    itemA: {
      name: targetA,
      totalRevenue: toDecimalString(totalA)
    },
    itemB: {
      name: targetB,
      totalRevenue: toDecimalString(totalB)
    },
    gapPercentage,
    gapAmount: toDecimalString(gapAmt),
    status,
    cityBreakdown: cityComparisons
  };
}

/**
 * Filter 8: SubCategory Ranking by City
 * Answers: Which SubCategory was #1 in each City?
 * Evaluates Avg rank: <= 2.0 = STRONG, >= 5.0 = WEAK, else MIXED.
 */
function evaluateFilter8_SubCategoryRankingByCity(cube) {
  const { subCategories, cities, subCategoryCityMatrix, subCategoryTotals } = cube;
  const cityCount = cities.length;

  // Build ranking per city
  const cityRankMap = new Map(); // city -> Map(subCat -> rank)
  for (const city of cities) {
    const list = subCategories.map((subCat) => {
      const amt = (subCategoryCityMatrix.get(subCat) && subCategoryCityMatrix.get(subCat).get(city)) || new Decimal(0);
      return { subCat, amt };
    });
    list.sort((a, b) => b.amt.minus(a.amt).toNumber());
    const rankMap = new Map();
    list.forEach((item, idx) => {
      rankMap.set(item.subCat, idx + 1);
    });
    cityRankMap.set(city, rankMap);
  }

  let strongCount = 0;
  let weakCount = 0;
  let mixedCount = 0;

  const rankings = subCategories.map((subCat) => {
    let rankSum = 0;
    const ranksPerCity = {};

    for (const city of cities) {
      const r = cityRankMap.get(city).get(subCat) || 0;
      ranksPerCity[city] = r;
      rankSum += r;
    }

    const avgRank = cityCount > 0 ? Number((rankSum / cityCount).toFixed(2)) : 0;
    let rankEvaluation = "MIXED";

    if (avgRank <= THRESHOLDS.RANK_STRONG_THRESHOLD) {
      rankEvaluation = "STRONG";
      strongCount++;
    } else if (avgRank >= THRESHOLDS.RANK_WEAK_THRESHOLD) {
      rankEvaluation = "WEAK";
      weakCount++;
    } else {
      mixedCount++;
    }

    const total = subCategoryTotals.get(subCat) || new Decimal(0);

    return {
      subCategory: subCat,
      totalRevenue: toDecimalString(total),
      avgRank,
      status: rankEvaluation,
      cityRanks: ranksPerCity
    };
  });

  // Sort by avgRank ascending (best rank first)
  rankings.sort((a, b) => a.avgRank - b.avgRank);

  return {
    filterId: 8,
    filterName: "SubCategory Ranking by City",
    ownerQuestion: "Which SubCategory was #1 in each City?",
    type: "Comparison",
    threshold: `Avg rank <=${THRESHOLDS.RANK_STRONG_THRESHOLD} = STRONG; >=${THRESHOLDS.RANK_WEAK_THRESHOLD} = WEAK`,
    summary: `${strongCount} Strong, ${weakCount} Weak, ${mixedCount} Mixed`,
    counts: { strong: strongCount, weak: weakCount, mixed: mixedCount },
    rankings
  };
}

/**
 * Filter 13: Month vs Month Head-to-Head
 * Answers: Pick any 2 Months, compare revenue by City side by side.
 * Evaluates scale gap (> 30% gap = scale mismatch).
 */
function evaluateFilter13_MonthHeadToHead(cube, options = {}) {
  const { months, cities, cityMonthMatrix, monthTotals } = cube;
  if (months.length === 0) {
    return {
      filterId: 13,
      filterName: "Month vs Month Head-to-Head",
      ownerQuestion: "Pick any 2 Months, compare revenue by City side by side.",
      type: "Comparison",
      summary: "No months available to compare",
      monthA: null,
      monthB: null,
      gapPercentage: 0,
      status: "N/A"
    };
  }

  let targetA = options.monthA;
  let targetB = options.monthB;

  if (!targetA || !months.includes(targetA)) {
    targetA = months[0];
  }
  if (!targetB || !months.includes(targetB) || targetB === targetA) {
    targetB = months.length > 1 ? months[1] : targetA;
  }

  const totalA = monthTotals.get(targetA) || new Decimal(0);
  const totalB = monthTotals.get(targetB) || new Decimal(0);

  const maxVal = totalA.greaterThan(totalB) ? totalA : totalB;
  const minVal = totalA.greaterThan(totalB) ? totalB : totalA;
  const gapAmt = maxVal.minus(minVal);

  const gapPercentage = maxVal.isZero()
    ? 0
    : gapAmt.times(100).dividedBy(maxVal).toDecimalPlaces(2).toNumber();

  const exceedsGapThreshold = gapPercentage > THRESHOLDS.SCALE_GAP_THRESHOLD_PERCENT;
  const status = exceedsGapThreshold ? "WATCH -- gap exceeds 30%" : "Comparable scale";

  const cityComparisons = cities.map((city) => {
    const amtA = (cityMonthMatrix.get(city) && cityMonthMatrix.get(city).get(targetA)) || new Decimal(0);
    const amtB = (cityMonthMatrix.get(city) && cityMonthMatrix.get(city).get(targetB)) || new Decimal(0);
    const diff = amtA.minus(amtB);

    return {
      city,
      revenueA: toDecimalString(amtA),
      revenueB: toDecimalString(amtB),
      variance: toDecimalString(diff),
      winner: amtA.greaterThan(amtB) ? targetA : (amtB.greaterThan(amtA) ? targetB : "TIE")
    };
  });

  return {
    filterId: 13,
    filterName: "Month vs Month Head-to-Head",
    ownerQuestion: "Pick any 2 Months, compare revenue by City side by side.",
    type: "Comparison",
    threshold: `Gap > ${THRESHOLDS.SCALE_GAP_THRESHOLD_PERCENT}% of the larger month = not comparable in scale`,
    summary: status,
    monthA: {
      name: targetA,
      totalRevenue: toDecimalString(totalA)
    },
    monthB: {
      name: targetB,
      totalRevenue: toDecimalString(totalB)
    },
    gapPercentage,
    gapAmount: toDecimalString(gapAmt),
    status,
    cityBreakdown: cityComparisons
  };
}

/**
 * Filter 14: Month Ranking by City
 * Answers: Which Month was #1 in each City?
 * Evaluates monthly seasonality consistency across markets.
 */
function evaluateFilter14_MonthRankingByCity(cube) {
  const { months, cities, cityMonthMatrix, monthTotals } = cube;
  const cityCount = cities.length;

  const cityRankMap = new Map();
  for (const city of cities) {
    const list = months.map((m) => {
      const amt = (cityMonthMatrix.get(city) && cityMonthMatrix.get(city).get(m)) || new Decimal(0);
      return { month: m, amt };
    });
    list.sort((a, b) => b.amt.minus(a.amt).toNumber());
    const rankMap = new Map();
    list.forEach((item, idx) => {
      rankMap.set(item.month, idx + 1);
    });
    cityRankMap.set(city, rankMap);
  }

  let strongCount = 0;
  let weakCount = 0;
  let mixedCount = 0;

  const rankings = months.map((m) => {
    let rankSum = 0;
    const ranksPerCity = {};

    for (const city of cities) {
      const r = cityRankMap.get(city).get(m) || 0;
      ranksPerCity[city] = r;
      rankSum += r;
    }

    const avgRank = cityCount > 0 ? Number((rankSum / cityCount).toFixed(2)) : 0;
    let rankEvaluation = "MIXED";

    if (avgRank <= THRESHOLDS.MONTH_RANK_STRONG_THRESHOLD) {
      rankEvaluation = "STRONG";
      strongCount++;
    } else if (avgRank >= THRESHOLDS.MONTH_RANK_WEAK_THRESHOLD) {
      rankEvaluation = "WEAK";
      weakCount++;
    } else {
      mixedCount++;
    }

    const total = monthTotals.get(m) || new Decimal(0);

    return {
      month: m,
      totalRevenue: toDecimalString(total),
      avgRank,
      status: rankEvaluation,
      cityRanks: ranksPerCity
    };
  });

  rankings.sort((a, b) => a.avgRank - b.avgRank);

  const bestMonth = rankings.length > 0 ? rankings[0].month : null;
  const worstMonth = rankings.length > 0 ? rankings[rankings.length - 1].month : null;

  return {
    filterId: 14,
    filterName: "Month Ranking by City",
    ownerQuestion: "Which Month was #1 in each City?",
    type: "Comparison",
    threshold: `Avg rank <=${THRESHOLDS.MONTH_RANK_STRONG_THRESHOLD} = STRONG; >=${THRESHOLDS.MONTH_RANK_WEAK_THRESHOLD} = WEAK (out of ${months.length} months, ${cityCount} cities)`,
    summary: `${strongCount} Strong, ${weakCount} Weak, ${mixedCount} Mixed -- ${worstMonth || "N/A"} lowest avg rank, ${bestMonth || "N/A"} highest`,
    bestMonth,
    worstMonth,
    counts: { strong: strongCount, weak: weakCount, mixed: mixedCount },
    rankings
  };
}

module.exports = {
  evaluateFilter7_SubCategoryHeadToHead,
  evaluateFilter8_SubCategoryRankingByCity,
  evaluateFilter13_MonthHeadToHead,
  evaluateFilter14_MonthRankingByCity
};
