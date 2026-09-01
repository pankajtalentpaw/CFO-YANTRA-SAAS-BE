"use strict";

const Decimal = require("decimal.js");
const { toDecimalString } = require("../../../../../utils/financialDecimal");

/**
 * Filter 16: Action Center - Management Protocols & Playbook (Sheet 15-16 / Lens 16)
 * 100% Dynamic Engine: Generates prioritized management action protocols directly from the computed sales cube.
 */
function evaluateFilter16_ActionCenter(cube, filters = {}) {
  const totalRevenue = cube.totalRevenue || new Decimal(0);
  const totalRevNum = totalRevenue.toNumber();
  const months = cube.months || [];
  const subCategories = cube.subCategories || [];
  const cities = cube.cities || [];
  const cityTotals = cube.cityTotals || new Map();
  const subCategoryTotals = cube.subCategoryTotals || new Map();

  const redProtocols = [];
  const amberProtocols = [];
  const greenProtocols = [];

  let redIdx = 1;
  let amberIdx = 1;
  let greenIdx = 1;

  // 1. Dynamic Check: City Decline Streaks (RED / AMBER)
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
    const cRev = (cityTotals.get(c) || new Decimal(0)).toNumber();
    const cShare = totalRevNum > 0 ? Number(((cRev / totalRevNum) * 100).toFixed(1)) : 0;

    if (streak >= 2 || (cShare > 25 && streak >= 1)) {
      redProtocols.push({
        id: `RED-${redIdx++}`,
        title: `${c} Sustained Decline Streak (${streak} Consecutive Months)`,
        badge: "CRITICAL REVENUE AT RISK",
        exposure: cRev,
        exposureFormatted: `₹${(cRev / 1e5).toFixed(2)} L`,
        materiality: cShare,
        context: `${c} accounts for ${cShare}% of enterprise revenue but has experienced a ${streak}-month volume drop.`,
        action: `Immediate sales leadership intervention in ${c}. Audit dealer inventories and enforce pricing floors.`,
        evidence: `City Trend Matrix • Streak = ${streak} Months • Exposure = ₹${cRev.toLocaleString("en-IN")}`
      });
    } else if (cShare > 20) {
      amberProtocols.push({
        id: `AMBER-${amberIdx++}`,
        title: `${c} High Regional Concentration (${cShare}% Share)`,
        badge: "REGIONAL CONCENTRATION",
        exposure: cRev,
        exposureFormatted: `₹${(cRev / 1e5).toFixed(2)} L`,
        materiality: cShare,
        context: `${c} represents ${cShare}% of total enterprise turnover, creating single-market dependency.`,
        action: `Diversify distributor relationships beyond primary hubs into tier-2 territories.`,
        evidence: `City Reference Totals • Volume = ₹${cRev.toLocaleString("en-IN")}`
      });
    }
  }

  // 2. Dynamic Check: Product Concentration & Negative Drops (RED / AMBER)
  for (const p of subCategories) {
    const pRev = (subCategoryTotals.get(p) || new Decimal(0)).toNumber();
    const pShare = totalRevNum > 0 ? Number(((pRev / totalRevNum) * 100).toFixed(1)) : 0;

    if (pShare > 40) {
      amberProtocols.push({
        id: `AMBER-${amberIdx++}`,
        title: `${p} Single-Product Dominance (${pShare}% Share)`,
        badge: "PORTFOLIO CONCENTRATION",
        exposure: pRev,
        exposureFormatted: `₹${(pRev / 1e5).toFixed(2)} L`,
        materiality: pShare,
        context: `${p} commands ${pShare}% of total sales. A supply disruption would heavily impact operating margin.`,
        action: `Promote secondary high-margin lines to reduce single-product revenue dependency below 35%.`,
        evidence: `Product Breakdown • Volume = ₹${pRev.toLocaleString("en-IN")} • Share = ${pShare}%`
      });
    } else if (pShare > 15) {
      greenProtocols.push({
        id: `GREEN-${greenIdx++}`,
        title: `${p} Strong Revenue Anchor (${pShare}% Share)`,
        badge: "CORE GROWTH PILLAR",
        volume: pRev,
        volumeFormatted: `₹${(pRev / 1e5).toFixed(2)} L`,
        momentum: `${pShare}%`,
        context: `${p} represents ₹${pRev.toLocaleString("en-IN")} in gross sales with proven customer demand.`,
        action: `Prioritize working capital allocations for ${p} supply agreements to protect order fulfillment.`,
        evidence: `Product Breakdown • Volume = ₹${pRev.toLocaleString("en-IN")}`
      });
    }
  }

  // Fallback safe protocols if arrays are small
  if (greenProtocols.length === 0 && subCategories.length > 0) {
    const topP = subCategories[0];
    const topRev = (subCategoryTotals.get(topP) || new Decimal(0)).toNumber();
    greenProtocols.push({
      id: "GREEN-1",
      title: `${topP} Enterprise Volume Anchor`,
      badge: "CORE REVENUE DRIVER",
      volume: topRev,
      volumeFormatted: `₹${(topRev / 1e5).toFixed(2)} L`,
      momentum: "Primary",
      context: `${topP} delivers foundational cashflow with established market position.`,
      action: "Maintain steady inventory replenishment and secure long-term buyer agreements.",
      evidence: `Active Register Ledger • Total = ₹${topRev.toLocaleString("en-IN")}`
    });
  }

  const totalCount = redProtocols.length + amberProtocols.length + greenProtocols.length;

  return {
    filterId: 16,
    filterName: "Action Center - Management Protocols & Playbook",
    type: "Executive Action",
    ownerQuestion: "What are the exact prioritized management actions leadership must execute across Red, Amber, and Green triggers?",
    summary: `${redProtocols.length} Critical Red, ${amberProtocols.length} Amber Warning, ${greenProtocols.length} Green Growth Protocols`,
    protocols: {
      red: redProtocols,
      amber: amberProtocols,
      green: greenProtocols
    },
    protocolCounts: {
      red: redProtocols.length,
      amber: amberProtocols.length,
      green: greenProtocols.length,
      total: totalCount
    },
    redProtocols,
    amberProtocols,
    greenProtocols,
    totalProtocolsCount: totalCount,
    redCount: redProtocols.length,
    amberCount: amberProtocols.length,
    greenCount: greenProtocols.length
  };
}

module.exports = {
  evaluateFilter16_ActionCenter
};
