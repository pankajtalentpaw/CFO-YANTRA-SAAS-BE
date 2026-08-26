/**
 * Trend and Mix Filters (Filters 1, 2, 5, 6) for Report #5.
 */

const { Decimal, toDecimal, toDecimalString } = require("../../../../../utils/financialDecimal");
const { THRESHOLDS } = require("../misReport5.types");

/**
 * Calculate linear regression slope for a series of numeric points.
 */
function calculateSlope(series) {
  const n = series.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = new Decimal(0);
  let sumXY = new Decimal(0);
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i + 1;
    const y = toDecimal(series[i]);
    sumX += x;
    sumY = sumY.plus(y);
    sumXY = sumXY.plus(y.times(x));
    sumXX += x * x;
  }

  const numerator = toDecimal(n).times(sumXY).minus(sumY.times(sumX));
  const denominator = new Decimal(n * sumXX - sumX * sumX);
  if (denominator.isZero()) return 0;
  return numerator.dividedBy(denominator).toNumber();
}

/**
 * Calculate consecutive decline streak from the latest period backward.
 */
function calculateDeclineStreak(series) {
  if (!series || series.length < 2) return 0;
  let streak = 0;
  for (let i = series.length - 1; i > 0; i--) {
    const current = toDecimal(series[i]);
    const previous = toDecimal(series[i - 1]);
    if (current.lessThan(previous)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Filter 1: City-wise Revenue Trend
 * Answers: Which City gave me how much revenue?
 */
function evaluateFilter1_CityRevenueTrend(cube) {
  const { cities, months, cityMonthMatrix, cityTotals, totalRevenue } = cube;
  const cityCount = cities.length;
  let sustainedDeclineCount = 0;
  let totalCostOfInaction = new Decimal(0);
  let totalAddressableOpportunity = new Decimal(0);

  const cityTrends = cities.map((city) => {
    const total = cityTotals.get(city) || new Decimal(0);
    const monthlySeries = months.map((m) => {
      const amt = (cityMonthMatrix.get(city) && cityMonthMatrix.get(city).get(m)) || new Decimal(0);
      return amt;
    });

    const numSeries = monthlySeries.map((d) => d.toNumber());
    const streak = calculateDeclineStreak(numSeries);
    const slope = calculateSlope(numSeries);
    const hasSustainedDecline = streak >= THRESHOLDS.STREAK_MONTHS_THRESHOLD || slope < 0;

    if (hasSustainedDecline) {
      sustainedDeclineCount++;
    }

    // Cost of Inaction: loss during decline streak relative to peak prior to streak
    let maxBeforeStreak = new Decimal(0);
    for (const amt of monthlySeries) {
      if (amt.greaterThan(maxBeforeStreak)) maxBeforeStreak = amt;
    }

    let coi = new Decimal(0);
    if (streak > 0) {
      const streakStartIndex = monthlySeries.length - streak;
      const baseline = streakStartIndex > 0 ? monthlySeries[streakStartIndex - 1] : maxBeforeStreak;
      for (let i = streakStartIndex; i < monthlySeries.length; i++) {
        const diff = baseline.minus(monthlySeries[i]);
        if (diff.isPositive()) {
          coi = coi.plus(diff);
        }
      }
    }

    // Addressable Opportunity: potential recovery to max monthly peak
    const latestAmt = monthlySeries.length > 0 ? monthlySeries[monthlySeries.length - 1] : new Decimal(0);
    const oppty = maxBeforeStreak.minus(latestAmt).times(streak > 0 ? streak : 3);
    const addressableOppty = oppty.isPositive() ? oppty : new Decimal(0);

    totalCostOfInaction = totalCostOfInaction.plus(coi);
    totalAddressableOpportunity = totalAddressableOpportunity.plus(addressableOppty);

    const sharePercent = totalRevenue.isZero()
      ? 0
      : total.times(100).dividedBy(totalRevenue).toDecimalPlaces(2).toNumber();

    return {
      city,
      totalRevenue: toDecimalString(total),
      sharePercent,
      streakMonths: streak,
      slope: Number(slope.toFixed(2)),
      hasSustainedDecline,
      costOfInaction: toDecimalString(coi),
      addressableOpportunity: toDecimalString(addressableOppty),
      monthlyTrend: months.map((m, idx) => ({
        month: m,
        revenue: toDecimalString(monthlySeries[idx])
      })),
      insight: hasSustainedDecline
        ? `${city}: ${streak}-month sustained decline, ${toDecimalString(coi)} recoverable`
        : `${city}: Stable/Growing revenue trend`
    };
  });

  return {
    filterId: 1,
    filterName: "City-wise Revenue Trend",
    ownerQuestion: "Which City gave me how much revenue?",
    type: "Trend",
    summary: `${sustainedDeclineCount} of ${cityCount} Cities show sustained decline`,
    totalCostOfInaction: toDecimalString(totalCostOfInaction),
    totalAddressableOpportunity: toDecimalString(totalAddressableOpportunity),
    data: cityTrends
  };
}

/**
 * Filter 2: City Totals (reference & concentration)
 * Answers: Full totals per City for reference
 */
function evaluateFilter2_CityTotals(cube) {
  const { cities, cityTotals, totalRevenue } = cube;
  const cityCount = cities.length;
  const equalShareBenchmark = cityCount > 0
    ? totalRevenue.dividedBy(cityCount).toDecimalPlaces(2)
    : new Decimal(0);

  let aboveBenchmarkCount = 0;

  const results = cities.map((city) => {
    const total = cityTotals.get(city) || new Decimal(0);
    const isAbove = total.greaterThan(equalShareBenchmark);
    if (isAbove) aboveBenchmarkCount++;

    const sharePercent = totalRevenue.isZero()
      ? 0
      : total.times(100).dividedBy(totalRevenue).toDecimalPlaces(2).toNumber();

    return {
      city,
      totalRevenue: toDecimalString(total),
      sharePercent,
      isAboveBenchmark: isAbove,
      varianceToBenchmark: toDecimalString(total.minus(equalShareBenchmark))
    };
  });

  return {
    filterId: 2,
    filterName: "City Totals (reference)",
    ownerQuestion: "Full totals per City for reference",
    type: "Trend",
    equalShareBenchmark: toDecimalString(equalShareBenchmark),
    summary: `${aboveBenchmarkCount} City(ies) above benchmark (concentration source)`,
    citiesAboveBenchmark: aboveBenchmarkCount,
    totalRevenue: toDecimalString(totalRevenue),
    data: results
  };
}

/**
 * Filter 5: Month Trend (Company-wide)
 * Answers: Is my Month mix shifting across City?
 */
function evaluateFilter5_MonthTrend(cube) {
  const { months, monthTotals, totalRevenue, cityMonthMatrix, cities } = cube;
  const monthlySeries = months.map((m) => (monthTotals.get(m) || new Decimal(0)).toNumber());
  const streak = calculateDeclineStreak(monthlySeries);
  const slope = calculateSlope(monthlySeries);
  const hasSustainedDecline = streak >= THRESHOLDS.STREAK_MONTHS_THRESHOLD || slope < 0;

  const monthBreakdown = months.map((m, idx) => {
    const amt = monthTotals.get(m) || new Decimal(0);
    const sharePercent = totalRevenue.isZero()
      ? 0
      : amt.times(100).dividedBy(totalRevenue).toDecimalPlaces(2).toNumber();

    const citySplit = {};
    for (const city of cities) {
      const cityAmt = (cityMonthMatrix.get(city) && cityMonthMatrix.get(city).get(m)) || new Decimal(0);
      citySplit[city] = toDecimalString(cityAmt);
    }

    return {
      month: m,
      revenue: toDecimalString(amt),
      sharePercent,
      citySplit
    };
  });

  return {
    filterId: 5,
    filterName: "Month Trend (Company-wide)",
    ownerQuestion: "Is my Month mix shifting across City?",
    type: "Month",
    streakMonths: streak,
    slope: Number(slope.toFixed(2)),
    hasSustainedDecline,
    summary: hasSustainedDecline
      ? `Company-wide ${streak}-month decline streak detected (Slope: ${slope.toFixed(2)})`
      : "Company-wide monthly revenue mix is healthy and growing",
    data: monthBreakdown
  };
}

/**
 * Filter 6: Month Mix by SubCategory
 * Answers: For each SubCategory, which Month actually drives the revenue?
 */
function evaluateFilter6_MonthMixBySubCategory(cube) {
  const { subCategories, months, subCategoryMonthMatrix, subCategoryTotals } = cube;
  const subCategoryCount = subCategories.length;
  let sustainedDeclineCount = 0;

  const results = subCategories.map((subCat) => {
    const total = subCategoryTotals.get(subCat) || new Decimal(0);
    const monthlySeries = months.map((m) => {
      return (subCategoryMonthMatrix.get(subCat) && subCategoryMonthMatrix.get(subCat).get(m)) || new Decimal(0);
    });

    const numSeries = monthlySeries.map((d) => d.toNumber());
    const streak = calculateDeclineStreak(numSeries);
    const slope = calculateSlope(numSeries);
    const hasSustainedDecline = streak >= THRESHOLDS.STREAK_MONTHS_THRESHOLD || slope < 0;

    if (hasSustainedDecline) {
      sustainedDeclineCount++;
    }

    // Find driver month (highest revenue month)
    let driverMonth = null;
    let maxAmt = new Decimal(0);
    months.forEach((m, idx) => {
      if (monthlySeries[idx].greaterThan(maxAmt)) {
        maxAmt = monthlySeries[idx];
        driverMonth = m;
      }
    });

    return {
      subCategory: subCat,
      totalRevenue: toDecimalString(total),
      driverMonth,
      driverMonthRevenue: toDecimalString(maxAmt),
      streakMonths: streak,
      slope: Number(slope.toFixed(2)),
      hasSustainedDecline,
      monthlyBreakdown: months.map((m, idx) => ({
        month: m,
        revenue: toDecimalString(monthlySeries[idx]),
        shareOfSubCategory: total.isZero()
          ? 0
          : monthlySeries[idx].times(100).dividedBy(total).toDecimalPlaces(2).toNumber()
      }))
    };
  });

  return {
    filterId: 6,
    filterName: "Month Mix by SubCategory",
    ownerQuestion: "For each SubCategory, which Month actually drives the revenue?",
    type: "Month",
    summary: `${sustainedDeclineCount} of ${subCategoryCount} SubCategories show sustained monthly decline`,
    subCategoriesInDecline: sustainedDeclineCount,
    data: results
  };
}

module.exports = {
  calculateSlope,
  calculateDeclineStreak,
  evaluateFilter1_CityRevenueTrend,
  evaluateFilter2_CityTotals,
  evaluateFilter5_MonthTrend,
  evaluateFilter6_MonthMixBySubCategory
};
