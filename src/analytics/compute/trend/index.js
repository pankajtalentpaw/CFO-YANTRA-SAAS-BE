/**
 * Trend builders.
 *
 * Each is written once against an axis descriptor and bound by the registry to
 * whichever axis a given analysis needs — "latest-month growth" is L01.A02 on
 * cities and L06.A05 on products with no duplicated maths. See engine/axes.js.
 *
 * Every builder returns a complete AnalysisBlock: a metric table, a headline,
 * an evaluated trigger, a named red flag, a cost of inaction and the forward
 * horizons. Narrative and actions fall through to the workbook's own text
 * unless the builder has something data-specific to say.
 */

const { STATUS, FAMILY, FORMAT, makeBlock, makeHeadline, makeTable, makeCostOfInaction } = require("../../models/analysisBlock");
const { evaluate, worstOf, redFlagText } = require("../../engine/triggerEvaluator");
const { resolveMembers, drillFor } = require("../../engine/axes");
const stats = require("../shared/stats");
const coi = require("../../prescriptive/costOfInaction");
const {
  toNumber, toFraction, formatINR, formatPercent, formatPP, formatNumber, share, ppDelta, Decimal
} = require("../shared/money");

/** Not enough of an axis to say anything — one member cannot be compared. */
function idleBlock(entry, reason, extra = {}) {
  return makeBlock(entry, {
    status: STATUS.IDLE,
    priority: 5,
    trigger: { rule: extra.rule || null, evaluated: reason, fired: false },
    provenance: { reason, ...extra.provenance }
  });
}

/** Members with a usable series, plus the axis metadata builders keep reaching for. */
function prepare(cube, params, { minMembers = 1, includeEmpty = false } = {}) {
  const axis = params.axis;
  const members = resolveMembers(cube, axis, { includeEmpty });
  return { axis, members, enough: members.length >= minMembers && cube.periods.length > 0 };
}

/** Assemble the block once the per-member rows and evaluations are known. */
function assemble(entry, { axis, rows, evaluations, offenders, headline, coiResult, horizonSeries, note, narrative, columns, provenance }) {
  const verdict = worstOf(evaluations, { noun: axis.noun });

  return makeBlock(entry, {
    status: verdict.status,
    severity: verdict.severity,
    priority: verdict.priority,
    trigger: { rule: verdict.rule, evaluated: verdict.evaluated, fired: verdict.fired },
    redFlag: redFlagText(offenders, { noun: axis.noun }),
    headline,
    table: makeTable({ columns, rows, note }),
    narrative,
    costOfInaction: coiResult
      ? makeCostOfInaction({
        amount: coiResult.amount,
        formatted: coiResult.amountFormatted,
        basis: coiResult.basis,
        horizonMonths: coiResult.horizonMonths
      })
      : null,
    horizon: horizonSeries
      ? (() => {
        const h = coi.horizons(horizonSeries);
        return {
          threeMonth: toNumber(h.threeMonth),
          threeMonthFormatted: h.threeMonthFormatted,
          sixMonth: toNumber(h.sixMonth),
          sixMonthFormatted: h.sixMonthFormatted,
          basis: h.basis
        };
      })()
      : null,
    provenance: {
      periodsUsed: axis ? undefined : undefined,
      ...provenance,
      assessed: verdict.assessedCount,
      fired: verdict.firedCount
    }
  });
}

/* ================================================================== */
/* A01 — Consecutive decline and trend momentum                        */
/* ================================================================== */

function declineStreak(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params);
  if (!enough) return idleBlock(entry, `No ${axis.noun} with revenue in this period`);

  const evaluations = [];
  const offenders = [];
  const coiParts = [];

  const rows = members.map((m) => {
    const streak = stats.declineStreak(m.series);
    const slope = stats.linearSlope(m.series);
    const memberCoi = coi.fromSeries(m.series);
    coiParts.push(memberCoi);

    const ev = evaluate(streak.longest, "DECLINE_STREAK", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: `${streak.longest}-month decline` });

    return {
      entity: m.label,
      revenue: toNumber(m.total),
      streak: streak.longest,
      slope: toNumber(slope),
      coi: toNumber(memberCoi.amount),
      flag: ev.status === STATUS.RED ? "RED — sustained decline"
        : ev.status === STATUS.AMBER ? `WATCH — ${streak.longest}-month decline`
          : "No sustained decline",
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const total = coi.aggregate(coiParts);
  const worstStreak = rows.reduce((a, b) => (b.streak > a.streak ? b : a), rows[0]);

  return assemble(entry, {
    axis,
    rows,
    evaluations,
    offenders,
    columns: [
      { key: "entity", label: axis.label, format: FORMAT.TEXT },
      { key: "revenue", label: "Total Revenue", format: FORMAT.CURRENCY },
      { key: "streak", label: "Longest Decline Streak", format: FORMAT.NUMBER },
      { key: "slope", label: "Trend (₹/month)", format: FORMAT.CURRENCY },
      { key: "coi", label: "Cost of Inaction (3mo)", format: FORMAT.CURRENCY },
      { key: "flag", label: "Red Flag", format: FORMAT.STATUS }
    ],
    headline: makeHeadline({
      label: `Longest decline streak (${worstStreak.entity})`,
      value: worstStreak.streak,
      formatted: `${worstStreak.streak} months`
    }),
    coiResult: total,
    horizonSeries: cube.companySeries(),
    narrative: buildStreakNarrative(offenders, axis, total),
    provenance: { periodsUsed: cube.periods.length, rowsConsidered: members.length }
  });
}

function buildStreakNarrative(offenders, axis, total) {
  if (!offenders.length) {
    return `No ${axis.noun} show a sustained multi-month decline. Revenue trajectories are stable on this measure.`;
  }
  const lead = offenders[0];
  const rest = offenders.length > 1 ? ` ${offenders.length - 1} other ${offenders.length === 2 ? "does" : "do"} the same.` : "";
  const money = total.amount ? ` Cost of inaction across all declining ${axis.noun}: ${total.amountFormatted} over 3 months, with ${total.opportunityFormatted} addressable over 6.` : "";
  return `${lead.name} shows the most severe sustained decline (${lead.metricFormatted}).${rest}${money}`;
}

/* ================================================================== */
/* A02 — Latest-month growth direction                                 */
/* ================================================================== */

function latestGrowth(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params);
  if (!enough || cube.periods.length < 2) return idleBlock(entry, "Need at least two periods to measure month-on-month growth");

  const evaluations = [];
  const offenders = [];

  const rows = members.map((m) => {
    const growth = stats.latestGrowth(m.series);
    // Normalised so higher is worse: a 10% fall becomes 0.10.
    const declineMetric = growth === null ? null : growth.negated();
    const ev = evaluate(declineMetric === null || declineMetric.isNegative() ? (declineMetric === null ? null : new Decimal(0)) : declineMetric,
      "LATEST_MOM_DECLINE", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: formatPercent(growth) });

    return {
      entity: m.label,
      revenue: toNumber(m.total),
      growth: toFraction(growth),
      direction: growth === null ? "No prior month" : growth.isZero() ? "Flat" : growth.isPositive() ? "Growing" : "Declining",
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const declining = rows.filter((r) => r.direction === "Declining");
  const worst = declining.sort((a, b) => (a.growth ?? 0) - (b.growth ?? 0))[0] || null;
  const latest = cube.periods[cube.periods.length - 1];

  return assemble(entry, {
    axis,
    rows,
    evaluations,
    offenders,
    columns: [
      { key: "entity", label: axis.label, format: FORMAT.TEXT },
      { key: "revenue", label: "Total Revenue", format: FORMAT.CURRENCY },
      { key: "growth", label: `MoM Growth (${latest.label})`, format: FORMAT.PERCENT },
      { key: "direction", label: "Direction", format: FORMAT.STATUS }
    ],
    headline: worst
      ? makeHeadline({ label: `Steepest latest-month fall (${worst.entity})`, value: worst.growth, formatted: formatPercent(worst.growth) })
      : makeHeadline({ label: "Latest month", value: null, formatted: `No ${axis.noun} declining` }),
    coiResult: null,
    horizonSeries: cube.companySeries(),
    narrative: declining.length
      ? `${declining.length} of ${rows.length} ${axis.noun} fell in ${latest.label}. This isolates the most recent single month, so a fall here may be a new event rather than a continuation — cross-check against the decline streak before acting.`
      : `Every ${axis.label.toLowerCase()} held or grew in ${latest.label}.`,
    provenance: { periodsUsed: cube.periods.length, rowsConsidered: members.length }
  });
}

/* ================================================================== */
/* A03 — Rolling momentum (last N vs prior N)                          */
/* ================================================================== */

function rollingMomentum(cube, entry, params) {
  const window = params.window || 3;
  const { axis, members, enough } = prepare(cube, params);
  if (!enough || cube.periods.length < window * 2) {
    return idleBlock(entry, `Need ${window * 2} periods to compare the last ${window} months against the prior ${window}`);
  }

  const evaluations = [];
  const offenders = [];

  const rows = members.map((m) => {
    const momentum = stats.rollingMomentum(m.series, window);
    const rate = momentum ? momentum.changeRate : null;
    const declineMetric = rate === null ? null : (rate.isNegative() ? rate.negated() : new Decimal(0));
    const ev = evaluate(declineMetric, "MOMENTUM_3M_DECLINE", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: formatPercent(rate) });

    return {
      entity: m.label,
      recent: toNumber(momentum && momentum.recentAvg),
      prior: toNumber(momentum && momentum.priorAvg),
      change: toFraction(rate),
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const decelerating = rows.filter((r) => r.change !== null && r.change < 0);
  const worstMomentum = rows
    .filter((r) => r.change !== null)
    .reduce((a, b) => (a === null || b.change < a.change ? b : a), null);

  return assemble(entry, {
    axis,
    rows,
    evaluations,
    offenders,
    columns: [
      { key: "entity", label: axis.label, format: FORMAT.TEXT },
      { key: "recent", label: `Last ${window}M Avg`, format: FORMAT.CURRENCY },
      { key: "prior", label: `Prior ${window}M Avg`, format: FORMAT.CURRENCY },
      { key: "change", label: "Change", format: FORMAT.PERCENT }
    ],
    headline: makeHeadline({
      label: worstMomentum
        ? `Weakest ${window}M momentum (${worstMomentum.entity})`
        : `${axis.noun} losing momentum`,
      value: worstMomentum ? worstMomentum.change : null,
      formatted: worstMomentum
        ? `${formatPercent(worstMomentum.change)} — ${decelerating.length} of ${rows.length} ${axis.noun} decelerating`
        : `${decelerating.length} of ${rows.length}`
    }),
    coiResult: null,
    horizonSeries: cube.companySeries(),
    narrative: `Rolling ${window}-month averages smooth out single-month noise. A ${axis.label.toLowerCase()} that is negative here has a genuine downward trajectory rather than one weak month.`,
    provenance: { periodsUsed: cube.periods.length, window, rowsConsidered: members.length }
  });
}

/* ================================================================== */
/* A04 — Peak-to-current gap                                           */
/* ================================================================== */

function peakGap(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params);
  if (!enough) return idleBlock(entry, `No ${axis.noun} with revenue in this period`);

  const evaluations = [];
  const offenders = [];
  let totalGap = new Decimal(0);

  const rows = members.map((m) => {
    const gap = stats.peakToCurrent(m.series);
    const rate = gap ? gap.gapRate : null;
    const declineMetric = rate === null ? null : (rate.isNegative() ? rate.negated() : new Decimal(0));
    const ev = evaluate(declineMetric, "PEAK_GAP", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: formatPercent(rate) });
    if (gap && gap.gap.isNegative()) totalGap = totalGap.plus(gap.gap.abs());

    const peakPeriod = gap ? cube.periods[gap.peakIndex] : null;
    return {
      entity: m.label,
      peak: toNumber(gap && gap.peak),
      peakMonth: peakPeriod ? peakPeriod.label : null,
      current: toNumber(gap && gap.current),
      gap: toNumber(gap && gap.gap),
      gapPct: toFraction(rate),
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  // gapRate is signed and negative below peak, so the deepest gap is the
  // smallest value. Reported as a rate rather than a rupee total: "40% below
  // its best month" is comparable across a portfolio in a way that a summed
  // shortfall across members is not.
  const deepest = rows
    .filter((r) => r.gapPct !== null)
    .reduce((a, b) => (a === null || b.gapPct < a.gapPct ? b : a), null);

  return assemble(entry, {
    axis,
    rows,
    evaluations,
    offenders,
    columns: [
      { key: "entity", label: axis.label, format: FORMAT.TEXT },
      { key: "peak", label: "Peak Revenue", format: FORMAT.CURRENCY },
      { key: "peakMonth", label: "Peak Month", format: FORMAT.MONTH },
      { key: "current", label: "Latest", format: FORMAT.CURRENCY },
      { key: "gap", label: "Gap", format: FORMAT.CURRENCY },
      { key: "gapPct", label: "Gap %", format: FORMAT.PERCENT }
    ],
    headline: makeHeadline({
      label: deepest
        ? `Furthest below its peak (${deepest.entity})`
        : "Total shortfall against historical peaks",
      value: deepest ? deepest.gapPct : null,
      formatted: deepest
        ? `${formatPercent(deepest.gapPct)} — ${formatINR(totalGap)} below peak across ${rows.length} ${axis.noun}`
        : formatINR(totalGap)
    }),
    coiResult: makeCoiFromAmount(totalGap, `Combined shortfall of every ${axis.label.toLowerCase()} against its own peak month`),
    horizonSeries: cube.companySeries(),
    narrative: offenders.length
      ? `The gap from peak measures unrealised potential. ${offenders[0].name} is furthest below its own best month (${offenders[0].metricFormatted}). A ${axis.label.toLowerCase()} far below peak either had a one-off spike or has genuinely declined — check the decline streak to tell them apart.`
      : `Every ${axis.label.toLowerCase()} is at or near its historical peak.`,
    provenance: { periodsUsed: cube.periods.length, rowsConsidered: members.length }
  });
}

/** COI for analyses whose recoverable amount is a gap rather than a trend. */
function makeCoiFromAmount(amount, basis) {
  const d = new Decimal(amount || 0);
  if (d.isZero()) return null;
  return { amount: d, amountFormatted: formatINR(d), basis, horizonMonths: 3 };
}

/* ================================================================== */
/* A05 — Revenue contribution shift                                    */
/* ================================================================== */

function shareShift(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params);
  if (!enough || cube.periods.length < 2) return idleBlock(entry, "Need at least two periods to measure a share shift");

  const firstKey = cube.periodKeys[0];
  const lastKey = cube.periodKeys[cube.periodKeys.length - 1];
  const firstTotal = cube.periodTotal(firstKey);
  const lastTotal = cube.periodTotal(lastKey);

  const evaluations = [];
  const offenders = [];

  const rows = members.map((m) => {
    const startShare = share(m.series[0], firstTotal);
    const endShare = share(m.series[m.series.length - 1], lastTotal);
    const shift = ppDelta(endShare, startShare);
    const lossMetric = shift === null ? null : (shift.isNegative() ? shift.negated() : new Decimal(0));

    const ev = evaluate(lossMetric, "SHARE_LOSS_PP", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: formatPP(shift) });

    return {
      entity: m.label,
      startShare: toFraction(startShare),
      endShare: toFraction(endShare),
      shift: toFraction(shift),
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const biggestMove = rows
    .filter((r) => r.shift !== null)
    .reduce((a, b) => (a === null || Math.abs(b.shift) > Math.abs(a.shift) ? b : a), null);

  const biggestLoser = rows
    .filter((r) => r.shift !== null && r.shift < 0)
    .sort((a, b) => a.shift - b.shift)[0] || null;

  return assemble(entry, {
    axis,
    rows,
    evaluations,
    offenders,
    columns: [
      { key: "entity", label: axis.label, format: FORMAT.TEXT },
      { key: "startShare", label: `${cube.periods[0].label} Share`, format: FORMAT.PERCENT },
      { key: "endShare", label: `${cube.periods[cube.periods.length - 1].label} Share`, format: FORMAT.PERCENT },
      { key: "shift", label: "Shift", format: FORMAT.PP }
    ],
    headline: biggestLoser
      ? makeHeadline({
        label: `Largest share move (${biggestMove.entity})`,
        value: Math.abs(biggestMove.shift),
        formatted: formatPP(biggestMove.shift),
        delta: biggestLoser ? biggestLoser.shift : null,
        deltaFormatted: biggestLoser ? `largest loss ${formatPP(biggestLoser.shift)} (${biggestLoser.entity})` : null
      })
      : makeHeadline({ label: "Share shift", value: null, formatted: "No share moved" }),
    coiResult: null,
    horizonSeries: cube.companySeries(),
    narrative: `Share shift separates a genuinely weakening ${axis.label.toLowerCase()} from one merely being outgrown. Losing both absolute revenue and share at once is the urgent case.`,
    provenance: { periodsUsed: cube.periods.length, rowsConsidered: members.length }
  });
}

/* ================================================================== */
/* A06 — Revenue stability (coefficient of variation)                  */
/* ================================================================== */

function volatilityCv(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params);
  if (!enough || cube.periods.length < 2) return idleBlock(entry, "Need at least two periods to measure volatility");

  const evaluations = [];
  const offenders = [];

  const rows = members.map((m) => {
    const cv = stats.coefficientOfVariation(m.series);
    const ev = evaluate(cv, "VOLATILITY_CV", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: formatPercent(cv) });

    return {
      entity: m.label,
      mean: toNumber(stats.mean(m.series)),
      stdDev: toNumber(stats.stdDev(m.series)),
      cv: toFraction(cv),
      flag: cv === null ? "Not assessed" : ev.fired ? (ev.status === STATUS.RED ? "HIGH VOLATILITY" : "MODERATE") : "STABLE",
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const mostVolatile = rows.filter((r) => r.cv !== null).sort((a, b) => b.cv - a.cv)[0] || null;

  return assemble(entry, {
    axis,
    rows,
    evaluations,
    offenders,
    columns: [
      { key: "entity", label: axis.label, format: FORMAT.TEXT },
      { key: "mean", label: "Mean Revenue", format: FORMAT.CURRENCY },
      { key: "stdDev", label: "Std Dev", format: FORMAT.CURRENCY },
      { key: "cv", label: "CV", format: FORMAT.PERCENT },
      { key: "flag", label: "Stability", format: FORMAT.STATUS }
    ],
    headline: mostVolatile
      ? makeHeadline({ label: `Most volatile (${mostVolatile.entity})`, value: mostVolatile.cv, formatted: formatPercent(mostVolatile.cv) })
      : makeHeadline({ label: "Volatility", value: null, formatted: "Not assessed" }),
    coiResult: null,
    horizonSeries: cube.companySeries(),
    narrative: `A high coefficient of variation means revenue swings widely month to month — from seasonality, erratic ordering, or a structural decline. Volatile ${axis.noun} make cash-flow planning unreliable and raise working-capital needs.`,
    provenance: { periodsUsed: cube.periods.length, rowsConsidered: members.length }
  });
}

/* ================================================================== */
/* A07 — Top-N dependency                                              */
/* ================================================================== */

function topNDependency(cube, entry, params) {
  const n = params.n || 2;
  const threshold = params.threshold || "TOP2_DEPENDENCY";
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2 });
  if (!enough) return idleBlock(entry, `Need at least two ${axis.noun} to measure dependency`);

  const totals = members.map((m) => m.total);
  const combined = stats.topNShare(totals, n);
  const top = members.slice(0, n);
  const grand = cube.totals.total;

  const ev = evaluate(combined, threshold);
  const topRevenue = top.reduce((a, m) => a.plus(m.total), new Decimal(0));

  const rows = members.map((m, i) => ({
    entity: m.label,
    revenue: toNumber(m.total),
    sharePct: toFraction(share(m.total, grand)),
    inTopN: i < n ? "Yes" : "No",
    _status: i < n ? ev.status : STATUS.GREEN,
    _drill: drillFor(axis, m)
  }));

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired
      ? `RED FLAG — the top ${n} ${axis.noun} (${top.map((m) => m.label).join(", ")}) carry ${ev.metricFormatted} of all revenue`
      : null,
    headline: makeHeadline({
      label: `Top ${n} ${axis.noun} share`,
      value: toFraction(combined),
      formatted: formatPercent(combined),
      delta: toNumber(topRevenue),
      deltaFormatted: formatINR(topRevenue)
    }),
    table: makeTable({
      columns: [
        { key: "entity", label: axis.label, format: FORMAT.TEXT },
        { key: "revenue", label: "Revenue", format: FORMAT.CURRENCY },
        { key: "sharePct", label: "Share of Total", format: FORMAT.PERCENT },
        { key: "inTopN", label: `In Top ${n}`, format: FORMAT.TEXT }
      ],
      rows
    }),
    narrative: ev.fired
      ? `With ${n} of ${members.length} ${axis.noun} carrying ${ev.metricFormatted} of revenue, the business is exposed to disruption in either one. This is structural dependency rather than a current problem — but it caps how much a single setback can be absorbed.`
      : `Revenue is spread widely enough that no ${n} ${axis.noun} dominate it.`,
    costOfInaction: null,
    horizon: null,
    provenance: { rowsConsidered: members.length, n }
  });
}

/* ================================================================== */
/* A08 — Linear trend slope                                            */
/* ================================================================== */

function trendSlope(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params);
  if (!enough || cube.periods.length < 2) return idleBlock(entry, "Need at least two periods to fit a trend");

  const evaluations = [];
  const offenders = [];
  const months = cube.periods.length;

  const rows = members.map((m) => {
    const slope = stats.linearSlope(m.series);
    const declineMetric = slope === null ? null : (slope.isNegative() ? slope.negated() : new Decimal(0));
    // Against this member's own average month, so a large city and a small one
     // are held to the same standard rather than the same rupee figure.
    const memberAverage = stats.mean(m.series);
    const slopeShare = declineMetric === null || memberAverage === null || memberAverage.isZero()
      ? null
      : declineMetric.dividedBy(memberAverage.abs());
    const ev = evaluate(slopeShare, "NEGATIVE_SLOPE", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: `${formatINR(slope)}/month` });

    return {
      entity: m.label,
      slope: toNumber(slope),
      projected: toNumber(slope === null ? null : slope.times(months)),
      direction: slope === null ? "Not assessed"
        : slope.isZero() ? "Flat"
          : slope.isPositive() ? "Upward" : ev.fired ? "Steep Decline" : "Declining",
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const steepest = rows.filter((r) => r.slope !== null).sort((a, b) => a.slope - b.slope)[0] || null;

  return assemble(entry, {
    axis,
    rows,
    evaluations,
    offenders,
    columns: [
      { key: "entity", label: axis.label, format: FORMAT.TEXT },
      { key: "slope", label: "Trend (₹/month)", format: FORMAT.CURRENCY },
      { key: "projected", label: `Projected over ${months}M`, format: FORMAT.CURRENCY },
      { key: "direction", label: "Direction", format: FORMAT.STATUS }
    ],
    headline: steepest
      ? makeHeadline({ label: `Steepest trend (${steepest.entity})`, value: steepest.slope, formatted: `${formatINR(steepest.slope)}/month` })
      : makeHeadline({ label: "Trend", value: null, formatted: "Not assessed" }),
    coiResult: null,
    horizonSeries: cube.companySeries(),
    narrative: `The slope is the mathematical direction over all ${months} periods, immune to any single month. It is the cleanest read on where a ${axis.label.toLowerCase()} is actually heading.`,
    provenance: { periodsUsed: months, rowsConsidered: members.length }
  });
}

/* ================================================================== */
/* A09 — Company-level revenue trend                                   */
/* ================================================================== */

function companyTrend(cube, entry) {
  if (cube.periods.length < 2) return idleBlock(entry, "Need at least two periods to measure a company trend");

  const series = cube.companySeries();
  const first = series[0];
  const last = series[series.length - 1];
  const change = last.minus(first);
  const rate = first.isZero() ? null : change.dividedBy(first.abs());
  const declineMetric = rate === null ? null : (rate.isNegative() ? rate.negated() : new Decimal(0));

  const ev = evaluate(declineMetric, "COMPANY_DECLINE");
  const companyCoi = coi.fromChange(change);
  const streak = stats.declineStreak(series);
  const slope = stats.linearSlope(series);

  const rows = cube.periods.map((p, i) => ({
    month: p.label,
    revenue: toNumber(series[i]),
    mom: i === 0 ? null : toFraction(first.isZero() && i === 0 ? null : (series[i - 1].isZero() ? null : series[i].minus(series[i - 1]).dividedBy(series[i - 1].abs()))),
    _status: i > 0 && series[i].lessThan(series[i - 1]) ? STATUS.AMBER : STATUS.GREEN,
    _drill: { type: "month", name: p.label }
  }));

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — company revenue fell ${formatPercent(rate)} from ${cube.periods[0].label} to ${cube.periods[cube.periods.length - 1].label}` : null,
    headline: makeHeadline({
      label: `Company revenue, ${cube.periods[0].label} to ${cube.periods[cube.periods.length - 1].label}`,
      value: toNumber(change),
      formatted: formatINR(change, { sign: true }),
      delta: toFraction(rate),
      deltaFormatted: formatPercent(rate, { sign: true })
    }),
    table: makeTable({
      columns: [
        { key: "month", label: "Month", format: FORMAT.MONTH },
        { key: "revenue", label: "Company Revenue", format: FORMAT.CURRENCY },
        { key: "mom", label: "MoM", format: FORMAT.PERCENT }
      ],
      rows
    }),
    narrative: `Company revenue moved ${formatINR(change, { sign: true })} (${formatPercent(rate, { sign: true })}) across the window, on a trend of ${formatINR(slope)}/month. The longest unbroken company-level decline was ${streak.longest} month${streak.longest === 1 ? "" : "s"}.`,
    costOfInaction: companyCoi.isDeclining
      ? makeCostOfInaction({ amount: companyCoi.amount, formatted: companyCoi.amountFormatted, basis: companyCoi.basis, horizonMonths: 3 })
      : null,
    horizon: (() => {
      const h = coi.horizons(series);
      return {
        threeMonth: toNumber(h.threeMonth),
        threeMonthFormatted: h.threeMonthFormatted,
        sixMonth: toNumber(h.sixMonth),
        sixMonthFormatted: h.sixMonthFormatted,
        basis: h.basis
      };
    })(),
    provenance: { periodsUsed: cube.periods.length }
  });
}

/* ================================================================== */
/* A10 — Growth vs decline balance                                     */
/* ================================================================== */

function growthDeclineBalance(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params);
  if (!enough || cube.periods.length < 2) return idleBlock(entry, `Not enough data to judge ${axis.noun} direction`);

  const balance = stats.growthDeclineBalance(members.map((m) => m.series));
  const decliningShare = balance.total ? new Decimal(balance.declining).dividedBy(balance.total) : null;
  const ev = evaluate(decliningShare, "DECLINING_SHARE_OF_ENTITIES");

  let decliningRevenue = new Decimal(0);
  const rows = members.map((m) => {
    const slope = stats.linearSlope(m.series);
    const direction = slope === null || slope.isZero() ? "Flat" : slope.isPositive() ? "Growing" : "Declining";
    if (direction === "Declining") decliningRevenue = decliningRevenue.plus(m.total);

    return {
      entity: m.label,
      revenue: toNumber(m.total),
      sharePct: toFraction(share(m.total, cube.totals.total)),
      direction,
      _status: direction === "Declining" ? STATUS.AMBER : STATUS.GREEN,
      _drill: drillFor(axis, m)
    };
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired
      ? `RED FLAG — ${balance.declining} of ${balance.total} ${axis.noun} are on a declining trend, covering ${formatINR(decliningRevenue)} of revenue`
      : null,
    headline: makeHeadline({
      label: `${axis.label} direction`,
      value: balance.growing,
      formatted: `${balance.growing} growing, ${balance.declining} declining`
    }),
    table: makeTable({
      columns: [
        { key: "entity", label: axis.label, format: FORMAT.TEXT },
        { key: "revenue", label: "Revenue", format: FORMAT.CURRENCY },
        { key: "sharePct", label: "Share of Total", format: FORMAT.PERCENT },
        { key: "direction", label: "Trend Direction", format: FORMAT.STATUS }
      ],
      rows,
      note: `${formatINR(decliningRevenue)} of revenue sits with ${axis.noun} on a declining trend.`
    }),
    narrative: balance.declining > balance.growing
      ? `More ${axis.noun} are shrinking than growing. The concern is not the count but the revenue behind it: ${formatINR(decliningRevenue)} is attached to declining ${axis.noun}.`
      : `Growth is spread across ${balance.growing} of ${balance.total} ${axis.noun}, which limits how much any single reversal can hurt.`,
    costOfInaction: null,
    horizon: null,
    provenance: { periodsUsed: cube.periods.length, rowsConsidered: members.length, balance }
  });
}

/* ================================================================== */
/* Lens 5 & L06.A10 Builders                                          */
/* ================================================================== */

/** L05.A02 — Monthly revenue concentration index */
function monthlyConcentrationIndex(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const total = cube.totals.total;
  let maxMonthVal = series[0] || new Decimal(0);
  let minMonthVal = series[0] || new Decimal(0);
  let maxPeriod = cube.periods[0]?.label || "P1";

  const rows = cube.periods.map((p, idx) => {
    const rev = series[idx];
    if (rev.greaterThan(maxMonthVal)) {
      maxMonthVal = rev;
      maxPeriod = p.label;
    }
    if (rev.lessThan(minMonthVal)) {
      minMonthVal = rev;
    }
    const sh = total.isPositive() ? rev.dividedBy(total) : new Decimal(0);
    return {
      month: p.label,
      companyTotal: toNumber(rev),
      shareOfAnnual: toFraction(sh)
    };
  });

  const maxShare = total.isPositive() ? maxMonthVal.dividedBy(total) : new Decimal(0);
  const ratio = minMonthVal.isPositive() ? maxMonthVal.dividedBy(minMonthVal) : (maxMonthVal.isPositive() ? new Decimal(99) : new Decimal(1));
  const ratioNum = toNumber(ratio) != null ? toNumber(ratio) : 1;

  const ev = evaluate(ratio, {
    rule: "Best-to-worst month ratio > 1.5x = AMBER; > 2.0x = RED",
    metric: "monthly concentration ratio",
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
    redFlag: ev.fired ? `RED FLAG — Monthly revenue concentration is high (${ratioNum.toFixed(2)}x peak-to-trough)` : null,
    headline: makeHeadline({
      label: "Best to worst month ratio",
      value: ratioNum,
      unit: "x",
      formatted: `${ratioNum.toFixed(2)}x (${maxPeriod} peak)`
    }),
    table: makeTable({
      columns: [
        { key: "month", label: "Month", format: FORMAT.TEXT },
        { key: "companyTotal", label: "Company Total", format: FORMAT.CURRENCY },
        { key: "shareOfAnnual", label: "Share of Annual", format: FORMAT.PERCENT }
      ],
      rows
    }),
    narrative: `Monthly revenue distribution across ${cube.periods.length} months. Peak month (${maxPeriod}) accounts for ${(toNumber(maxShare) * 100).toFixed(1)}% of annual total.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A03 — Revenue front-loading vs back-loading test (H1 vs H2) */
function frontVsBackLoading(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const half = Math.ceil(series.length / 2);
  let h1Total = new Decimal(0);
  let h2Total = new Decimal(0);

  series.forEach((val, idx) => {
    if (idx < half) h1Total = h1Total.plus(val);
    else h2Total = h2Total.plus(val);
  });

  const h1Count = half;
  const h2Count = series.length - half;
  const h1Avg = h1Count > 0 ? h1Total.dividedBy(h1Count) : new Decimal(0);
  const h2Avg = h2Count > 0 ? h2Total.dividedBy(h2Count) : new Decimal(0);
  const diffPct = h1Avg.isPositive() ? h2Avg.minus(h1Avg).dividedBy(h1Avg) : new Decimal(0);

  const ev = evaluate(diffPct, {
    rule: "Second-half monthly average < -5% vs first-half = AMBER; < -15% = RED",
    metric: "H2 vs H1 average growth",
    format: "percent",
    reverse: true,
    bands: [
      { at: -0.05, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: -0.15, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Business is back-loaded downward: H2 monthly run-rate is ${(diffPct.abs().toNumber() * 100).toFixed(1)}% below H1` : null,
    headline: makeHeadline({
      label: "H2 vs H1 Run Rate",
      value: toFraction(diffPct),
      unit: "%",
      formatted: `${(toNumber(diffPct) * 100).toFixed(1)}%`
    }),
    table: makeTable({
      columns: [
        { key: "period", label: "Period", format: FORMAT.TEXT },
        { key: "totalRevenue", label: "Total Revenue (₹)", format: FORMAT.CURRENCY },
        { key: "avgMonthly", label: "Monthly Average (₹)", format: FORMAT.CURRENCY },
        { key: "share", label: "Share of Total", format: FORMAT.PERCENT }
      ],
      rows: [
        { period: `First Half (P1-P${h1Count})`, totalRevenue: toNumber(h1Total), avgMonthly: toNumber(h1Avg), share: toFraction(share(h1Total, cube.totals.total)) },
        { period: `Second Half (P${h1Count + 1}-P${series.length})`, totalRevenue: toNumber(h2Total), avgMonthly: toNumber(h2Avg), share: toFraction(share(h2Total, cube.totals.total)) }
      ]
    }),
    narrative: diffPct.isNegative()
      ? `Second-half monthly average (${formatINR(h2Avg)}) is lower than first-half (${formatINR(h1Avg)}), indicating losing momentum over the period.`
      : `Second-half monthly average (${formatINR(h2Avg)}) is maintaining or exceeding first-half performance (${formatINR(h1Avg)}).`,
    costOfInaction: diffPct.isNegative()
      ? makeCostOfInaction({
        amount: toNumber(h1Avg.minus(h2Avg)),
        formatted: `${formatINR(h1Avg.minus(h2Avg))}/mo`,
        basis: "H1 vs H2 run-rate deficit",
        horizonMonths: 6
      })
      : null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A04 — City monthly volatility comparison */
function cityMonthlyVolatility(cube, entry, params) {
  const axis = params.axis || { noun: "cities", label: "City", series: (c, k) => c.citySeries(k), members: (c) => c.cities.map(k => ({ key: k, label: k })) };
  const members = axis.members(cube);
  if (!members.length || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const evaluations = [];
  const rows = members.map((m) => {
    const s = axis.series(cube, m.key);
    const mean = stats.mean(s) || new Decimal(0);
    const sd = stats.stdDev(s) || new Decimal(0);
    const cv = stats.cv(s) || new Decimal(0);
    const ev = evaluate(cv, {
      rule: "City CV > 20% = AMBER; > 30% = RED",
      metric: `${m.label} monthly CV`,
      format: "percent",
      bands: [
        { at: 0.20, status: STATUS.AMBER, severity: "MEDIUM" },
        { at: 0.30, status: STATUS.RED, severity: "HIGH" }
      ]
    });
    evaluations.push(ev);
    return {
      city: m.label,
      meanRev: toNumber(mean),
      stdDev: toNumber(sd),
      cv: toFraction(cv),
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  rows.sort((a, b) => b.cv - a.cv);
  const verdict = worstOf(evaluations, { noun: axis.noun });
  const worst = rows[0];

  return makeBlock(entry, {
    status: verdict.status,
    severity: verdict.severity,
    priority: verdict.priority,
    trigger: { rule: verdict.rule, evaluated: verdict.evaluated, fired: verdict.fired },
    redFlag: worst && verdict.fired ? `RED FLAG — ${worst.city} has high monthly volatility (CV: ${(worst.cv * 100).toFixed(1)}%)` : null,
    headline: makeHeadline({
      label: "Highest City Volatility",
      value: worst ? worst.cv : 0,
      unit: "%",
      formatted: worst ? `${worst.city} (${(worst.cv * 100).toFixed(1)}%)` : "None"
    }),
    table: makeTable({
      columns: [
        { key: "city", label: "City", format: FORMAT.TEXT },
        { key: "meanRev", label: "Mean Revenue (₹)", format: FORMAT.CURRENCY },
        { key: "stdDev", label: "Std Deviation (₹)", format: FORMAT.CURRENCY },
        { key: "cv", label: "CV (Volatility Index)", format: FORMAT.PERCENT }
      ],
      rows
    }),
    narrative: `City month-to-month volatility comparison. Higher CV creates forecasting and resource allocation risks.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A05 — Best vs worst month revenue gap (latest vs average) */
function bestVsWorstGap(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  const mean = stats.mean(series) || new Decimal(0);
  const latest = series[series.length - 1] || new Decimal(0);
  const gapPct = mean.isPositive() ? latest.minus(mean).dividedBy(mean) : new Decimal(0);

  const ev = evaluate(gapPct, {
    rule: "Latest month > 10% below average = AMBER; > 20% below = RED",
    metric: "latest month vs average",
    format: "percent",
    reverse: true,
    bands: [
      { at: -0.10, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: -0.20, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Latest month revenue (${formatINR(latest)}) is ${(gapPct.abs().toNumber() * 100).toFixed(1)}% below the 13-month average` : null,
    headline: makeHeadline({
      label: "Latest month vs Average",
      value: toFraction(gapPct),
      unit: "%",
      formatted: `${(toNumber(gapPct) * 100).toFixed(1)}%`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Measure", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Latest Month Revenue", value: formatINR(latest) },
        { metric: "13-Month Average Revenue", value: formatINR(mean) },
        { metric: "Variance to Average", value: `${(toNumber(gapPct) * 100).toFixed(1)}%` }
      ]
    }),
    narrative: gapPct.isNegative()
      ? `The latest month is underperforming the historical average by ${(gapPct.abs().toNumber() * 100).toFixed(1)}%.`
      : `The latest month is performing at or above the historical average (+${(toNumber(gapPct) * 100).toFixed(1)}%).`,
    costOfInaction: gapPct.isNegative()
      ? makeCostOfInaction({
        amount: toNumber(mean.minus(latest)),
        formatted: `${formatINR(mean.minus(latest))}/mo`,
        basis: "monthly gap to baseline",
        horizonMonths: 6
      })
      : null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A06 — Recent 3-month share of annual revenue */
function proportionalShare3M(cube, entry, params) {
  if (cube.periods.length < 3) return idleBlock(entry, "need at least 3 periods");

  const series = cube.companySeries();
  const n = series.length;
  const last3Total = series.slice(n - 3).reduce((sum, v) => sum.plus(v), new Decimal(0));
  const total = cube.totals.total;
  const actualShare = total.isPositive() ? last3Total.dividedBy(total) : new Decimal(0);
  const expectedShare = new Decimal(3).dividedBy(n);
  const deltaPP = actualShare.minus(expectedShare);

  const ev = evaluate(deltaPP, {
    rule: "Latest 3M share < expected by 3pp = AMBER; by 6pp = RED",
    metric: "latest 3M share vs proportional benchmark",
    format: "percent",
    reverse: true,
    bands: [
      { at: -0.03, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: -0.06, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Latest 3 months delivered only ${(toNumber(actualShare) * 100).toFixed(1)}% of revenue (benchmark: ${(toNumber(expectedShare) * 100).toFixed(1)}%)` : null,
    headline: makeHeadline({
      label: "Latest 3M Share",
      value: toFraction(actualShare),
      unit: "%",
      formatted: `${(toNumber(actualShare) * 100).toFixed(1)}% (Exp: ${(toNumber(expectedShare) * 100).toFixed(1)}%)`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Metric", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Latest 3M Revenue", value: formatINR(last3Total) },
        { metric: "Latest 3M Share of Total", value: `${(toNumber(actualShare) * 100).toFixed(1)}%` },
        { metric: "Proportional Benchmark (3/N)", value: `${(toNumber(expectedShare) * 100).toFixed(1)}%` },
        { metric: "Variance (Percentage Points)", value: `${(toNumber(deltaPP) * 100).toFixed(1)} pp` }
      ]
    }),
    narrative: deltaPP.isNegative()
      ? `The latest 3 months contributed less than their proportional share of annual revenue, confirming recent deceleration.`
      : `The latest 3 months contributed at or above their expected share of revenue.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A07 — Month-over-Month growth consistency */
function momConsistency(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  let positiveCount = 0;
  let negativeCount = 0;
  let consecutiveDecline = 0;
  let maxConsecutiveDecline = 0;

  for (let i = 1; i < series.length; i++) {
    const diff = series[i].minus(series[i - 1]);
    if (diff.greaterThan(0)) {
      positiveCount++;
      consecutiveDecline = 0;
    } else if (diff.lessThan(0)) {
      negativeCount++;
      consecutiveDecline++;
      if (consecutiveDecline > maxConsecutiveDecline) maxConsecutiveDecline = consecutiveDecline;
    }
  }

  const transitions = series.length - 1;
  const posPct = transitions > 0 ? new Decimal(positiveCount).dividedBy(transitions) : new Decimal(0);

  const ev = evaluate(posPct, {
    rule: "Less than 50% positive MoM transitions = AMBER; < 35% or >=2 consecutive declines = RED",
    metric: "positive MoM transition percentage",
    format: "percent",
    reverse: true,
    bands: [
      { at: 0.50, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.35, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Revenue fell in ${negativeCount} of ${transitions} month-over-month steps (longest streak: ${maxConsecutiveDecline} months)` : null,
    headline: makeHeadline({
      label: "Growth Consistency",
      value: toFraction(posPct),
      unit: "%",
      formatted: `${positiveCount} / ${transitions} months grew (${(toNumber(posPct) * 100).toFixed(0)}%)`
    }),
    table: makeTable({
      columns: [
        { key: "measure", label: "Measure", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { measure: "Positive Transitions", value: String(positiveCount) },
        { measure: "Negative Transitions", value: String(negativeCount) },
        { measure: "Longest Consecutive Decline Streak", value: `${maxConsecutiveDecline} months` },
        { measure: "Growth Consistency %", value: `${(toNumber(posPct) * 100).toFixed(1)}%` }
      ]
    }),
    narrative: `${positiveCount} of ${transitions} month-to-month transitions showed revenue growth.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A08 — City revenue rank stability over time */
function cityRankStability(cube, entry, params) {
  if (cube.periods.length < 2 || !cube.cities.length) return idleBlock(entry, "need at least 2 periods and cities");

  const firstPeriodKey = cube.periodKeys[0];
  const lastPeriodKey = cube.periodKeys[cube.periodKeys.length - 1];

  const firstRanks = cube.cities.map((c) => ({ city: c, rev: cube.cityPeriodRevenue(c, firstPeriodKey) }))
    .sort((a, b) => b.rev.comparedTo(a.rev))
    .map((item, idx) => ({ city: item.city, rank: idx + 1 }));

  const lastRanks = cube.cities.map((c) => ({ city: c, rev: cube.cityPeriodRevenue(c, lastPeriodKey) }))
    .sort((a, b) => b.rev.comparedTo(a.rev))
    .map((item, idx) => ({ city: item.city, rank: idx + 1 }));

  const firstMap = new Map(firstRanks.map(r => [r.city, r.rank]));
  const lastMap = new Map(lastRanks.map(r => [r.city, r.rank]));

  let maxDrop = 0;
  const rows = cube.cities.map((c) => {
    const r1 = firstMap.get(c) || 0;
    const r2 = lastMap.get(c) || 0;
    const change = r1 - r2; // positive means improved rank, negative means dropped
    if (r2 - r1 > maxDrop) maxDrop = r2 - r1;
    return {
      city: c,
      rankFirst: r1,
      rankLatest: r2,
      rankChange: change === 0 ? "No Change" : (change > 0 ? `+${change}` : `${change}`),
      _status: change < 0 ? STATUS.AMBER : STATUS.GREEN
    };
  });

  const ev = evaluate(new Decimal(maxDrop), {
    rule: "City rank drop >= 2 positions = RED; 1 position = AMBER",
    metric: "max city rank drop",
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
    redFlag: ev.fired ? `RED FLAG — Structural shift in city rankings detected over time` : null,
    headline: makeHeadline({
      label: "City Rank Stability",
      value: maxDrop,
      formatted: maxDrop > 0 ? `Max drop: ${maxDrop} pos` : "Stable rankings"
    }),
    table: makeTable({
      columns: [
        { key: "city", label: "City", format: FORMAT.TEXT },
        { key: "rankFirst", label: `Rank in ${cube.periods[0].label}`, format: FORMAT.NUMBER },
        { key: "rankLatest", label: `Rank in ${cube.periods[cube.periods.length - 1].label}`, format: FORMAT.NUMBER },
        { key: "rankChange", label: "Rank Change", format: FORMAT.TEXT }
      ],
      rows
    }),
    narrative: `Tracks relative performance shifts across territories between the beginning and end of the period.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A09 — Quarterly revenue trajectory */
function quarterlyTrajectory(cube, entry, params) {
  if (cube.periods.length < 3) return idleBlock(entry, "need at least 3 periods");

  const series = cube.companySeries();
  const quarters = [];
  for (let i = 0; i < series.length; i += 3) {
    const chunk = series.slice(i, i + 3);
    const qRev = chunk.reduce((sum, v) => sum.plus(v), new Decimal(0));
    const qNum = Math.floor(i / 3) + 1;
    quarters.push({ quarter: `Q${qNum} (${cube.periods[i].label} - ${cube.periods[Math.min(i + 2, series.length - 1)].label})`, revenue: qRev });
  }

  let decliningQuarters = 0;
  const rows = quarters.map((q, idx) => {
    let qoqChange = null;
    let qoqChangeFormatted = "Baseline";
    if (idx > 0) {
      const prior = quarters[idx - 1].revenue;
      if (prior.isPositive()) {
        const diff = q.revenue.minus(prior).dividedBy(prior);
        qoqChange = toFraction(diff);
        qoqChangeFormatted = `${(toNumber(diff) * 100).toFixed(1)}%`;
        if (diff.isNegative()) decliningQuarters++;
      }
    }
    return {
      quarter: q.quarter,
      revenue: toNumber(q.revenue),
      qoqChange: qoqChangeFormatted,
      _status: qoqChange !== null && qoqChange < 0 ? STATUS.AMBER : STATUS.GREEN
    };
  });

  const ev = evaluate(new Decimal(decliningQuarters), {
    rule: "2 or more declining quarters = RED; 1 declining quarter = AMBER",
    metric: "declining quarters count",
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
    redFlag: ev.fired ? `RED FLAG — ${decliningQuarters} quarter-over-quarter declines detected` : null,
    headline: makeHeadline({
      label: "Quarterly Trend",
      value: decliningQuarters,
      formatted: decliningQuarters > 0 ? `${decliningQuarters} declining quarters` : "Positive QoQ trajectory"
    }),
    table: makeTable({
      columns: [
        { key: "quarter", label: "Quarter", format: FORMAT.TEXT },
        { key: "revenue", label: "Revenue (₹)", format: FORMAT.CURRENCY },
        { key: "qoqChange", label: "QoQ Change", format: FORMAT.TEXT }
      ],
      rows
    }),
    narrative: `Aggregating monthly data into quarters smooths out seasonal blips and isolates structural trend direction.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A10 — Cross-city revenue synchronisation */
function crossCitySync(cube, entry, params) {
  if (cube.periods.length < 3 || cube.cities.length < 2) return idleBlock(entry, "need at least 3 periods and 2 cities");

  const lastKey = cube.periodKeys[cube.periodKeys.length - 1];
  const priorKey = cube.periodKeys[cube.periodKeys.length - 2];
  const prior2Key = cube.periodKeys[cube.periodKeys.length - 3];

  let growingCount = 0;
  let decliningCount = 0;

  const rows = cube.cities.map((c) => {
    const revLatest = cube.cityPeriodRevenue(c, lastKey);
    const revPrior = cube.cityPeriodRevenue(c, priorKey);
    const revPrior2 = cube.cityPeriodRevenue(c, prior2Key);

    const latestDiff = revLatest.minus(revPrior);
    const priorDiff = revPrior.minus(revPrior2);

    const latestDir = latestDiff.greaterThan(0) ? "Growing" : (latestDiff.lessThan(0) ? "Declining" : "Flat");
    const priorDir = priorDiff.greaterThan(0) ? "Growing" : (priorDiff.lessThan(0) ? "Declining" : "Flat");

    if (latestDir === "Growing") growingCount++;
    if (latestDir === "Declining") decliningCount++;

    return {
      city: c,
      latestMomDir: latestDir,
      priorMomDir: priorDir,
      diverging: latestDir !== priorDir ? "Yes" : "No",
      _status: latestDir === "Declining" ? STATUS.AMBER : STATUS.GREEN
    };
  });

  const isDiverging = growingCount > 0 && decliningCount > 0;
  const ev = evaluate(isDiverging ? new Decimal(1) : new Decimal(0), {
    rule: "Cities moving in conflicting directions = AMBER",
    metric: "city divergence flag",
    format: "number",
    bands: [
      { at: 1, status: STATUS.AMBER, severity: "MEDIUM" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: isDiverging ? "Divergence detected across city trajectories" : "All cities moving in unison", fired: isDiverging },
    redFlag: isDiverging ? `AMBER — City revenue trends are diverging (${growingCount} growing vs ${decliningCount} declining)` : null,
    headline: makeHeadline({
      label: "Cross-City Synchronisation",
      value: isDiverging ? 1 : 0,
      formatted: isDiverging ? "Diverging trends" : "Synchronised"
    }),
    table: makeTable({
      columns: [
        { key: "city", label: "City", format: FORMAT.TEXT },
        { key: "latestMomDir", label: "Latest MoM Direction", format: FORMAT.TEXT },
        { key: "priorMomDir", label: "Prior MoM Direction", format: FORMAT.TEXT },
        { key: "diverging", label: "Direction Changed?", format: FORMAT.TEXT }
      ],
      rows
    }),
    narrative: isDiverging
      ? `Cities are moving in divergent directions: some are expanding while others shrink, pointing to territory-specific operational causes rather than macro demand trends.`
      : `All cities share the same direction of travel, indicating company-wide macroeconomic or seasonal drivers.`,
    costOfInaction: null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L05.A11 — Latest month as percentage of peak month */
function latestVsPeak(cube, entry, params) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const series = cube.companySeries();
  let peak = series[0] || new Decimal(0);
  let peakPeriod = cube.periods[0]?.label || "P1";

  series.forEach((val, idx) => {
    if (val.greaterThan(peak)) {
      peak = val;
      peakPeriod = cube.periods[idx]?.label || `P${idx + 1}`;
    }
  });

  const latest = series[series.length - 1] || new Decimal(0);
  const ratio = peak.isPositive() ? latest.dividedBy(peak) : new Decimal(1);

  const ev = evaluate(ratio, {
    rule: "Latest month < 85% of peak = AMBER; < 70% of peak = RED",
    metric: "latest as % of peak",
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
    redFlag: ev.fired ? `RED FLAG — Latest revenue is ${(toNumber(ratio) * 100).toFixed(1)}% of historical peak (${formatINR(peak)} in ${peakPeriod})` : null,
    headline: makeHeadline({
      label: "Latest as % of Peak",
      value: toFraction(ratio),
      unit: "%",
      formatted: `${(toNumber(ratio) * 100).toFixed(1)}% (${peakPeriod} peak)`
    }),
    table: makeTable({
      columns: [
        { key: "metric", label: "Measure", format: FORMAT.TEXT },
        { key: "value", label: "Value", format: FORMAT.TEXT }
      ],
      rows: [
        { metric: "Peak Month Revenue", value: `${formatINR(peak)} (${peakPeriod})` },
        { metric: "Latest Month Revenue", value: `${formatINR(latest)} (${cube.periods[cube.periods.length - 1].label})` },
        { metric: "Gap from Peak", value: formatINR(peak.minus(latest)) },
        { metric: "Percentage of Peak Achieved", value: `${(toNumber(ratio) * 100).toFixed(1)}%` }
      ]
    }),
    narrative: `Compares the current run-rate to the best-ever performance level to quantify unrealised operational capacity.`,
    costOfInaction: makeCostOfInaction({
      amount: toNumber(peak.minus(latest)),
      formatted: `${formatINR(peak.minus(latest))}/mo`,
      basis: "unrealised monthly revenue vs peak capacity",
      horizonMonths: 6
    }),
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L06.A10 — Portfolio growth vs decline revenue impact */
function portfolioGrowthDeclineImpact(cube, entry, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return idleBlock(entry, "need at least 2 periods");

  const members = resolveMembers(cube, axis);
  let totalGain = new Decimal(0);
  let totalLoss = new Decimal(0);

  const rows = members.map((m) => {
    const s = m.series;
    const delta = s[s.length - 1].minus(s[0]);
    if (delta.isPositive()) totalGain = totalGain.plus(delta);
    else if (delta.isNegative()) totalLoss = totalLoss.plus(delta.abs());

    return {
      entity: m.label,
      startRev: toNumber(s[0]),
      endRev: toNumber(s[s.length - 1]),
      delta: toNumber(delta),
      direction: delta.greaterThan(0) ? "Growing" : (delta.lessThan(0) ? "Declining" : "Flat"),
      _status: delta.lessThan(0) ? STATUS.AMBER : STATUS.GREEN,
      _drill: drillFor(axis, m)
    };
  });

  const netImpact = totalGain.minus(totalLoss);
  const ev = evaluate(netImpact, {
    rule: "Portfolio net decline < -₹20,000 = RED; < ₹0 = AMBER",
    metric: "portfolio net gain/loss",
    format: "currency",
    reverse: true,
    bands: [
      { at: 0, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: -20000, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? `RED FLAG — Declining ${axis.noun} lost ${formatINR(totalLoss)}, exceeding gains of ${formatINR(totalGain)} by ${formatINR(netImpact.abs())}` : null,
    headline: makeHeadline({
      label: "Portfolio Net Direction",
      value: toNumber(netImpact),
      formatted: netImpact.greaterThanOrEqualTo(0) ? `+${formatINR(netImpact)} Net Growth` : `-${formatINR(netImpact.abs())} Net Decline`
    }),
    table: makeTable({
      columns: [
        { key: "entity", label: axis.label, format: FORMAT.TEXT },
        { key: "startRev", label: `Start (${cube.periods[0].label})`, format: FORMAT.CURRENCY },
        { key: "endRev", label: `End (${cube.periods[cube.periods.length - 1].label})`, format: FORMAT.CURRENCY },
        { key: "delta", label: "Change", format: FORMAT.CURRENCY },
        { key: "direction", label: "Direction", format: FORMAT.STATUS }
      ],
      rows,
      totalsRow: { entity: "Net Portfolio Impact", startRev: rows.reduce((s, r) => s + r.startRev, 0), endRev: rows.reduce((s, r) => s + r.endRev, 0), delta: toNumber(netImpact), direction: netImpact.greaterThanOrEqualTo(0) ? "Net Growing" : "Net Declining" }
    }),
    narrative: netImpact.isNegative()
      ? `Losses in declining ${axis.noun} (${formatINR(totalLoss)}) exceed gains in growing ${axis.noun} (${formatINR(totalGain)}), resulting in a net monthly revenue bleed of ${formatINR(netImpact.abs())}.`
      : `Growth across expanding ${axis.noun} (${formatINR(totalGain)}) outpaces declining areas (${formatINR(totalLoss)}).`,
    costOfInaction: netImpact.isNegative()
      ? makeCostOfInaction({
        amount: toNumber(netImpact.abs()),
        formatted: `${formatINR(netImpact.abs())}/mo`,
        basis: "net portfolio deficit",
        horizonMonths: 6
      })
      : null,
    provenance: { periodsUsed: cube.periods.length }
  });
}

module.exports = {
  family: FAMILY.TREND,
  declineStreak,
  latestGrowth,
  rollingMomentum,
  peakGap,
  shareShift,
  volatilityCv,
  topNDependency,
  trendSlope,
  companyTrend,
  growthDeclineBalance,
  // Lens 5 & L06.A10
  monthlyConcentrationIndex,
  frontVsBackLoading,
  cityMonthlyVolatility,
  bestVsWorstGap,
  proportionalShare3M,
  momConsistency,
  cityRankStability,
  quarterlyTrajectory,
  crossCitySync,
  latestVsPeak,
  portfolioGrowthDeclineImpact
};
