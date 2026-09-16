/**
 * Binds each catalog entry to the function that computes it.
 *
 * HAND-WRITTEN — unlike analysisCatalog.js, which is generated. Keeping the two
 * apart is deliberate: re-running scripts/extractAnalysisCatalog.js regenerates
 * the workbook's static text without touching a single binding here.
 *
 * A binding is `{ family, builder, params }`. Because builders are written
 * against an axis descriptor rather than a specific dimension, the same builder
 * serves several analyses — trend.latestGrowth is L01.A02 on cities and L06.A05
 * on products, with no duplicated maths. That is what keeps 160 analyses to
 * roughly 25 builders.
 */

const trend = require("../compute/trend");
const concentration = require("../compute/concentration");
const coverage_ = require("../compute/coverage");
const comparison = require("../compute/comparison");
const contribution = require("../compute/contribution");
const volatility = require("../compute/volatility");
const { AXES } = require("./axes");

const bind = (module_, name, params = {}) => ({
  family: module_.family,
  builder: module_[name],
  builderName: name,
  params
});

const city = { axis: AXES.city };
const group = { axis: AXES.group };

// Coverage builders work the city x product matrix from one end or the other.
const byCity = { primary: "city" };
const byProduct = { primary: "group" };

// Comparison builders switch between product pairs and month pairs on `mode`.
const pairOfProducts = { mode: "product" };
const pairOfMonths = { mode: "month" };
const rankProducts = { mode: "product" };
const rankMonths = { mode: "month" };

/**
 * id -> binding.
 *
 * Grouped by lens, in slot order. Covers the full 16 x 10 grid (161 entries total).
 */
const REGISTRY = {
  /* ---- Lens 1: City Revenue Trend (sheet 07 Table 1) ---- */
  "L01.A01": bind(trend, "declineStreak", city),
  "L01.A02": bind(trend, "latestGrowth", city),
  "L01.A03": bind(trend, "rollingMomentum", { ...city, window: 3 }),
  "L01.A04": bind(trend, "peakGap", city),
  "L01.A05": bind(trend, "shareShift", city),
  "L01.A06": bind(trend, "volatilityCv", city),
  "L01.A07": bind(trend, "topNDependency", { ...city, n: 2, threshold: "TOP2_DEPENDENCY" }),
  "L01.A08": bind(trend, "trendSlope", city),
  "L01.A09": bind(trend, "companyTrend", {}),
  "L01.A10": bind(trend, "growthDeclineBalance", city),

  /* ---- Lens 2: City Totals vs Equal-Share Benchmark (sheet 07 Table 2) ---- */
  "L02.A01": bind(concentration, "equalShareBenchmark", city),
  "L02.A02": bind(concentration, "rankingScaleGap", city),
  "L02.A03": bind(concentration, "hhiIndex", city),
  "L02.A04": bind(concentration, "smallestVsLargest", city),
  "L02.A05": bind(concentration, "growthSummary", city),
  "L02.A06": bind(concentration, "averagePerPeriod", city),
  "L02.A07": bind(concentration, "multipleOfSmallest", city),
  "L02.A08": bind(concentration, "revenueByDirection", city),
  "L02.A09": bind(concentration, "medianVsMean", city),
  "L02.A10": bind(concentration, "quartileClassification", city),

  /* ---- Lens 3: City-Product Dependency Risk (sheet 08 Table 1) ---- */
  "L03.A01": bind(coverage_, "dependencyRisk", byCity),
  "L03.A02": bind(coverage_, "portfolioStrength", byCity),
  "L03.A03": bind(coverage_, "revenueParity", byCity),
  "L03.A04": bind(coverage_, "rangeWithin", byCity),
  "L03.A05": bind(coverage_, "coverageGap", byCity),
  "L03.A06": bind(coverage_, "largestSingleCombo", {}),
  "L03.A07": bind(coverage_, "crossRanking", byProduct),
  "L03.A08": bind(coverage_, "crossDiversification", byCity),
  "L03.A09": bind(coverage_, "dominantCounterpart", byCity),
  "L03.A10": bind(coverage_, "bottomCombos", { n: 3 }),

  /* ---- Lens 4: Within-Product City Balance (sheet 08 Table 2) ---- */
  "L04.A01": bind(coverage_, "dependencyRisk", byProduct),
  "L04.A02": bind(coverage_, "crossDiversification", byProduct),
  "L04.A03": bind(coverage_, "shareWithin", byProduct),
  "L04.A04": bind(coverage_, "rangeWithin", byProduct),
  "L04.A05": bind(coverage_, "dominantCounterpart", byProduct),
  "L04.A06": bind(coverage_, "contributionSkew", byProduct),
  "L04.A07": bind(coverage_, "portfolioStrength", byCity),
  "L04.A08": bind(coverage_, "revenueParity", byProduct),
  "L04.A09": bind(coverage_, "classifyByShare", byProduct),
  "L04.A10": bind(coverage_, "coverageGap", byProduct),

  /* ---- Lens 5: Company Monthly Trend (sheet 09 Table 1) ---- */
  "L05.A01": bind(trend, "companyTrend", {}),
  "L05.A02": bind(trend, "monthlyConcentrationIndex", {}),
  "L05.A03": bind(trend, "frontVsBackLoading", {}),
  "L05.A04": bind(trend, "cityMonthlyVolatility", city),
  "L05.A05": bind(trend, "bestVsWorstGap", {}),
  "L05.A06": bind(trend, "proportionalShare3M", {}),
  "L05.A07": bind(trend, "momConsistency", {}),
  "L05.A08": bind(trend, "cityRankStability", city),
  "L05.A09": bind(trend, "quarterlyTrajectory", {}),
  "L05.A10": bind(trend, "crossCitySync", city),
  "L05.A11": bind(trend, "latestVsPeak", {}),

  /* ---- Lens 6: SubCategory Month Mix & Decline (sheet 09 Table 2) ---- */
  "L06.A01": bind(trend, "declineStreak", group),
  "L06.A02": bind(trend, "rollingMomentum", { ...group, window: 3 }),
  "L06.A03": bind(trend, "peakGap", group),
  "L06.A04": bind(trend, "volatilityCv", group),
  "L06.A05": bind(trend, "latestGrowth", group),
  "L06.A06": bind(trend, "growthDeclineBalance", group),
  "L06.A07": bind(trend, "shareShift", group),
  "L06.A08": bind(trend, "topNDependency", { ...group, n: 1, threshold: "SINGLE_ENTITY_DEPENDENCY" }),
  "L06.A09": bind(trend, "trendSlope", group),
  "L06.A10": bind(trend, "portfolioGrowthDeclineImpact", group),

  /* ---- Lens 7: SubCategory Head-to-Head (sheet 10 Table 1) ---- */
  "L07.A01": bind(comparison, "headToHeadGap", pairOfProducts),
  "L07.A02": bind(comparison, "headToHeadRatio", pairOfProducts),
  "L07.A03": bind(comparison, "dominancePattern", pairOfProducts),
  "L07.A04": bind(comparison, "gapMagnitude", pairOfProducts),
  "L07.A05": bind(comparison, "largestGapCity", pairOfProducts),
  "L07.A06": bind(comparison, "underdogWins", pairOfProducts),
  "L07.A07": bind(comparison, "revenueWeightedGap", pairOfProducts),
  "L07.A08": bind(comparison, "growthDirectionComparison", pairOfProducts),
  "L07.A09": bind(comparison, "scaleDifference", pairOfProducts),
  "L07.A10": bind(comparison, "headToHeadRecovery", pairOfProducts),

  /* ---- Lens 8: SubCategory Ranking by City (sheet 10 Table 2) ---- */
  "L08.A01": bind(comparison, "rankingConsistency", rankProducts),
  "L08.A02": bind(comparison, "rankDispersion", rankProducts),
  "L08.A03": bind(comparison, "mostFrequentlyTop", rankProducts),
  "L08.A04": bind(comparison, "weakestOverall", rankProducts),
  "L08.A05": bind(comparison, "rankingAgreement", rankProducts),
  "L08.A06": bind(comparison, "neverTopN", { ...rankProducts, topN: 2 }),
  "L08.A07": bind(comparison, "dominantConcentration", rankProducts),
  "L08.A08": bind(comparison, "cityPreferenceDiversity", rankProducts),
  "L08.A09": bind(comparison, "bottomRankedRisk", rankProducts),
  "L08.A10": bind(comparison, "rankRevenueDivergence", rankProducts),

  /* ---- Lens 9: Concentration Risk (HHI) (sheet 11 Table 1) ---- */
  "L09.A01": bind(concentration, "hhiRegister", group),
  "L09.A02": bind(concentration, "highestHhi", group),
  "L09.A03": bind(concentration, "averagePortfolioHhi", group),
  "L09.A04": bind(concentration, "hhiSpread", group),
  "L09.A05": bind(concentration, "aboveConcentrationThreshold", { ...group, limit: 0.10 }),
  "L09.A06": bind(concentration, "mostDiversified", group),
  "L09.A07": bind(concentration, "hhiWeightedExposure", group),
  "L09.A08": bind(concentration, "diversificationGap", group),
  "L09.A09": bind(concentration, "concentrationHealthScore", group),
  "L09.A10": bind(concentration, "concentrationImprovement", group),

  /* ---- Lens 10: Top SubCategory x City Combos (sheet 11 Table 2) ---- */
  "L10.A01": bind(concentration, "topNConcentration", { n: 5, threshold: "TOP5_CONCENTRATION" }),
  "L10.A02": bind(concentration, "topNConcentration", { n: 3, threshold: "TOP3_CONCENTRATION" }),
  "L10.A03": bind(concentration, "topNConcentration", { n: 1, threshold: "TOP1_CONCENTRATION" }),
  "L10.A04": bind(concentration, "adjacentDropoff", {}),
  "L10.A05": bind(concentration, "representationInTopN", { n: 5, facet: "city" }),
  "L10.A06": bind(concentration, "representationInTopN", { n: 5, facet: "group" }),
  "L10.A07": bind(concentration, "topNConcentration", { n: 5, threshold: "TOP5_CONCENTRATION" }),
  "L10.A08": bind(concentration, "rankGap", { from: 1, to: 10 }),
  "L10.A09": bind(concentration, "dominanceInTopN", { n: 5, facet: "city" }),
  "L10.A10": bind(concentration, "tailRisk", { head: 5 }),

  /* ---- Lens 11: Contribution Bridge by SubCategory (sheet 12 Table 1) ---- */
  "L11.A01": bind(contribution, "contributionRedFlags", group),
  "L11.A02": bind(contribution, "largestNegative", group),
  "L11.A03": bind(contribution, "largestPositive", group),
  "L11.A04": bind(contribution, "netMoversBalance", group),
  "L11.A05": bind(contribution, "positiveVsNegative", group),
  "L11.A06": bind(contribution, "contributionImbalance", group),
  "L11.A07": bind(contribution, "topNegativeContributors", { ...group, n: 2 }),
  "L11.A08": bind(contribution, "offsetCapacity", group),
  "L11.A09": bind(contribution, "changeVsAverage", group),
  "L11.A10": bind(contribution, "companyGrowthRate", {}),

  /* ---- Lens 12: Contribution Bridge by Month (sheet 12 Table 2) ----
     The slots here were shifted by one against the workbook: A01 is its
     structural note, not the trend direction, and every binding below it had
     inherited its neighbour's builder. */
  "L12.A01": bind(contribution, "monthlyBridgeOverview", {}),
  "L12.A02": bind(contribution, "monthlyTrendDirection", {}),
  "L12.A03": bind(contribution, "declinePersistence", {}),
  "L12.A04": bind(contribution, "breakEvenTimeline", {}),
  "L12.A05": bind(contribution, "changeDistribution", group),
  "L12.A06": bind(contribution, "netRevenuePosition", {}),
  "L12.A07": bind(contribution, "structuralLimitation", {}),
  "L12.A08": bind(contribution, "largestNegative", city),
  "L12.A09": bind(contribution, "recoveryPotential", city),
  "L12.A10": bind(contribution, "positiveVsNegative", group),

  /* ---- Lens 13: Month Head-to-Head (sheet 13 Table 1) ---- */
  "L13.A01": bind(comparison, "headToHeadGap", pairOfMonths),
  "L13.A02": bind(comparison, "headToHeadRatio", pairOfMonths),
  "L13.A03": bind(comparison, "dominancePattern", pairOfMonths),
  "L13.A04": bind(comparison, "gapMagnitude", pairOfMonths),
  "L13.A05": bind(comparison, "largestGapCity", pairOfMonths),
  "L13.A06": bind(comparison, "underdogWins", pairOfMonths),
  "L13.A07": bind(comparison, "combinedTotal", pairOfMonths),
  "L13.A08": bind(comparison, "headToHeadRecovery", pairOfMonths),
  "L13.A09": bind(comparison, "revenueWeightedGap", pairOfMonths),
  "L13.A10": bind(comparison, "headToHeadRecovery", pairOfMonths),

  /* ---- Lens 14: Month Ranking by City (sheet 13 Table 2) ---- */
  "L14.A01": bind(comparison, "rankingConsistency", rankMonths),
  "L14.A02": bind(comparison, "latestPeriodAverageRank", rankMonths),
  "L14.A03": bind(comparison, "strongestOverall", rankMonths),
  "L14.A04": bind(comparison, "weakestOverall", rankMonths),
  "L14.A05": bind(comparison, "firstVsLastRankChange", rankMonths),
  "L14.A06": bind(comparison, "rankVolatilityByCity", rankMonths),
  "L14.A07": bind(comparison, "consistentlyTopN", { ...rankMonths, topN: 3 }),
  "L14.A08": bind(comparison, "recentVsHistoricalRank", { ...rankMonths, window: 3 }),
  "L14.A09": bind(comparison, "mostImprovedByRank", rankMonths),
  "L14.A10": bind(comparison, "rankingAgreement", rankMonths),

  /* ---- Lens 15: Peak & Trough by SubCategory (sheet 14 Table 1) ---- */
  "L15.A01": bind(volatility, "peakTroughRegister", group),
  "L15.A02": bind(volatility, "highestVolatility", group),
  "L15.A03": bind(volatility, "mostStable", group),
  "L15.A04": bind(volatility, "averageVolatility", group),
  "L15.A05": bind(volatility, "extremeVolatilityCount", group),
  "L15.A06": bind(volatility, "revenueAtRiskGap", group),
  "L15.A07": bind(volatility, "peakMonthShare", group),
  "L15.A08": bind(volatility, "troughVsAverageGap", group),
  "L15.A09": bind(volatility, "currentVsTroughBuffer", group),
  "L15.A10": bind(volatility, "volatilityWeightedExposure", group),

  /* ---- Lens 16: Peak & Trough by Month (sheet 14 Table 2) ---- */
  "L16.A01": bind(volatility, "monthlyStructuralOverview", {}),
  "L16.A02": bind(volatility, "monthlyRevenueRange", {}),
  "L16.A03": bind(volatility, "companyMonthlyCv", {}),
  "L16.A04": bind(volatility, "monthlyBestVsWorstMultiple", {}),
  "L16.A05": bind(volatility, "monthsBelowAverage", {}),
  "L16.A06": bind(volatility, "monthlyTrendStrength", {}),
  "L16.A07": bind(volatility, "monthlyPredictabilityScore", {}),
  "L16.A08": bind(volatility, "revenueAcceleration", {}),
  "L16.A09": bind(volatility, "peakMonthCompanyConcentration", {}),
  // A01 already computes the peak/trough overview; binding A10 to it as well
  // gave two slots the same numbers under two names. A10 is the workbook's own
  // note about what its degenerate table could not show, so it asks that
  // question of whatever data the company actually has.
  "L16.A10": bind(contribution, "structuralLimitation", {})
};

/** The binding for an analysis, or null when none exists yet. */
function bindingFor(id) {
  return REGISTRY[id] || null;
}

/** How much of the catalog is wired up — surfaced in the API meta. */
function coverage(catalog) {
  const total = catalog ? catalog.length : Object.keys(REGISTRY).length;
  const bound = catalog ? catalog.filter((e) => REGISTRY[e.id]).length : Object.keys(REGISTRY).length;
  const pending = total - bound;
  const percent = total > 0 ? Number(((bound / total) * 100).toFixed(1)) : 0;
  return { total, bound, pending, percent };
}

module.exports = { REGISTRY, bindingFor, coverage };
