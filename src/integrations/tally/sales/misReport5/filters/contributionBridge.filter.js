/**
 * Contribution Bridge Filters (Filters 11, 12) for Report #5.
 */

const { Decimal, toDecimal, toDecimalString } = require("../../../../../utils/financialDecimal");
const { THRESHOLDS } = require("../misReport5.types");

/**
 * Filter 11: Contribution Bridge by SubCategory
 * Answers: My revenue changed year over year -- exactly WHICH SubCategory caused it?
 * Evaluates Waterfall delta attribution and flags red-flag negative contributors (> 15% of decline).
 */
function evaluateFilter11_ContributionBridgeSubCategory(cube, options = {}) {
  const { subCategories, months, subCategoryMonthMatrix, subCategoryTotals } = cube;

  // Split months into Base Period (P1) and Comparison Period (P2)
  let p1Months = [];
  let p2Months = [];

  if (options.p1Months && Array.isArray(options.p1Months) && options.p2Months && Array.isArray(options.p2Months)) {
    p1Months = options.p1Months.filter((m) => months.includes(m));
    p2Months = options.p2Months.filter((m) => months.includes(m));
  }

  if (p1Months.length === 0 || p2Months.length === 0) {
    if (months.length >= 2) {
      const half = Math.floor(months.length / 2);
      p1Months = months.slice(0, half);
      p2Months = months.slice(half);
    } else if (months.length === 1) {
      p1Months = [months[0]];
      p2Months = [months[0]];
    }
  }

  let totalP1 = new Decimal(0);
  let totalP2 = new Decimal(0);

  const subCatDeltas = subCategories.map((subCat) => {
    let p1Amt = new Decimal(0);
    for (const m of p1Months) {
      const amt = (subCategoryMonthMatrix.get(subCat) && subCategoryMonthMatrix.get(subCat).get(m)) || new Decimal(0);
      p1Amt = p1Amt.plus(amt);
    }

    let p2Amt = new Decimal(0);
    for (const m of p2Months) {
      const amt = (subCategoryMonthMatrix.get(subCat) && subCategoryMonthMatrix.get(subCat).get(m)) || new Decimal(0);
      p2Amt = p2Amt.plus(amt);
    }

    const delta = p2Amt.minus(p1Amt);
    totalP1 = totalP1.plus(p1Amt);
    totalP2 = totalP2.plus(p2Amt);

    return {
      subCategory: subCat,
      period1Revenue: p1Amt,
      period2Revenue: p2Amt,
      delta
    };
  });

  const totalDelta = totalP2.minus(totalP1);
  const absTotalDelta = totalDelta.abs();
  let redFlagCount = 0;

  const bridge = subCatDeltas.map((item) => {
    const shareOfTotalChange = absTotalDelta.isZero()
      ? 0
      : item.delta.times(100).dividedBy(absTotalDelta).toDecimalPlaces(2).toNumber();

    // Red flag: negative delta contributing >= 15% of total change/decline
    const isRedFlag = item.delta.isNegative() && Math.abs(shareOfTotalChange) >= THRESHOLDS.MATERIAL_CONTRIBUTOR_THRESHOLD_PERCENT;
    if (isRedFlag) redFlagCount++;

    return {
      subCategory: item.subCategory,
      basePeriodRevenue: toDecimalString(item.period1Revenue),
      comparisonPeriodRevenue: toDecimalString(item.period2Revenue),
      delta: toDecimalString(item.delta),
      shareOfChangePercent: shareOfTotalChange,
      isRedFlag,
      attributionType: item.delta.isPositive() ? "GROWTH_DRIVER" : (item.delta.isZero() ? "NEUTRAL" : "DRAG")
    };
  });

  // Sort by delta ascending so biggest drags appear first
  bridge.sort((a, b) => Number(a.delta) - Number(b.delta));

  return {
    filterId: 11,
    filterName: "Contribution Bridge by SubCategory",
    ownerQuestion: "My revenue changed year over year -- exactly WHICH SubCategory caused it?",
    type: "Attribution",
    threshold: `>${THRESHOLDS.MATERIAL_CONTRIBUTOR_THRESHOLD_PERCENT}% of total negative change = material contributor`,
    summary: `${redFlagCount} of ${subCategories.length} SubCategories are RED FLAG negative contributors`,
    redFlagCount,
    periods: {
      basePeriodMonths: p1Months,
      comparisonPeriodMonths: p2Months,
      basePeriodTotal: toDecimalString(totalP1),
      comparisonPeriodTotal: toDecimalString(totalP2),
      totalDelta: toDecimalString(totalDelta)
    },
    bridge
  };
}

/**
 * Filter 12: Contribution Bridge by Month
 * Answers: My revenue changed year over year -- exactly WHICH Month caused it?
 * Handles month-level attribution with fallback documentation for single-time-axis reports.
 */
function evaluateFilter12_ContributionBridgeMonth(cube) {
  const { months, monthTotals, totalRevenue } = cube;
  const monthList = months.map((m) => {
    const amt = monthTotals.get(m) || new Decimal(0);
    return {
      month: m,
      revenue: toDecimalString(amt)
    };
  });

  return {
    filterId: 12,
    filterName: "Contribution Bridge by Month",
    ownerQuestion: "My revenue changed year over year -- exactly WHICH Month caused it?",
    type: "Attribution",
    threshold: "N/A -- Table 2 structurally degenerate (Month is both row dim and bridge endpoint)",
    summary: "See Sheet 07/09 for the genuine month-level trend instead",
    costOfInaction: "N/A",
    addressableOpportunity: "N/A",
    note: "In a single-period dataset, monthly delta across years requires multi-year historical vouchers. Showing month distribution series.",
    monthlyDistribution: monthList
  };
}

module.exports = {
  evaluateFilter11_ContributionBridgeSubCategory,
  evaluateFilter12_ContributionBridgeMonth
};
