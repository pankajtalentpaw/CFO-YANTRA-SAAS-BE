/**
 * Volatility builders — Peak & Trough Finder.
 *
 * Covers Lens 15 (Peak & Trough by SubCategory / Stock Group) and
 * Lens 16 (Peak & Trough by Month / Company Timeline).
 *
 * Quantifies swings between peak revenue and trough revenue across periods,
 * calculating peak-to-trough ratios, reliability gaps, buffer over trough,
 * and cash-flow predictability indices.
 */

const { FAMILY, STATUS, SEVERITY, FORMAT, makeBlock, makeHeadline, makeTable, makeCostOfInaction } = require("../../models/analysisBlock");
const { evaluate, worstOf, redFlagText } = require("../../engine/triggerEvaluator");
const { resolveMembers, drillFor } = require("../../engine/axes");
const stats = require("../shared/stats");
const coi = require("../../prescriptive/costOfInaction");
const {
  Decimal, toNumber, toFraction, share, safeDivide,
  formatINR, formatPercent, formatRatio, formatNumber
} = require("../shared/money");

function idleBlock(entry, reason, extra = {}) {
  return makeBlock(entry, {
    status: STATUS.IDLE,
    severity: SEVERITY.LOW,
    priority: 5,
    trigger: { rule: extra.rule || null, evaluated: reason, fired: false },
    provenance: { reason, ...extra.provenance }
  });
}

/** Calculate peak, trough, ratio, and gap for an entity series */
function getSeriesPeakTrough(series, periods = []) {
  if (!series || series.length === 0) {
    return {
      peak: new Decimal(0),
      trough: new Decimal(0),
      collapsed: false,
      volatilityRank: 1,
      ratioFormatted: "N/A",
      peakIndex: -1,
      troughIndex: -1,
      peakPeriod: null,
      troughPeriod: null,
      ratio: new Decimal(1),
      gap: new Decimal(0),
      mean: new Decimal(0),
      total: new Decimal(0),
      current: new Decimal(0),
      cv: new Decimal(0)
    };
  }

  let peak = series[0];
  let trough = series[0];
  let peakIndex = 0;
  let troughIndex = 0;
  let total = new Decimal(0);

  series.forEach((val, idx) => {
    total = total.plus(val);
    if (val.greaterThan(peak)) {
      peak = val;
      peakIndex = idx;
    }
    if (val.lessThan(trough)) {
      trough = val;
      troughIndex = idx;
    }
  });

  const mean = total.dividedBy(series.length);

  // A member that fell to zero in some period has NO finite peak-to-trough
  // ratio — dividing by nothing is undefined, not stable. This previously
  // returned 1.0 there, which ranked the most damaged products in the book as
  // its steadiest. `collapsed` says so explicitly, and `volatilityRank` sorts
  // those members as the most volatile rather than the least, which is what a
  // month of zero revenue actually means.
  const collapsed = !trough.isPositive() && peak.isPositive();
  const ratio = collapsed ? null : (trough.isPositive() ? peak.dividedBy(trough) : new Decimal(1));
  const gap = peak.minus(trough);
  const current = series[series.length - 1] || new Decimal(0);
  const cv = stats.cv(series) || new Decimal(0);

  return {
    peak,
    trough,
    collapsed,
    // For ordering only: undefined ratios belong at the volatile end.
    volatilityRank: ratio === null ? Infinity : Number(ratio.toString()),
    ratioFormatted: ratio === null ? "N/A — fell to zero" : `${ratio.toFixed(2)}x`,
    peakIndex,
    troughIndex,
    peakPeriod: periods[peakIndex] ? periods[peakIndex].label : `P${peakIndex + 1}`,
    troughPeriod: periods[troughIndex] ? periods[troughIndex].label : `P${troughIndex + 1}`,
    ratio,
    gap,
    mean,
    total,
    current,
    cv
  };
}

/* ------------------------------------------------------------------ */
/* Lens 15 Builders: SubCategory Peak & Trough                         */
/* ------------------------------------------------------------------ */

/** L15.A01 — Volatility trigger table across subcategories */
function peakTroughRegister(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods to identify peaks and troughs");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, `no ${axis.noun} found`);

  const results = members.map((m) => {
    const series = axis.series(cube, m.key);
    const pt = getSeriesPeakTrough(series, cube.periods);
    const ev = evaluate(pt.ratio, {
      rule: "Peak-to-Trough Ratio > 2.0 = AMBER (Volatile); > 3.0 = RED (Extreme Volatility)",
      metric: `${m.label} peak-to-trough ratio`,
      format: "ratio",
      bands: [
        { at: 2.0, status: STATUS.AMBER, severity: "MEDIUM" },
        { at: 3.0, status: STATUS.RED, severity: "HIGH" }
      ]
    });
    return { ...m, ...pt, ev };
  });

  results.sort((a, b) => b.volatilityRank - a.volatilityRank);
  const verdict = worstOf(results.map((r) => r.ev), { noun: axis.noun });
  const worst = results[0];

  const rows = results.map((r) => ({
    subCategory: r.label,
    peakRev: toNumber(r.peak),
    troughRev: toNumber(r.trough),
    peakToTroughRatio: toNumber(r.ratio, 2),
    volatilityTrigger: r.ev.status,
    reliabilityGap: toNumber(r.gap),
    _status: r.ev.status,
    _drill: drillFor(axis, r)
  }));

  const offenders = results.filter((r) => r.ev.fired);

  return makeBlock(entry, {
    status: verdict.status,
    severity: verdict.severity,
    priority: verdict.priority,
    trigger: { rule: verdict.rule, evaluated: verdict.evaluated, fired: verdict.fired },
    redFlag: redFlagText(offenders, { noun: axis.noun }),
    headline: makeHeadline({
      label: "Highest peak-to-trough ratio",
      value: worst ? toNumber(worst.ratio, 2) : 1,
      unit: "x",
      formatted: worst ? `${worst.label} (${worst.ratioFormatted})` : "None"
    }),
    table: makeTable({
      columns: [
        { key: "subCategory", label: axis.label, format: FORMAT.TEXT },
        { key: "peakRev", label: "Peak Revenue", format: FORMAT.CURRENCY },
        { key: "troughRev", label: "Trough Revenue", format: FORMAT.CURRENCY },
        { key: "peakToTroughRatio", label: "Peak-to-Trough Ratio", format: FORMAT.RATIO },
        { key: "volatilityTrigger", label: "Volatility Trigger", format: FORMAT.STATUS },
        { key: "reliabilityGap", label: "Reliability Gap (Best - Worst)", format: FORMAT.CURRENCY }
      ],
      rows
    }),
    narrative: worst && (worst.collapsed || worst.ratio.greaterThan(2))
      ? `${worst.label} swings by ${formatINR(worst.gap)} (${worst.ratioFormatted}) between its peak and trough month. High volatility complicates production planning and inventory holding.`
      : `Product revenue profiles across the ${cube.periods.length} months remain balanced without extreme swings.`,
    costOfInaction: worst && worst.ev.fired
      ? makeCostOfInaction({
        amount: toNumber(worst.gap.dividedBy(cube.periods.length)),
        formatted: `${formatINR(worst.gap.dividedBy(cube.periods.length))}/mo`,
        basis: `${worst.label} monthly volatility spread`,
        horizonMonths: 6
      })
      : null,
    provenance: { periodsUsed: cube.periods.length, rowsConsidered: members.length }
  });
}

/** L15.A02 — Highest volatility subcategory */
function highestVolatility(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  const items = members.map((m) => {
    const series = axis.series(cube, m.key);
    return { ...m, ...getSeriesPeakTrough(series, cube.periods) };
  }).sort((a, b) => b.volatilityRank - a.volatilityRank);

  const worst = items[0];
  if (!worst) return idleBlock(entry, "no items available");

  const ev = evaluate(worst.ratio, {
    rule: "Highest peak-to-trough ratio > 2.5x = RED; > 2.0x = AMBER",
    metric: `${worst.label} peak-to-trough ratio`,
    format: "ratio",
    bands: [
      { at: 2.0, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 2.5, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — ${worst.label} swings ${worst.ratioFormatted} between peak (${formatINR(worst.peak)}) and trough (${formatINR(worst.trough)})` : null,
    headline: makeHeadline({
      label: "Most volatile product",
      value: toNumber(worst.ratio, 2),
      unit: "x",
      formatted: `${worst.label} (${worst.ratioFormatted})`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Metric", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Product", value: worst.label },
        { metric: "Peak Month Revenue", value: formatINR(worst.peak) },
        { metric: "Peak Month", value: worst.peakPeriod },
        { metric: "Trough Month Revenue", value: formatINR(worst.trough) },
        { metric: "Trough Month", value: worst.troughPeriod },
        { metric: "Peak-to-Trough Ratio", value: `${worst.ratioFormatted}` },
        { metric: "Total Revenue Swing", value: formatINR(worst.gap) }
      ]
    }),
    narrative: `${worst.label} displays the highest volatility in the portfolio with a ${worst.ratioFormatted} swing between peak (${worst.peakPeriod}) and trough (${worst.troughPeriod}).`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L15.A03 — Most stable subcategory */
function mostStable(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  const items = members.map((m) => {
    const series = axis.series(cube, m.key);
    return { ...m, ...getSeriesPeakTrough(series, cube.periods) };
  }).sort((a, b) => a.volatilityRank - b.volatilityRank);

  const best = items[0];
  if (!best) return idleBlock(entry, "no items available");

  return makeBlock(entry, {
    status: STATUS.GREEN,
    severity: SEVERITY.LOW,
    priority: 5,
    trigger: { rule: "Smallest peak-to-trough ratio = Stability Benchmark", evaluated: `${best.label} ratio is ${best.ratioFormatted}`, fired: false },
    redFlag: null,
    headline: makeHeadline({
      label: "Most predictable product",
      value: toNumber(best.ratio, 2),
      unit: "x",
      formatted: `${best.label} (${best.ratioFormatted})`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Metric", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Product", value: best.label },
        { metric: "Peak Month Revenue", value: formatINR(best.peak) },
        { metric: "Trough Month Revenue", value: formatINR(best.trough) },
        { metric: "Peak-to-Trough Ratio", value: `${best.ratioFormatted}` },
        { metric: "Revenue Spread", value: formatINR(best.gap) }
      ]
    }),
    narrative: `${best.label} is the most predictable revenue contributor with a tight ${best.ratioFormatted} peak-to-trough range, making it the ideal baseline for operational planning.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L15.A04 — Average portfolio volatility */
function averageVolatility(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  // Members whose trough is zero have no ratio to average; they are reported
  // separately rather than folded in at some invented value.
  const ratios = members
    .map((m) => getSeriesPeakTrough(axis.series(cube, m.key), cube.periods))
    .filter((pt) => pt.ratio !== null)
    .map((pt) => pt.ratio);
  const collapsedCount = members.length - ratios.length;
  const sumRatio = ratios.reduce((a, r) => a.plus(r), new Decimal(0));
  const avgRatio = ratios.length > 0 ? sumRatio.dividedBy(ratios.length) : new Decimal(1);

  const ev = evaluate(avgRatio, {
    rule: "Portfolio average peak-to-trough ratio > 2.0x = RED; > 1.75x = AMBER",
    metric: "portfolio average peak-to-trough ratio",
    format: "ratio",
    bands: [
      { at: 1.75, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 2.0, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Portfolio average volatility is high at ${avgRatio.toFixed(2)}x` : null,
    headline: makeHeadline({
      label: "Portfolio average volatility",
      value: toNumber(avgRatio, 2),
      unit: "x",
      formatted: `${avgRatio.toFixed(2)}x`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Metric", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Average Peak-to-Trough Ratio", value: `${avgRatio.toFixed(2)}x` },
        { metric: "Products Assessed", value: String(members.length) },
        { metric: "Status", value: ev.status }
      ]
    }),
    narrative: `Across all ${members.length} products, average peak-to-trough volatility stands at ${avgRatio.toFixed(2)}x.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L15.A05 — Products with extreme volatility (>2.0x) */
function extremeVolatilityCount(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  // A member that fell to zero counts as extreme: it is the limiting case of
  // the very thing this measures, not an exception to it.
  const extreme = members.filter((m) => {
    const pt = getSeriesPeakTrough(axis.series(cube, m.key), cube.periods);
    return pt.collapsed || pt.ratio.greaterThanOrEqualTo(2.0);
  });

  const ev = evaluate(new Decimal(extreme.length), {
    rule: "2 or more products with Peak/Trough ratio >= 2.0 = RED; 1 product = AMBER",
    metric: "count of volatile products",
    format: "number",
    bands: [
      { at: 1, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 2, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — ${extreme.length} of ${members.length} products exhibit extreme peak-to-trough volatility (>=2.0x)` : null,
    headline: makeHeadline({
      label: "Volatile products count",
      value: extreme.length,
      formatted: `${extreme.length} of ${members.length} products`
    }),
    table: makeTable({
      columns: [
        { key: "product", label: "Product", format: FORMAT.TEXT },
        { key: "ratio", label: "Peak-to-Trough Ratio", format: FORMAT.RATIO },
        { key: "status", label: "Classification", format: FORMAT.STATUS }
      ],
      rows: members.map((m) => {
        const pt = getSeriesPeakTrough(axis.series(cube, m.key), cube.periods);
        const isExt = pt.collapsed || pt.ratio.greaterThanOrEqualTo(2.0);
        return {
          product: m.label,
          ratio: toNumber(pt.ratio, 2),
          status: isExt ? "Extreme (>=2.0x)" : "Stable (<2.0x)",
          _status: isExt ? STATUS.AMBER : STATUS.GREEN
        };
      })
    }),
    narrative: `${extreme.length} products cross the 2.0x volatility threshold, indicating erratic month-to-month demand patterns.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L15.A06 — Total revenue at risk from volatility gaps */
function revenueAtRiskGap(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  let totalGap = new Decimal(0);
  const rows = members.map((m) => {
    const pt = getSeriesPeakTrough(axis.series(cube, m.key), cube.periods);
    totalGap = totalGap.plus(pt.gap);
    return {
      product: m.label,
      peak: toNumber(pt.peak),
      trough: toNumber(pt.trough),
      gap: toNumber(pt.gap),
      _drill: drillFor(axis, m)
    };
  });

  rows.sort((a, b) => b.gap - a.gap);

  const ev = evaluate(totalGap, {
    rule: "Total peak-trough gap > ₹50,000 = RED; > ₹25,000 = AMBER",
    metric: "total peak-trough revenue gap",
    format: "currency",
    bands: [
      { at: 25000, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 50000, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Cumulative peak-to-trough revenue swing across products is ${formatINR(totalGap)}` : null,
    headline: makeHeadline({
      label: "Total revenue at risk (Peak - Trough)",
      value: toNumber(totalGap),
      formatted: formatINR(totalGap)
    }),
    table: makeTable({
      columns: [
        { key: "product", label: axis.label, format: FORMAT.TEXT },
        { key: "peak", label: "Peak Month (₹)", format: FORMAT.CURRENCY },
        { key: "trough", label: "Trough Month (₹)", format: FORMAT.CURRENCY },
        { key: "gap", label: "Revenue Swing (₹)", format: FORMAT.CURRENCY }
      ],
      rows,
      totalsRow: { product: "Total", peak: rows.reduce((s, r) => s + r.peak, 0), trough: rows.reduce((s, r) => s + r.trough, 0), gap: toNumber(totalGap) }
    }),
    narrative: `The total revenue gap between best and worst months sums to ${formatINR(totalGap)}. This represents the maximum swing in monthly demand.`,
    costOfInaction: makeCostOfInaction({
      amount: toNumber(totalGap.dividedBy(cube.periods.length)),
      formatted: `${formatINR(totalGap.dividedBy(cube.periods.length))}/mo`,
      basis: "monthly portfolio revenue swing",
      horizonMonths: 6
    }),
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L15.A07 — Peak month share of total annual revenue */
function peakMonthShare(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  const evaluations = [];
  const rows = members.map((m) => {
    const pt = getSeriesPeakTrough(axis.series(cube, m.key), cube.periods);
    const peakPct = pt.total.isPositive() ? pt.peak.dividedBy(pt.total) : new Decimal(0);
    const ev = evaluate(peakPct, {
      rule: "Peak month capturing > 12% of annual revenue = AMBER; > 15% = RED",
      metric: `${m.label} peak month share`,
      format: "percent",
      bands: [
        { at: 0.12, status: STATUS.AMBER, severity: "MEDIUM" },
        { at: 0.15, status: STATUS.RED, severity: "HIGH" }
      ]
    });
    evaluations.push(ev);
    return {
      product: m.label,
      totalRev: toNumber(pt.total),
      peakMonthRev: toNumber(pt.peak),
      peakMonthPct: toFraction(peakPct),
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const verdict = worstOf(evaluations, { noun: axis.noun });
  const highest = [...rows].sort((a, b) => b.peakMonthPct - a.peakMonthPct)[0];

  return makeBlock(entry, {
    status: verdict.status,
    severity: verdict.severity,
    priority: verdict.priority,
    trigger: { rule: verdict.rule, evaluated: verdict.evaluated, fired: verdict.fired },
    redFlag: highest && verdict.fired ? `RED FLAG — ${highest.product} generates ${(highest.peakMonthPct * 100).toFixed(1)}% of its total revenue in a single peak month` : null,
    headline: makeHeadline({
      label: "Highest peak month concentration",
      value: highest ? highest.peakMonthPct : 0,
      unit: "%",
      formatted: highest ? `${highest.product} (${(highest.peakMonthPct * 100).toFixed(1)}%)` : "None"
    }),
    table: makeTable({
      columns: [
        { key: "product", label: axis.label, format: FORMAT.TEXT },
        { key: "totalRev", label: "Total Revenue", format: FORMAT.CURRENCY },
        { key: "peakMonthRev", label: "Peak Month Revenue", format: FORMAT.CURRENCY },
        { key: "peakMonthPct", label: "Peak Month % of Total", format: FORMAT.PERCENT }
      ],
      rows
    }),
    narrative: highest && highest.peakMonthPct > 0.12
      ? `${highest.product} is heavily reliant on its single peak month (${(highest.peakMonthPct * 100).toFixed(1)}% of total revenue).`
      : `Revenue across products is evenly spread across the period without extreme single-month spikes.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L15.A08 — Trough revenue vs average revenue gap */
function troughVsAverageGap(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  const evaluations = [];
  const rows = members.map((m) => {
    const pt = getSeriesPeakTrough(axis.series(cube, m.key), cube.periods);
    const dropPct = pt.mean.isPositive() ? pt.mean.minus(pt.trough).dividedBy(pt.mean) : new Decimal(0);
    const ev = evaluate(dropPct, {
      rule: "Trough > 40% below average = AMBER; > 60% below average = RED",
      metric: `${m.label} trough drop from average`,
      format: "percent",
      bands: [
        { at: 0.40, status: STATUS.AMBER, severity: "MEDIUM" },
        { at: 0.60, status: STATUS.RED, severity: "HIGH" }
      ]
    });
    evaluations.push(ev);
    return {
      product: m.label,
      avgMonthlyRev: toNumber(pt.mean),
      troughRev: toNumber(pt.trough),
      dropFromAvgPct: toFraction(dropPct),
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const verdict = worstOf(evaluations, { noun: axis.noun });

  return makeBlock(entry, {
    status: verdict.status,
    severity: verdict.severity,
    priority: verdict.priority,
    trigger: { rule: verdict.rule, evaluated: verdict.evaluated, fired: verdict.fired },
    redFlag: verdict.fired ? `RED FLAG — At least one product drops >40% below its average monthly revenue during trough` : null,
    headline: makeHeadline({
      label: "Deepest trough vs average",
      value: rows.length ? Math.max(...rows.map((r) => r.dropFromAvgPct || 0)) : 0,
      unit: "%",
      formatted: rows.length ? `${(Math.max(...rows.map((r) => r.dropFromAvgPct || 0)) * 100).toFixed(1)}% below avg` : "None"
    }),
    table: makeTable({
      columns: [
        { key: "product", label: axis.label, format: FORMAT.TEXT },
        { key: "avgMonthlyRev", label: "Avg Monthly Revenue", format: FORMAT.CURRENCY },
        { key: "troughRev", label: "Trough Revenue", format: FORMAT.CURRENCY },
        { key: "dropFromAvgPct", label: "Drop from Average %", format: FORMAT.PERCENT }
      ],
      rows
    }),
    narrative: `Measures the severity of each product's low-water mark against its own normal baseline.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L15.A09 — Current revenue vs trough buffer */
function currentVsTroughBuffer(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  const evaluations = [];
  const rows = members.map((m) => {
    const pt = getSeriesPeakTrough(axis.series(cube, m.key), cube.periods);
    const bufferPct = pt.trough.isPositive() ? pt.current.minus(pt.trough).dividedBy(pt.trough) : new Decimal(0);
    const ev = evaluate(bufferPct, {
      rule: "Current revenue < 15% above trough = RED; < 30% above trough = AMBER",
      metric: `${m.label} buffer over trough`,
      format: "percent",
      reverse: true,
      bands: [
        { at: 0.30, status: STATUS.AMBER, severity: "MEDIUM" },
        { at: 0.15, status: STATUS.RED, severity: "HIGH" }
      ]
    });
    evaluations.push(ev);
    return {
      product: m.label,
      currentRev: toNumber(pt.current),
      troughRev: toNumber(pt.trough),
      bufferPct: toFraction(bufferPct),
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const verdict = worstOf(evaluations, { noun: axis.noun });

  return makeBlock(entry, {
    status: verdict.status,
    severity: verdict.severity,
    priority: verdict.priority,
    trigger: { rule: verdict.rule, evaluated: verdict.evaluated, fired: verdict.fired },
    redFlag: verdict.fired ? `RED FLAG — Key product is trading dangerously close to its historical trough` : null,
    headline: makeHeadline({
      label: "Smallest buffer over trough",
      value: rows.length ? Math.min(...rows.map((r) => r.bufferPct || 0)) : 0,
      unit: "%",
      formatted: rows.length ? `${(Math.min(...rows.map((r) => r.bufferPct || 0)) * 100).toFixed(1)}% buffer` : "None"
    }),
    table: makeTable({
      columns: [
        { key: "product", label: axis.label, format: FORMAT.TEXT },
        { key: "currentRev", label: "Current Revenue", format: FORMAT.CURRENCY },
        { key: "troughRev", label: "Trough Revenue", format: FORMAT.CURRENCY },
        { key: "bufferPct", label: "Buffer over Trough %", format: FORMAT.PERCENT }
      ],
      rows
    }),
    narrative: `Identifies how close current sales are to the all-time floor for each product line.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L15.A10 — Designed: Volatility-weighted revenue at risk */
function volatilityWeightedExposure(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  if (!members.length) return idleBlock(entry, "no items available");

  let totalVolWeightedRev = new Decimal(0);

  const rows = members.map((m) => {
    const pt = getSeriesPeakTrough(axis.series(cube, m.key), cube.periods);
    const weight = pt.ratio === null ? new Decimal(1) : pt.ratio.minus(1).dividedBy(pt.ratio.greaterThan(1) ? pt.ratio : 1);
    const volWeighted = pt.total.times(weight);
    totalVolWeightedRev = totalVolWeightedRev.plus(volWeighted);

    return {
      product: m.label,
      totalRev: toNumber(pt.total),
      peakToTroughRatio: toNumber(pt.ratio, 2),
      volWeightedRev: toNumber(volWeighted),
      _drill: drillFor(axis, m)
    };
  });

  rows.sort((a, b) => b.volWeightedRev - a.volWeightedRev);

  const ev = evaluate(totalVolWeightedRev, {
    rule: "Volatility-weighted revenue at risk > ₹5,00,000 = RED; > ₹2,50,000 = AMBER",
    metric: "volatility-weighted revenue at risk",
    format: "currency",
    bands: [
      { at: 250000, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 500000, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — ${formatINR(totalVolWeightedRev)} of revenue sits behind volatile products` : null,
    headline: makeHeadline({
      label: "Volatility-weighted revenue at risk",
      value: toNumber(totalVolWeightedRev),
      formatted: formatINR(totalVolWeightedRev)
    }),
    table: makeTable({
      columns: [
        { key: "product", label: axis.label, format: FORMAT.TEXT },
        { key: "totalRev", label: "Total Revenue", format: FORMAT.CURRENCY },
        { key: "peakToTroughRatio", label: "Peak/Trough Ratio", format: FORMAT.RATIO },
        { key: "volWeightedRev", label: "Vol-Weighted Exposure", format: FORMAT.CURRENCY }
      ],
      rows,
      totalsRow: { product: "Total", totalRev: rows.reduce((s, r) => s + r.totalRev, 0), peakToTroughRatio: 0, volWeightedRev: toNumber(totalVolWeightedRev) }
    }),
    narrative: `Weighting each product's revenue by its peak-to-trough swing highlights which products drive true uncertainty in cash flow.`,
    costOfInaction: makeCostOfInaction({
      amount: toNumber(totalVolWeightedRev.dividedBy(cube.periods.length)),
      formatted: `${formatINR(totalVolWeightedRev.dividedBy(cube.periods.length))}/mo`,
      basis: "volatility-weighted monthly exposure",
      horizonMonths: 6
    }),
    provenance: { periodsUsed: cube.periods.length, derived: true }
  });
}

/* ------------------------------------------------------------------ */
/* Lens 16 Builders: Month Peak & Trough / Timeline                   */
/* ------------------------------------------------------------------ */

/** L16.A01 & L16.A10 — Structural note / baseline month peak & trough overview */
function monthlyStructuralOverview(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const pt = getSeriesPeakTrough(series, cube.periods);
  const ratioNum = (pt.ratio && toNumber(pt.ratio) != null && Number.isFinite(toNumber(pt.ratio))) ? toNumber(pt.ratio) : 1;

  return makeBlock(entry, {
    // Informational, not unassessable. The no-data case returned IDLE above;
    // by here the overview has computed, and it simply has no threshold to
    // breach. IDLE would read to the owner as "we could not tell".
    status: STATUS.GREEN,
    severity: SEVERITY.LOW,
    priority: 4,
    trigger: { rule: "No threshold — structural overview", evaluated: "Informational overview of monthly peak and trough", fired: false },
    redFlag: null,
    headline: makeHeadline({
      label: "Monthly Company Peak vs Trough",
      value: ratioNum,
      unit: "x",
      formatted: `${ratioNum.toFixed(2)}x swing`
    }),
    table: makeTable({
      columns: [
        { key: "measure", label: "Measure", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { measure: "Peak Month Total", value: `${formatINR(pt.peak)} (${pt.peakPeriod})` },
        { measure: "Trough Month Total", value: `${formatINR(pt.trough)} (${pt.troughPeriod})` },
        { measure: "Monthly Swing Range", value: formatINR(pt.gap) },
        { measure: "Peak/Trough Ratio", value: `${ratioNum.toFixed(2)}x` }
      ]
    }),
    narrative: `Company revenue peaked in ${pt.peakPeriod} at ${formatINR(pt.peak)} and troughed in ${pt.troughPeriod} at ${formatINR(pt.trough)}.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L16.A02 — Monthly total revenue range */
function monthlyRevenueRange(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const pt = getSeriesPeakTrough(series, cube.periods);

  const ev = evaluate(pt.gap, {
    rule: "Monthly revenue range > ₹1,00,000 = RED; > ₹50,000 = AMBER",
    metric: "monthly revenue range (Peak - Trough)",
    format: "currency",
    bands: [
      { at: 50000, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 100000, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Company monthly revenue swings by ${formatINR(pt.gap)} between peak and trough` : null,
    headline: makeHeadline({
      label: "Monthly Revenue Range",
      value: toNumber(pt.gap),
      formatted: formatINR(pt.gap)
    }),
    table: makeTable({
      columns: [
        { key: "period", label: "Period", format: FORMAT.TEXT },
        { key: "revenue", label: "Company Revenue", format: FORMAT.CURRENCY },
        { key: "vsPeak", label: "Gap to Peak", format: FORMAT.CURRENCY }
      ],
      rows: cube.periods.map((p, idx) => ({
        period: p.label,
        revenue: toNumber(series[idx]),
        vsPeak: toNumber(pt.peak.minus(series[idx]))
      }))
    }),
    narrative: `The monthly company revenue varies from ${formatINR(pt.trough)} (${pt.troughPeriod}) to ${formatINR(pt.peak)} (${pt.peakPeriod}), a swing of ${formatINR(pt.gap)}.`,
    costOfInaction: makeCostOfInaction({
      amount: toNumber(pt.gap.dividedBy(cube.periods.length)),
      formatted: `${formatINR(pt.gap.dividedBy(cube.periods.length))}/mo`,
      basis: "monthly company variance swing",
      horizonMonths: 6
    }),
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L16.A03 — Company monthly revenue CV */
function companyMonthlyCv(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const cv = stats.cv(series) || new Decimal(0);

  const ev = evaluate(cv, {
    rule: "Company monthly CV > 20% = RED (Volatile); > 15% = AMBER (Moderate Volatility)",
    metric: "company monthly CV",
    format: "percent",
    bands: [
      { at: 0.15, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.20, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Company revenue CV of ${(toNumber(cv) * 100).toFixed(1)}% indicates volatile overall cash flows` : null,
    headline: makeHeadline({
      label: "Monthly Revenue CV",
      value: toFraction(cv),
      unit: "%",
      formatted: `${(toNumber(cv) * 100).toFixed(1)}%`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Metric", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Coefficient of Variation", value: `${(toNumber(cv) * 100).toFixed(1)}%` },
        { metric: "Monthly Std Deviation", value: formatINR(stats.stdDev(series) || 0) },
        { metric: "Monthly Mean Revenue", value: formatINR(stats.mean(series) || 0) }
      ]
    }),
    narrative: `The monthly Coefficient of Variation (CV) across ${cube.periods.length} periods is ${(toNumber(cv) * 100).toFixed(1)}%.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L16.A04 — Best vs worst month revenue multiple */
function monthlyBestVsWorstMultiple(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const pt = getSeriesPeakTrough(series, cube.periods);
  const ratioNum = (pt.ratio && toNumber(pt.ratio) != null && Number.isFinite(toNumber(pt.ratio))) ? toNumber(pt.ratio) : 1;

  const ev = evaluate(pt.ratio, {
    rule: "Peak-to-Trough multiple > 2.0x = RED; > 1.5x = AMBER",
    metric: "monthly best-to-worst multiple",
    format: "ratio",
    bands: [
      { at: 1.5, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 2.0, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Best month revenue is ${ratioNum.toFixed(2)}x the worst month revenue` : null,
    headline: makeHeadline({
      label: "Best vs worst month multiple",
      value: ratioNum,
      unit: "x",
      formatted: `${ratioNum.toFixed(2)}x`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Measure", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Peak Month Revenue", value: formatINR(pt.peak) },
        { metric: "Trough Month Revenue", value: formatINR(pt.trough) },
        { metric: "Multiple (Peak / Trough)", value: `${ratioNum.toFixed(2)}x` }
      ]
    }),
    narrative: `The best month (${pt.peakPeriod}) generated ${ratioNum.toFixed(2)}x the revenue of the lowest month (${pt.troughPeriod}).`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L16.A05 — Months below average revenue */
function monthsBelowAverage(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const mean = stats.mean(series) || new Decimal(0);
  const below = series.filter((val) => val.lessThan(mean));

  const ev = evaluate(new Decimal(below.length), {
    rule: "More than 70% of months below average = RED; > 55% = AMBER",
    metric: "months below average",
    format: "number",
    bands: [
      { at: Math.ceil(cube.periods.length * 0.55), status: STATUS.AMBER, severity: "MEDIUM" },
      { at: Math.ceil(cube.periods.length * 0.70), status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — ${below.length} of ${cube.periods.length} months fall below average revenue` : null,
    headline: makeHeadline({
      label: "Months below average",
      value: below.length,
      formatted: `${below.length} of ${cube.periods.length} months`
    }),
    table: makeTable({
      columns: [
        { key: "period", label: "Month", format: FORMAT.TEXT },
        { key: "revenue", label: "Revenue", format: FORMAT.CURRENCY },
        { key: "vsAvg", label: "vs Average", format: FORMAT.CURRENCY },
        { key: "status", label: "Status", format: FORMAT.STATUS }
      ],
      rows: cube.periods.map((p, idx) => {
        const val = series[idx];
        const isBelow = val.lessThan(mean);
        return {
          period: p.label,
          revenue: toNumber(val),
          vsAvg: toNumber(val.minus(mean)),
          status: isBelow ? "Below Average" : "Above Average",
          _status: isBelow ? STATUS.AMBER : STATUS.GREEN
        };
      })
    }),
    narrative: `${below.length} out of ${cube.periods.length} months fell below the mean monthly revenue of ${formatINR(mean)}.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L16.A06 — Monthly revenue trend strength (linear slope) */
function monthlyTrendStrength(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const slope = stats.linearSlope(series) || new Decimal(0);

  const ev = evaluate(slope, {
    rule: "Trend slope < -₹2,000/mo = RED; < -₹500/mo = AMBER",
    metric: "monthly trend slope",
    format: "currency",
    reverse: true,
    bands: [
      { at: -500, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: -2000, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Monthly revenue trend slope is declining at ${formatINR(slope.abs())}/month` : null,
    headline: makeHeadline({
      label: "Monthly Trend Slope",
      value: toNumber(slope),
      formatted: `${formatINR(slope)}/mo`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Measure", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Linear Trend Slope", value: `${formatINR(slope)}/month` },
        { metric: "13M Projected Trajectory", value: formatINR(slope.times(cube.periods.length)) },
        { metric: "Direction", value: slope.greaterThan(0) ? "Growing" : (slope.lessThan(0) ? "Declining" : "Flat") }
      ]
    }),
    narrative: `The statistical best-fit slope across ${cube.periods.length} months indicates a trend of ${formatINR(slope)} per month.`,
    costOfInaction: slope.isNegative()
      ? makeCostOfInaction({
        amount: toNumber(slope.abs()),
        formatted: `${formatINR(slope.abs())}/mo`,
        basis: "monthly rate of revenue decay",
        horizonMonths: 6
      })
      : null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L16.A07 — Monthly revenue predictability score (1 - CV) */
function monthlyPredictabilityScore(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const cv = stats.cv(series) || new Decimal(0);
  const predictability = Decimal.max(0, new Decimal(1).minus(cv));

  const ev = evaluate(predictability, {
    rule: "Predictability score < 0.70 = RED; < 0.85 = AMBER",
    metric: "revenue predictability score",
    format: "percent",
    reverse: true,
    bands: [
      { at: 0.85, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.70, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Monthly predictability score of ${(toNumber(predictability) * 100).toFixed(1)}% indicates high forecasting error` : null,
    headline: makeHeadline({
      label: "Predictability Score",
      value: toFraction(predictability),
      unit: "%",
      formatted: `${(toNumber(predictability) * 100).toFixed(1)}%`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Metric", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Predictability Score", value: `${(toNumber(predictability) * 100).toFixed(1)}%` },
        { metric: "Underlying CV", value: `${(toNumber(cv) * 100).toFixed(1)}%` },
        { metric: "Forecasting Reliability", value: ev.status === STATUS.GREEN ? "High" : (ev.status === STATUS.AMBER ? "Moderate" : "Low") }
      ]
    }),
    narrative: `Predictability score of ${(toNumber(predictability) * 100).toFixed(1)}% reflects overall revenue stability. Higher scores indicate reliable forecasting conditions.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L16.A08 — Revenue acceleration vs deceleration */
function revenueAcceleration(cube, entry, params) {
  if (cube.periods.length < 3) return idleBlock(entry, "need at least 3 periods to measure acceleration");

  const series = cube.companySeries();
  const n = series.length;
  const latestMoM = series[n - 1].minus(series[n - 2]);
  const priorMoM = series[n - 2].minus(series[n - 3]);
  const accel = latestMoM.minus(priorMoM);

  const ev = evaluate(accel, {
    rule: "Revenue deceleration < -₹10,000 = RED; < -₹2,000 = AMBER",
    metric: "revenue acceleration",
    format: "currency",
    reverse: true,
    bands: [
      { at: -2000, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: -10000, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Revenue momentum decelerating at ${formatINR(accel.abs())}` : null,
    headline: makeHeadline({
      label: "Revenue Acceleration",
      value: toNumber(accel),
      formatted: formatINR(accel)
    }),
    table: makeTable({
      columns: [
        { key: "measure", label: "Measure", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.CURRENCY }
      ],
      rows: [
        { measure: "Latest MoM Change", value: toNumber(latestMoM) },
        { measure: "Prior MoM Change", value: toNumber(priorMoM) },
        { measure: "Acceleration / Deceleration", value: toNumber(accel) }
      ]
    }),
    narrative: accel.greaterThan(0)
      ? `Revenue momentum is positive, accelerating by ${formatINR(accel)} compared to the prior period.`
      : `Revenue growth is decelerating by ${formatINR(accel.abs())} compared to the prior month.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L16.A09 — Peak month revenue concentration */
function peakMonthCompanyConcentration(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const pt = getSeriesPeakTrough(series, cube.periods);
  const total = cube.totals.total;
  const peakShare = total.isPositive() ? pt.peak.dividedBy(total) : new Decimal(0);

  const ev = evaluate(peakShare, {
    rule: "Peak month > 12% of total revenue = AMBER; > 15% = RED",
    metric: "peak month share of annual revenue",
    format: "percent",
    bands: [
      { at: 0.12, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.15, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Peak month captures ${(toNumber(peakShare) * 100).toFixed(1)}% of entire period revenue` : null,
    headline: makeHeadline({
      label: "Peak Month Share",
      value: toFraction(peakShare),
      unit: "%",
      formatted: `${(toNumber(peakShare) * 100).toFixed(1)}% (${pt.peakPeriod})`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Measure", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Peak Month", value: pt.peakPeriod },
        { metric: "Peak Month Revenue", value: formatINR(pt.peak) },
        { metric: "Total Period Revenue", value: formatINR(total) },
        { metric: "Share of Total", value: `${(toNumber(peakShare) * 100).toFixed(1)}%` }
      ]
    }),
    narrative: `The company's peak month was ${pt.peakPeriod}, capturing ${(toNumber(peakShare) * 100).toFixed(1)}% of total revenue for the period.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

module.exports = {
  family: FAMILY.VOLATILITY,
  // Lens 15
  peakTroughRegister,
  highestVolatility,
  mostStable,
  averageVolatility,
  extremeVolatilityCount,
  revenueAtRiskGap,
  peakMonthShare,
  troughVsAverageGap,
  currentVsTroughBuffer,
  volatilityWeightedExposure,
  // Lens 16
  monthlyStructuralOverview,
  monthlyRevenueRange,
  companyMonthlyCv,
  monthlyBestVsWorstMultiple,
  monthsBelowAverage,
  monthlyTrendStrength,
  monthlyPredictabilityScore,
  revenueAcceleration,
  peakMonthCompanyConcentration
};
