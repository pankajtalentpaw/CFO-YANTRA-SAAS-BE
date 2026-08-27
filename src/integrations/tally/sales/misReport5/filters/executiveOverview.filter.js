"use strict";

const Decimal = require("decimal.js");
const { toDecimalString } = require("../../../../../utils/financialDecimal");

/**
 * Filter 0: Main MIS — Executive Overview (Sheet 01)
 * 100% Dynamic Engine: Computes all KPIs, dynamic takeaways, and executive scorecard directly from the active Multi-Dimensional Sales Cube.
 */
function evaluateFilter0_ExecutiveOverview(cube, filters = {}) {
  const totalRevenue = cube.totalRevenue || new Decimal(0);
  const months = cube.months || [];
  const subCategories = cube.subCategories || [];
  const cities = cube.cities || [];
  const monthTotals = cube.monthTotals || new Map();
  const subCategoryTotals = cube.subCategoryTotals || new Map();
  const cityTotals = cube.cityTotals || new Map();

  const totalRevNum = totalRevenue.toNumber();
  const monthsCount = Math.max(months.length, 1);
  const avgMonthly = totalRevenue.dividedBy(monthsCount);

  const startMonth = months[0] || "";
  const latestMonth = months[months.length - 1] || startMonth;
  const priorMonth = months.length > 1 ? months[months.length - 2] : startMonth;

  const startRev = monthTotals.get(startMonth) || new Decimal(0);
  const latestRev = monthTotals.get(latestMonth) || new Decimal(0);
  const priorRev = monthTotals.get(priorMonth) || new Decimal(0);

  const momChange = latestRev.minus(priorRev);
  const momChangePct = priorRev.isZero() ? 0 : momChange.times(100).dividedBy(priorRev).toDecimalPlaces(1).toNumber();

  const periodChange = latestRev.minus(startRev);
  const periodChangePct = startRev.isZero() ? 0 : periodChange.times(100).dividedBy(startRev).toDecimalPlaces(1).toNumber();

  // Dynamic Top Product & Top City
  let topProduct = subCategories[0] || "None";
  let topProductRev = new Decimal(0);
  for (const [p, rev] of subCategoryTotals.entries()) {
    if (rev.greaterThan(topProductRev)) {
      topProductRev = rev;
      topProduct = p;
    }
  }
  const topProductShare = totalRevenue.isZero() ? 0 : topProductRev.times(100).dividedBy(totalRevenue).toDecimalPlaces(1).toNumber();

  let topCity = cities[0] || "None";
  let topCityRev = new Decimal(0);
  for (const [c, rev] of cityTotals.entries()) {
    if (rev.greaterThan(topCityRev)) {
      topCityRev = rev;
      topCity = c;
    }
  }
  const topCityShare = totalRevenue.isZero() ? 0 : topCityRev.times(100).dividedBy(totalRevenue).toDecimalPlaces(1).toNumber();

  // Trailing 3M Momentum
  let recent3mSum = new Decimal(0);
  let prior3mSum = new Decimal(0);
  const mLen = months.length;
  for (let i = Math.max(0, mLen - 3); i < mLen; i++) {
    recent3mSum = recent3mSum.plus(monthTotals.get(months[i]) || new Decimal(0));
  }
  for (let i = Math.max(0, mLen - 6); i < Math.max(0, mLen - 3); i++) {
    prior3mSum = prior3mSum.plus(monthTotals.get(months[i]) || new Decimal(0));
  }
  const momentumPct = prior3mSum.isZero() ? (periodChangePct || 0) : recent3mSum.minus(prior3mSum).times(100).dividedBy(prior3mSum).toDecimalPlaces(1).toNumber();

  // Peak and Trough Months
  let peakMonth = startMonth;
  let peakRev = new Decimal(0);
  let troughMonth = startMonth;
  let troughRev = totalRevenue.greaterThan(0) ? totalRevenue : new Decimal(0);

  for (const [m, rev] of monthTotals.entries()) {
    if (rev.greaterThan(peakRev)) {
      peakRev = rev;
      peakMonth = m;
    }
    if (rev.lessThan(troughRev) && rev.greaterThan(0)) {
      troughRev = rev;
      troughMonth = m;
    }
  }
  if (troughRev.greaterThan(peakRev)) troughRev = peakRev;

  // Ranked Products
  const palette = ["#1B3A6B", "#136F53", "#B08327", "#A02C24", "#7E57C2", "#00897B", "#5C6BC0", "#8D6E63"];
  const productList = subCategories.map((p, idx) => {
    const rev = subCategoryTotals.get(p) || new Decimal(0);
    const sh = totalRevenue.isZero() ? 0 : rev.times(100).dividedBy(totalRevenue).toDecimalPlaces(1).toNumber();
    return {
      name: p,
      revenue: rev.toNumber(),
      revenueFormatted: toDecimalString(rev),
      share: sh,
      color: palette[idx % palette.length]
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // Ranked Cities
  const cityList = cities.map((c, idx) => {
    const rev = cityTotals.get(c) || new Decimal(0);
    const sh = totalRevenue.isZero() ? 0 : rev.times(100).dividedBy(totalRevenue).toDecimalPlaces(1).toNumber();
    return {
      name: c,
      key: c.toLowerCase(),
      revenue: rev.toNumber(),
      revenueFormatted: toDecimalString(rev),
      share: sh,
      color: palette[idx % palette.length]
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // What Changed: Latest Month vs Prior Month
  const whatChangedAttribution = subCategories.map((p) => {
    const pPriorRev = (cube.subCategoryMonthMatrix?.get(p)?.get(priorMonth)) || new Decimal(0);
    const pLatestRev = (cube.subCategoryMonthMatrix?.get(p)?.get(latestMonth)) || new Decimal(0);
    const pChange = pLatestRev.minus(pPriorRev);
    const pShare = momChange.isZero() ? 0 : pChange.times(100).dividedBy(momChange.abs()).toDecimalPlaces(1).toNumber();
    const materiality = totalRevenue.isZero() ? 0 : pChange.abs().times(10).dividedBy(totalRevenue).toDecimalPlaces(2).toNumber();

    return {
      name: p,
      prior: pPriorRev.toNumber(),
      latest: pLatestRev.toNumber(),
      change: pChange.toNumber(),
      share: Math.abs(pShare),
      materiality,
      dir: pChange.greaterThanOrEqualTo(0) ? "up" : "down"
    };
  }).sort((a, b) => b.change - a.change);

  // Dynamic Calculation of Biggest Gain & Heaviest Drag across products & cities
  let bestGain = { name: topProduct, amount: 0 };
  let worstDrag = { name: "None", amount: 0, dropPct: 0 };

  for (const item of whatChangedAttribution) {
    if (item.change > bestGain.amount) {
      bestGain = { name: item.name, amount: item.change };
    }
    if (item.change < worstDrag.amount) {
      worstDrag = { name: item.name, amount: item.change, dropPct: item.share };
    }
  }

  // Calculate city decline streaks dynamically
  const cityStreaksList = [];
  for (const c of cities) {
    const cMap = cube.cityMonthMatrix?.get(c) || new Map();
    let streak = 0;
    let priorVal = null;
    for (let i = months.length - 1; i >= 0; i--) {
      const val = cMap.get(months[i])?.toNumber() || 0;
      if (priorVal !== null) {
        if (val > priorVal) {
          streak++;
        } else {
          break;
        }
      }
      priorVal = val;
    }
    if (streak > 0) {
      cityStreaksList.push({ city: c, streak, rev: (cityTotals.get(c) || new Decimal(0)).toNumber() });
    }
  }
  cityStreaksList.sort((a, b) => b.streak - a.streak);
  const maxDeclineStreak = cityStreaksList[0]?.streak || 0;
  const decliningCityObj = cityStreaksList[0];

  // Dynamic Top 3 Combos Concentration
  const comboList = [];
  for (const c of cities) {
    for (const p of subCategories) {
      const rev = (cube.citySubCategoryMatrix?.get(c)?.get(p)) || new Decimal(0);
      if (rev.greaterThan(0)) {
        comboList.push({ combo: `${p} - ${c}`, revenue: rev.toNumber() });
      }
    }
  }
  comboList.sort((a, b) => b.revenue - a.revenue);
  const top3RevenueSum = comboList.slice(0, 3).reduce((sum, item) => sum + item.revenue, 0);
  const top3ComboPercent = totalRevNum > 0 ? Number(((top3RevenueSum / totalRevNum) * 100).toFixed(1)) : 0;

  // Composite Health Score (0 - 100) dynamically calculated
  const growthScore = Math.min(100, Math.max(10, Math.round(50 + (periodChangePct > 0 ? periodChangePct * 1.5 : periodChangePct * 2))));
  const declineStreakPenalty = Math.max(0, 30 - maxDeclineStreak * 6);
  const volatilityScore = Math.max(10, Math.round(60 - (topProductShare > 50 ? 25 : 0)));
  const concentrationScore = Math.max(10, Math.round(70 - (top3ComboPercent > 50 ? 30 : top3ComboPercent > 30 ? 15 : 0)));
  const compositeHealthScore = Math.min(100, Math.max(10, Math.round((growthScore + declineStreakPenalty + volatilityScore + concentrationScore) / 4)));

  // Dynamic 5 Things Management Should Know (Takeaways) derived strictly from active dataset
  const takeaways = [];

  // 1. Biggest Positive Movement
  if (bestGain.amount > 0) {
    takeaways.push({
      id: 1,
      type: "POSITIVE",
      badge: "BIGGEST POSITIVE MOVEMENT",
      title: `${bestGain.name} added ₹${Number(bestGain.amount).toLocaleString("en-IN")}`,
      text: `${bestGain.name} gained +₹${Number(bestGain.amount).toLocaleString("en-IN")} between ${priorMonth || "prior period"} and ${latestMonth || "latest period"} — the highest volume expansion in the scope.`
    });
  } else if (topProduct !== "None") {
    takeaways.push({
      id: 1,
      type: "POSITIVE",
      badge: "CORE REVENUE DRIVER",
      title: `${topProduct} delivers ₹${Number(topProductRev.toNumber()).toLocaleString("en-IN")}`,
      text: `${topProduct} is the enterprise volume anchor, delivering ${topProductShare}% of aggregate turnover.`
    });
  }

  // 2. Heaviest Negative Drag
  if (worstDrag.amount < 0) {
    takeaways.push({
      id: 2,
      type: "NEGATIVE",
      badge: "HEAVIEST NEGATIVE DRAG",
      title: `${worstDrag.name} dragged by -₹${Number(Math.abs(worstDrag.amount)).toLocaleString("en-IN")}`,
      text: `${worstDrag.name} dropped by -₹${Number(Math.abs(worstDrag.amount)).toLocaleString("en-IN")} in the latest period, representing significant margin drag.`
    });
  }

  // 3. Strongest Product
  if (topProduct !== "None") {
    takeaways.push({
      id: 3,
      type: "NEUTRAL",
      badge: "STRONGEST PRODUCT",
      title: `${topProduct} generated ₹${Number(topProductRev.toNumber()).toLocaleString("en-IN")}`,
      text: `${topProduct} generated ₹${Number(topProductRev.toNumber()).toLocaleString("en-IN")}, accounting for ${topProductShare}% of total invoiced revenue.`
    });
  }

  // 4. Strongest City
  if (topCity !== "None") {
    takeaways.push({
      id: 4,
      type: "NEUTRAL",
      badge: "STRONGEST CITY",
      title: `${topCity} generated ₹${Number(topCityRev.toNumber()).toLocaleString("en-IN")}`,
      text: `${topCity} is the primary geographical contributor, generating ₹${Number(topCityRev.toNumber()).toLocaleString("en-IN")} (${topCityShare}% of total).`
    });
  }

  // 5. Decline Risk / Streak
  if (decliningCityObj && decliningCityObj.streak >= 1) {
    takeaways.push({
      id: 5,
      type: "ALERT",
      badge: "DECLINE STREAK RISK",
      title: `${decliningCityObj.city} consecutive decline streak`,
      text: `${decliningCityObj.city} exhibits a ${decliningCityObj.streak}-month consecutive decline streak involving ₹${Number(decliningCityObj.rev).toLocaleString("en-IN")} of volume.`
    });
  } else {
    takeaways.push({
      id: 5,
      type: "POSITIVE",
      badge: "MOMENTUM INTEGRITY",
      title: "Regional momentum stable",
      text: "No major territory is currently undergoing an unaddressed multi-month decline streak."
    });
  }

  // 6. Growth Opportunity
  const fastestCity = cityList.length > 1 ? cityList[1] : cityList[0];
  if (fastestCity) {
    takeaways.push({
      id: 6,
      type: "GROWTH",
      badge: "EXPANSION TERRITORY",
      title: `${fastestCity.name} expansion potential`,
      text: `${fastestCity.name} represents ₹${Number(fastestCity.revenue).toLocaleString("en-IN")} (${fastestCity.share}% share). Evaluate expanding distributor networks there.`
    });
  }

  return {
    filterId: 0,
    filterName: "Main MIS — Executive Overview",
    type: "Executive Scorecard",
    ownerQuestion: "How much did we sell, is it growing and decelerating, what is driving it, and what needs attention?",
    kpiScorecard: {
      totalSales: totalRevNum,
      totalSalesFormatted: toDecimalString(totalRevenue),
      avgMonthly: avgMonthly.toNumber(),
      avgMonthlyFormatted: toDecimalString(avgMonthly),
      startMonth,
      startRev: startRev.toNumber(),
      latestMonth,
      latestRev: latestRev.toNumber(),
      priorMonth,
      priorRev: priorRev.toNumber(),
      momChange: momChange.toNumber(),
      momChangePct,
      periodChange: periodChange.toNumber(),
      periodChangePct,
      topProduct,
      topProductRev: topProductRev.toNumber(),
      topProductShare,
      topCity,
      topCityRev: topCityRev.toNumber(),
      topCityShare,
      momentumPct,
      momentumStatus: momentumPct >= 0 ? "Accelerating" : "Decelerating",
      compositeHealthScore,
      healthCategory: compositeHealthScore >= 75 ? "Healthy" : compositeHealthScore >= 50 ? "Moderate" : "At Risk",
      peakMonth,
      peakRev: peakRev.toNumber(),
      troughMonth,
      troughRev: troughRev.toNumber(),
      direction: periodChange.greaterThanOrEqualTo(0) ? "Growing" : "Falling"
    },
    healthBreakdown: {
      growthScore,
      declineStreakPenalty,
      volatilityScore,
      concentrationScore,
      weakestComponent: declineStreakPenalty < 15 ? "Decline Streak" : concentrationScore < 30 ? "Concentration" : "Growth Rate"
    },
    takeaways,
    parameters: {
      totalSales: totalRevNum,
      topConcentrationPercent: topProductShare,
      top3ComboPercent,
      declineRunsMonths: maxDeclineStreak,
      severeVolatilityCount: productList.filter((p) => p.share > 30).length,
      periodChange: periodChange.toNumber(),
      largestDragProduct: worstDrag.amount < 0 ? worstDrag.name : "None",
      largestDragAmount: Math.abs(worstDrag.amount)
    },
    products: productList,
    cities: cityList,
    whatChangedAttribution
  };
}

module.exports = {
  evaluateFilter0_ExecutiveOverview
};
