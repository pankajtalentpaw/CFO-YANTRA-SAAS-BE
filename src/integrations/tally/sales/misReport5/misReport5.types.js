/**
 * Thresholds and constants for Report #5 (SubCategory x City x Month MIS).
 */

const THRESHOLDS = {
  // Filters 1, 5, 6: Streak & Trend
  STREAK_MONTHS_THRESHOLD: 3,

  // Filters 2: Benchmark
  // Equal-share benchmark = Total / N_Cities

  // Filter 3 & 4: Concentration & Dependency
  SINGLE_PRODUCT_DEPENDENCY_THRESHOLD: 0.75, // 75%
  DOMINANT_CITY_SHARE_THRESHOLD: 0.75, // 75%

  // Filters 7 & 13: Scale Comparability Gap
  SCALE_GAP_THRESHOLD_PERCENT: 30, // 30%

  // Filters 8 & 14: Rank Classification
  RANK_STRONG_THRESHOLD: 2.0, // Avg rank <= 2
  RANK_WEAK_THRESHOLD: 5.0, // Avg rank >= 5
  MONTH_RANK_STRONG_THRESHOLD: 4.0, // Avg rank <= 4
  MONTH_RANK_WEAK_THRESHOLD: 10.0, // Avg rank >= 10

  // Filter 9: Concentration Risk (HHI)
  HHI_HIGH_RISK_THRESHOLD: 0.80,
  HHI_MODERATE_RISK_THRESHOLD: 0.50,

  // Filter 10: Top Combos Pareto
  PARETO_TOP1_PERCENT: 15,
  PARETO_TOP3_PERCENT: 40,
  PARETO_TOP5_PERCENT: 60,

  // Filters 11 & 12: Contribution Bridge
  MATERIAL_CONTRIBUTOR_THRESHOLD_PERCENT: 15, // 15% of total decline

  // Filters 15 & 16: Peak & Trough Volatility
  VOLATILITY_RATIO_RED: 3.0,
  VOLATILITY_RATIO_AMBER: 2.0
};

module.exports = {
  THRESHOLDS
};
