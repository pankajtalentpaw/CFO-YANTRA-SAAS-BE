/**
 * Concentration and Risk Filters (Filters 3, 4, 9, 10) for Report #5.
 */

const { Decimal, toDecimal, toDecimalString } = require("../../../../../utils/financialDecimal");
const { THRESHOLDS } = require("../misReport5.types");

/**
 * Filter 3: SubCategory-wise Total by City
 * Answers: Which SubCategory gave me how much revenue, by City?
 * Evaluates single-product dependency per city (> 75%).
 */
function evaluateFilter3_SubCategoryTotalByCity(cube) {
  const { cities, subCategories, subCategoryCityMatrix, cityTotals } = cube;
  let singleProductDependencyCount = 0;

  const cityBreakdown = cities.map((city) => {
    const cityTotal = cityTotals.get(city) || new Decimal(0);
    let maxSubCat = null;
    let maxSubCatAmt = new Decimal(0);

    const subCatEntries = subCategories
      .map((subCat) => {
        const amt = (subCategoryCityMatrix.get(subCat) && subCategoryCityMatrix.get(subCat).get(city)) || new Decimal(0);
        if (amt.greaterThan(maxSubCatAmt)) {
          maxSubCatAmt = amt;
          maxSubCat = subCat;
        }
        const share = cityTotal.isZero()
          ? 0
          : amt.times(100).dividedBy(cityTotal).toDecimalPlaces(2).toNumber();

        return {
          subCategory: subCat,
          revenue: toDecimalString(amt),
          rawRevenue: amt.toNumber(),
          sharePercent: share
        };
      })
      .filter((entry) => entry.rawRevenue > 0)
      .sort((a, b) => b.rawRevenue - a.rawRevenue);

    const dominantShare = cityTotal.isZero()
      ? 0
      : maxSubCatAmt.times(100).dividedBy(cityTotal).toDecimalPlaces(2).toNumber();

    const isSingleProductDependent = dominantShare >= THRESHOLDS.SINGLE_PRODUCT_DEPENDENCY_THRESHOLD * 100;
    if (isSingleProductDependent) singleProductDependencyCount++;

    return {
      city,
      cityTotal: toDecimalString(cityTotal),
      activeProductsCount: subCatEntries.length,
      subCategories: subCatEntries,
      dominantSubCategory: maxSubCat,
      dominantSharePercent: dominantShare,
      isSingleProductDependent
    };
  });

  return {
    filterId: 3,
    filterName: "Product-wise Total by City",
    ownerQuestion: "Which Product gave me how much revenue, by City?",
    type: "Product",
    threshold: "75% single-product dependency threshold",
    summary: `${singleProductDependencyCount} of ${cities.length} Cities have >75% single-product dependency (${singleProductDependencyCount === 0 ? "all diversified" : "concentrated"})`,
    singleProductDependentCities: singleProductDependencyCount,
    data: cityBreakdown
  };
}

/**
 * Filter 4: SubCategory Contribution % Share
 * Answers: Out of every City's total, what % came from each SubCategory?
 * Identifies subcategories over-concentrated in a single city (> 75%).
 */
function evaluateFilter4_SubCategoryContributionShare(cube) {
  const { subCategories, cities, subCategoryCityMatrix, subCategoryTotals } = cube;
  let overConcentratedCount = 0;

  const results = subCategories.map((subCat) => {
    const total = subCategoryTotals.get(subCat) || new Decimal(0);
    let dominantCity = null;
    let dominantCityAmt = new Decimal(0);

    const cityShares = cities
      .map((city) => {
        const amt = (subCategoryCityMatrix.get(subCat) && subCategoryCityMatrix.get(subCat).get(city)) || new Decimal(0);
        if (amt.greaterThan(dominantCityAmt)) {
          dominantCityAmt = amt;
          dominantCity = city;
        }
        const share = total.isZero()
          ? 0
          : amt.times(100).dividedBy(total).toDecimalPlaces(2).toNumber();

        return {
          city,
          revenue: toDecimalString(amt),
          rawRevenue: amt.toNumber(),
          sharePercent: share
        };
      })
      .filter((entry) => entry.rawRevenue > 0)
      .sort((a, b) => b.rawRevenue - a.rawRevenue);

    const maxShare = total.isZero()
      ? 0
      : dominantCityAmt.times(100).dividedBy(total).toDecimalPlaces(2).toNumber();

    const isOverConcentrated = maxShare >= THRESHOLDS.DOMINANT_CITY_SHARE_THRESHOLD * 100;
    if (isOverConcentrated) overConcentratedCount++;

    return {
      subCategory: subCat,
      totalRevenue: toDecimalString(total),
      dominantCity,
      dominantCitySharePercent: maxShare,
      activeCitiesCount: cityShares.length,
      isOverConcentrated,
      cityShares
    };
  });

  return {
    filterId: 4,
    filterName: "Product Contribution % Share",
    ownerQuestion: "Out of every City's total, what % came from each Product?",
    type: "Product",
    threshold: "75% single-city concentration threshold",
    summary: `${overConcentratedCount} of ${subCategories.length} Products rely on a single city for >75% of their revenue`,
    overConcentratedSubCategories: overConcentratedCount,
    data: results
  };
}

/**
 * Filter 9: Concentration Risk (HHI) by SubCategory
 * Answers: Which SubCategory is dangerously dependent on just one Month?
 * Computes HHI = sum((monthly_revenue / total_revenue)^2)
 */
function evaluateFilter9_ConcentrationRiskHHI(cube) {
  const { subCategories, months, subCategoryMonthMatrix, subCategoryTotals } = cube;
  let highRiskCount = 0;
  let moderateRiskCount = 0;

  const results = subCategories.map((subCat) => {
    const total = subCategoryTotals.get(subCat) || new Decimal(0);
    if (total.isZero() || months.length === 0) {
      return {
        subCategory: subCat,
        totalRevenue: "0.00",
        hhi: 0,
        riskLevel: "DIVERSIFIED",
        dominantMonth: null,
        dominantMonthSharePercent: 0
      };
    }

    let hhiSum = new Decimal(0);
    let dominantMonth = null;
    let maxMonthAmt = new Decimal(0);

    for (const m of months) {
      const amt = (subCategoryMonthMatrix.get(subCat) && subCategoryMonthMatrix.get(subCat).get(m)) || new Decimal(0);
      if (amt.greaterThan(maxMonthAmt)) {
        maxMonthAmt = amt;
        dominantMonth = m;
      }
      const share = amt.dividedBy(total);
      hhiSum = hhiSum.plus(share.times(share));
    }

    const hhi = Number(hhiSum.toDecimalPlaces(4).toNumber());
    let riskLevel = "DIVERSIFIED";
    if (hhi >= THRESHOLDS.HHI_HIGH_RISK_THRESHOLD) {
      riskLevel = "HIGH_RISK";
      highRiskCount++;
    } else if (hhi >= THRESHOLDS.HHI_MODERATE_RISK_THRESHOLD) {
      riskLevel = "MODERATE_RISK";
      moderateRiskCount++;
    }

    const dominantShare = maxMonthAmt.times(100).dividedBy(total).toDecimalPlaces(2).toNumber();

    return {
      subCategory: subCat,
      totalRevenue: toDecimalString(total),
      hhi,
      riskLevel,
      dominantMonth,
      dominantMonthSharePercent: dominantShare,
      isHighRisk: riskLevel === "HIGH_RISK"
    };
  });

  return {
    filterId: 9,
    filterName: "Concentration Risk (HHI) by SubCategory",
    ownerQuestion: "Which SubCategory is dangerously dependent on just one Month?",
    type: "Risk",
    threshold: `HHI >= ${THRESHOLDS.HHI_HIGH_RISK_THRESHOLD} = High Risk`,
    summary: `SubCategories at High Risk (HHI >= ${THRESHOLDS.HHI_HIGH_RISK_THRESHOLD}): ${highRiskCount} (Moderate: ${moderateRiskCount})`,
    highRiskCount,
    moderateRiskCount,
    data: results
  };
}

/**
 * Filter 10: Top SubCategory x City Combos
 * Answers: What are my single best money-making combinations?
 * Pareto Thresholds: Top-1 > 15%, Top-3 > 40%, Top-5 > 60%
 */
function evaluateFilter10_TopCombos(cube) {
  const { subCategories, cities, subCategoryCityMatrix, totalRevenue } = cube;
  const combos = [];

  for (const subCat of subCategories) {
    for (const city of cities) {
      const amt = (subCategoryCityMatrix.get(subCat) && subCategoryCityMatrix.get(subCat).get(city)) || new Decimal(0);
      if (amt.isPositive()) {
        const sharePercent = totalRevenue.isZero()
          ? 0
          : amt.times(100).dividedBy(totalRevenue).toDecimalPlaces(2).toNumber();
        combos.push({
          combo: `${subCat} x ${city}`,
          subCategory: subCat,
          city,
          revenue: amt,
          revenueFormatted: toDecimalString(amt),
          sharePercent
        });
      }
    }
  }

  // Sort descending by revenue
  combos.sort((a, b) => b.revenue.minus(a.revenue).toNumber());

  let cumAmt = new Decimal(0);
  const rankedCombos = combos.map((c, idx) => {
    cumAmt = cumAmt.plus(c.revenue);
    const cumulativeSharePercent = totalRevenue.isZero()
      ? 0
      : cumAmt.times(100).dividedBy(totalRevenue).toDecimalPlaces(2).toNumber();
    return {
      rank: idx + 1,
      combo: c.combo,
      subCategory: c.subCategory,
      city: c.city,
      revenue: c.revenueFormatted,
      sharePercent: c.sharePercent,
      cumulativeSharePercent
    };
  });

  const top1Share = rankedCombos.length > 0 ? rankedCombos[0].sharePercent : 0;
  const top3Share = rankedCombos.length >= 3
    ? rankedCombos[2].cumulativeSharePercent
    : (rankedCombos.length > 0 ? rankedCombos[rankedCombos.length - 1].cumulativeSharePercent : 0);
  const top5Share = rankedCombos.length >= 5
    ? rankedCombos[4].cumulativeSharePercent
    : (rankedCombos.length > 0 ? rankedCombos[rankedCombos.length - 1].cumulativeSharePercent : 0);

  const top1Triggered = top1Share > THRESHOLDS.PARETO_TOP1_PERCENT;
  const top3Triggered = top3Share > THRESHOLDS.PARETO_TOP3_PERCENT;
  const top5Triggered = top5Share > THRESHOLDS.PARETO_TOP5_PERCENT;

  let triggeredCount = 0;
  if (top1Triggered) triggeredCount++;
  if (top3Triggered) triggeredCount++;
  if (top5Triggered) triggeredCount++;

  return {
    filterId: 10,
    filterName: "Top SubCategory x City Combos",
    ownerQuestion: "What are my single best money-making combinations?",
    type: "Opportunity",
    threshold: "Top-1 >15% / Top-3 >40% / Top-5 >60% of total",
    summary: `${triggeredCount} of 3 concentration thresholds triggered`,
    concentrationMetrics: {
      top1SharePercent: top1Share,
      top3SharePercent: top3Share,
      top5SharePercent: top5Share,
      flags: {
        top1Exceeds15Percent: top1Triggered,
        top3Exceeds40Percent: top3Triggered,
        top5Exceeds60Percent: top5Triggered
      }
    },
    topCombos: rankedCombos.slice(0, 10),
    allCombosCount: rankedCombos.length
  };
}

module.exports = {
  evaluateFilter3_SubCategoryTotalByCity,
  evaluateFilter4_SubCategoryContributionShare,
  evaluateFilter9_ConcentrationRiskHHI,
  evaluateFilter10_TopCombos
};
