"use strict";

/**
 * Builds rich, token-efficient financial context for AI models with real entities
 */
function buildFinancialContext({ company, salesAnalysis, misReport5 }) {
  const context = {
    company: {
      name: company?.companyName || "Unknown Co",
      startingAt: company?.startingAt || null
    }
  };

  if (salesAnalysis?.totals) {
    const invoiced = salesAnalysis.totals.invoicedValue || salesAnalysis.totals.totalAmount;
    context.salesMetrics = {
      invoicedSales: invoiced,
      invoicedSalesINR: invoiced,
      invoiceCount: salesAnalysis.totals.invoiceCount,
      itemCount: salesAnalysis.totals.itemCount,
      customerCount: salesAnalysis.totals.customerCount,
      salesReturns: salesAnalysis.totals.salesReturnsValue || 0,
      salesReturnsINR: salesAnalysis.totals.salesReturnsValue || 0
    };
  }

  if (misReport5) {
    const cityList = misReport5.filters?.filter1_cityRevenueTrend?.data?.map(c => ({
      city: c.city,
      cityName: c.city,
      revenue: c.totalRevenue,
      revenueINR: c.totalRevenue,
      sharePercent: c.sharePercent,
      streak: c.streakMonths,
      declineStreakMonths: c.streakMonths,
      slope: c.slope,
      costOfInaction: c.costOfInaction,
      costOfInactionINR: c.costOfInaction,
      insight: c.insight
    })) || [];

    context.report5MIS = {
      totalRevenue: misReport5.metadata?.totalRevenue,
      totalRevenueINR: misReport5.metadata?.totalRevenue,
      distinctProducts: misReport5.metadata?.distinctSubCategories,
      distinctProductsCount: misReport5.metadata?.distinctSubCategories,
      distinctCities: misReport5.metadata?.distinctCities,
      distinctCitiesCount: misReport5.metadata?.distinctCities,
      executiveSummary: misReport5.executiveSummary,

      // Real city metrics (Filters 1 & 2)
      cityStreaks: cityList,
      actualCities: cityList,

      // Real product rankings (Filter 8)
      actualTopProducts: misReport5.filters?.filter8_subCategoryRankingByCity?.rankings?.slice(0, 10).map(p => ({
        productName: p.subCategory,
        totalRevenueINR: p.totalRevenue,
        averageRank: p.avgRank,
        marketPower: p.status
      })),

      // Top Pareto combos (Filter 10)
      topCombos: misReport5.filters?.filter10_topCombos?.topCombos?.slice(0, 6)?.map(tc => ({
        combo: tc.combo,
        revenueINR: tc.revenue,
        sharePercent: tc.sharePercent,
        cumulativeSharePercent: tc.cumulativeSharePercent
      })),

      // Seasonality (Filter 5)
      monthlyTrend: misReport5.filters?.filter5_monthTrendCompanyWide?.data?.map(m => ({
        month: m.month,
        revenueINR: m.revenue,
        sharePercent: m.sharePercent
      })),

      hhiRiskCount: misReport5.filters?.filter9_concentrationRiskHhi?.summary,
      hhiConcentrationSummary: misReport5.filters?.filter9_concentrationRiskHhi?.summary,
      volatilitySummary: misReport5.filters?.filter15_peakTroughSubCategory?.summary
    };
  }

  return context;
}

module.exports = {
  buildFinancialContext
};
