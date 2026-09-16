/**
 * Contribution builders — the waterfall bridge.
 *
 * Covers lens 11 (which product caused the change) and lens 12 (which month).
 * The bridge answers the question an owner actually asks after seeing revenue
 * move: not "by how much" but "because of what".
 *
 * The default comparison is FIRST PERIOD vs LAST PERIOD, which is what the
 * workbook's bridge does — sheet 12 Table 1 is headed "Jan-25 Revenue" and
 * "Jan-26 Revenue" and every lens 11 formula reads those two columns. It is the
 * comparison an owner states out loud ("we were doing X a year ago, we are
 * doing Y now"), and on a 13-month window it lands on the same calendar month,
 * so seasonality cancels instead of distorting.
 *
 * It is also a two-point comparison and therefore sensitive to a single odd
 * month, which is why p1Months / p2Months exist: pass them to bridge any two
 * sets of periods, such as half against half, when the extra smoothing is worth
 * losing the like-for-like calendar match.
 *
 * The bridge is exhaustive by construction: every entity's delta is included,
 * so the deltas sum exactly to the company change. That identity is checked in
 * crossVerification and is what makes the attribution trustworthy rather than
 * merely plausible.
 */

const { FAMILY } = require("../../models/analysisBlock");
const { evaluate } = require("../../engine/triggerEvaluator");
const { AXES } = require("../../engine/axes");
const kit = require("../../engine/blockKit");
const stats = require("../shared/stats");
const coi = require("../../prescriptive/costOfInaction");
const {
  Decimal, toNumber, toFraction, share, safeDivide,
  formatINR, formatPercent, formatRatio
} = require("../shared/money");

const { idleBlock, perEntityBlock, singleMetricBlock, coiFromAmount, coiFromResult, makeHeadline, col, STATUS } = kit;

/* ------------------------------------------------------------------ */

/**
 * Build the bridge.
 *
 * @param params.axis      which entities to attribute the change to
 * @param params.p1Months  base-period period keys (optional)
 * @param params.p2Months  comparison-period period keys (optional)
 */
function buildBridge(cube, params) {
  const axis = params.axis;
  if (!axis || cube.periods.length < 2) return null;

  const keys = cube.periodKeys;
  const base = Array.isArray(params.p1Months) && params.p1Months.length ? params.p1Months : keys.slice(0, 1);
  const comparison = Array.isArray(params.p2Months) && params.p2Months.length ? params.p2Months : keys.slice(-1);
  if (!base.length || !comparison.length) return null;

  const baseSet = new Set(base);
  const compSet = new Set(comparison);

  const members = axis.members(cube).map((m) => {
    const series = axis.series(cube, m.key);
    let baseTotal = new Decimal(0);
    let compTotal = new Decimal(0);
    keys.forEach((k, i) => {
      if (baseSet.has(k)) baseTotal = baseTotal.plus(series[i]);
      if (compSet.has(k)) compTotal = compTotal.plus(series[i]);
    });
    return { ...m, base: baseTotal, comparison: compTotal, delta: compTotal.minus(baseTotal) };
  }).filter((m) => !m.base.isZero() || !m.comparison.isZero());

  const baseTotal = members.reduce((a, m) => a.plus(m.base), new Decimal(0));
  const compTotal = members.reduce((a, m) => a.plus(m.comparison), new Decimal(0));
  const totalDelta = compTotal.minus(baseTotal);

  const negatives = members.filter((m) => m.delta.isNegative());
  const positives = members.filter((m) => m.delta.isPositive());
  const negativeTotal = negatives.reduce((a, m) => a.plus(m.delta.abs()), new Decimal(0));
  const positiveTotal = positives.reduce((a, m) => a.plus(m.delta), new Decimal(0));

  // Share of the DECLINE, not of the net change — a net change near zero would
  // otherwise produce meaningless or infinite percentages.
  // One period reads as "Jan-25", several as "Jan-25-Jun-25". Now that the
  // default sides are single months, the naive form would say "Jan-25-Jan-25".
  const rangeLabel = (list) => {
    const first = cube.periodIndex.get(list[0]).label;
    const last = cube.periodIndex.get(list[list.length - 1]).label;
    return first === last ? first : `${first}-${last}`;
  };

  const withShares = members.map((m) => ({
    ...m,
    shareOfDecline: m.delta.isNegative() && !negativeTotal.isZero() ? m.delta.abs().dividedBy(negativeTotal) : null,
    shareOfGrowth: m.delta.isPositive() && !positiveTotal.isZero() ? m.delta.dividedBy(positiveTotal) : null,
    attribution: m.delta.isZero() ? "NEUTRAL" : m.delta.isPositive() ? "GROWTH DRIVER" : "DRAG"
  })).sort((a, b) => a.delta.comparedTo(b.delta));

  return {
    axis,
    members: withShares,
    baseKeys: base,
    comparisonKeys: comparison,
    baseLabel: rangeLabel(base),
    comparisonLabel: rangeLabel(comparison),
    baseTotal,
    compTotal,
    totalDelta,
    negatives,
    positives,
    negativeTotal,
    positiveTotal
  };
}

function bridgeColumns(b) {
  return [
    col.text("entity", b.axis.label),
    col.money("base", b.baseLabel),
    col.money("comparison", b.comparisonLabel),
    col.money("delta", "Change"),
    col.pct("shareOfChange", "Share of Decline"),
    col.status("attribution", "Role")
  ];
}

function bridgeRows(b, statusFor) {
  return b.members.map((m) => ({
    entity: m.label,
    base: toNumber(m.base),
    comparison: toNumber(m.comparison),
    delta: toNumber(m.delta),
    shareOfChange: toFraction(m.shareOfDecline),
    attribution: m.attribution,
    _status: statusFor ? statusFor(m) : (m.delta.isNegative() ? STATUS.AMBER : STATUS.GREEN),
    _drill: { type: b.axis.drillType, name: m.label }
  }));
}

/* ================================================================== */
/* A01 — the register of material contributors                         */
/* ================================================================== */

function contributionRedFlags(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");

  const evaluations = [];
  const offenders = [];

  for (const m of b.members) {
    const ev = evaluate(m.shareOfDecline, "MATERIAL_NEGATIVE_CONTRIBUTOR", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: formatINR(m.delta) });
  }

  const rows = bridgeRows(b).map((r, i) => ({ ...r, _status: evaluations[i].status }));
  const worst = b.members[0];

  return perEntityBlock(entry, {
    axis: b.axis,
    columns: bridgeColumns(b),
    rows,
    evaluations,
    offenders,
    headline: makeHeadline({
      label: `Revenue change, ${b.baseLabel} to ${b.comparisonLabel}`,
      value: toNumber(b.totalDelta),
      formatted: formatINR(b.totalDelta, { sign: true })
    }),
    narrative: b.totalDelta.isNegative()
      ? `Revenue fell ${formatINR(b.totalDelta.abs())} between the two halves of the period. ${worst.label} is the single largest drag at ${formatINR(worst.delta)}, ${formatPercent(worst.shareOfDecline)} of the total decline. The bridge is exhaustive — every ${b.axis.noun.replace(/s$/, "")}'s change is included, so these figures account for the whole movement.`
      : `Revenue grew ${formatINR(b.totalDelta)} between the two halves of the period, even though ${b.negatives.length} ${b.axis.noun} declined. The bridge shows exactly which movements offset which.`,
    costOfInaction: coiFromResult(coi.fromChange(b.totalDelta)),
    provenance: { rowsConsidered: b.members.length, baseTotal: toNumber(b.baseTotal), comparisonTotal: toNumber(b.compTotal) }
  });
}

/* ================================================================== */
/* A02 / A03 — the single largest mover each way                       */
/* ================================================================== */

function largestNegative(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");
  if (!b.negatives.length) {
    return singleMetricBlock(entry, {
      ev: evaluate(new Decimal(0), "MATERIAL_NEGATIVE_CONTRIBUTOR"),
      headline: makeHeadline({ label: "Largest decline", value: 0, formatted: `No ${b.axis.noun} declined` }),
      columns: bridgeColumns(b),
      rows: bridgeRows(b),
      narrative: `Every ${b.axis.label.toLowerCase()} held or grew between the two halves of the period.`,
      provenance: { rowsConsidered: b.members.length }
    });
  }

  const worst = b.members[0];
  const ev = evaluate(worst.shareOfDecline, "MATERIAL_NEGATIVE_CONTRIBUTOR", { subject: worst.label });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Largest single drag (${worst.label})`,
      value: toNumber(worst.delta),
      formatted: formatINR(worst.delta),
      delta: toFraction(worst.shareOfDecline),
      deltaFormatted: formatPercent(worst.shareOfDecline)
    }),
    columns: bridgeColumns(b),
    rows: bridgeRows(b, (m) => (m === worst ? ev.status : m.delta.isNegative() ? STATUS.AMBER : STATUS.GREEN)),
    redFlag: `RED FLAG — ${worst.label} accounts for ${formatPercent(worst.shareOfDecline)} of the total decline, worth ${formatINR(worst.delta)}`,
    narrative: `${worst.label} fell ${formatINR(worst.delta.abs())}, which is ${formatPercent(worst.shareOfDecline)} of everything lost. Fixing this one ${b.axis.noun.replace(/s$/, "")} addresses most of the problem; the rest is spread thinly.`,
    costOfInaction: coiFromResult(coi.fromChange(worst.delta)),
    provenance: { rowsConsidered: b.members.length }
  });
}

function largestPositive(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");
  if (!b.positives.length) {
    return singleMetricBlock(entry, {
      ev: evaluate(new Decimal(1), "OFFSET_DEFICIT"),
      headline: makeHeadline({ label: "Largest growth", value: 0, formatted: `No ${b.axis.noun} grew` }),
      columns: bridgeColumns(b),
      rows: bridgeRows(b),
      redFlag: `RED FLAG — no ${b.axis.label.toLowerCase()} grew between the two halves of the period`,
      narrative: `Nothing grew. With no engine anywhere in the portfolio, the decline has nothing working against it.`,
      provenance: { rowsConsidered: b.members.length }
    });
  }

  const best = b.members[b.members.length - 1];
  const coverage = b.negativeTotal.isZero() ? null : best.delta.dividedBy(b.negativeTotal);

  // Finding a strong grower is GOOD NEWS. The workbook says so outright — this
  // is one of the handful of analyses whose trigger sentence is "GREEN SIGNAL"
  // rather than "TRIGGERED" — so this block must never colour itself AMBER or
  // RED on the strength of the grower. What can still be bad is the ABSENCE of
  // one, and that case returns above before reaching here.
  const ev = evaluate(new Decimal(0), {
    rule: "A grower above the material threshold = GREEN SIGNAL; nothing growing = flagged",
    metric: "largest single growth contribution",
    format: "currency",
    bands: []
  });
  ev.evaluated = `GREEN SIGNAL — ${best.label} grew ${formatINR(best.delta)} between the two periods`;

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Largest growth driver (${best.label})`,
      value: toNumber(best.delta),
      formatted: formatINR(best.delta, { sign: true })
    }),
    columns: bridgeColumns(b),
    rows: bridgeRows(b, (m) => (m === best ? STATUS.GREEN : m.delta.isNegative() ? STATUS.AMBER : STATUS.GREEN)),
    redFlag: `RED FLAG — ${best.label} grew ${formatINR(best.delta)} but that covers only ${formatPercent(coverage)} of the ${formatINR(b.negativeTotal)} lost elsewhere`,
    narrative: `${best.label} added ${formatINR(best.delta)}. Against ${formatINR(b.negativeTotal)} lost across declining ${b.axis.noun}, it covers ${formatPercent(coverage)} of the shortfall. A single growth engine carrying the whole portfolio is itself a concentration risk.`,
    provenance: { rowsConsidered: b.members.length }
  });
}

/* ================================================================== */
/* A04 / A05 — the balance of movers                                   */
/* ================================================================== */

function netMoversBalance(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");

  const decliningShare = b.members.length ? new Decimal(b.negatives.length).dividedBy(b.members.length) : null;
  const ev = evaluate(decliningShare, "DECLINING_SHARE_OF_ENTITIES");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${b.axis.label}s growing`,
      value: b.positives.length,
      formatted: `${b.positives.length} up, ${b.negatives.length} down`
    }),
    columns: bridgeColumns(b),
    rows: bridgeRows(b),
    redFlag: `RED FLAG — ${b.negatives.length} of ${b.members.length} ${b.axis.noun} declined`,
    narrative: `${b.positives.length} ${b.axis.noun} grew and ${b.negatives.length} fell. Counting movers is only the first read — the amounts matter more, and those are ${formatINR(b.positiveTotal)} gained against ${formatINR(b.negativeTotal)} lost.`,
    provenance: { rowsConsidered: b.members.length }
  });
}

function positiveVsNegative(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");

  const uncovered = b.negativeTotal.minus(b.positiveTotal);
  const uncoveredRate = b.negativeTotal.isZero() ? null : Decimal.max(0, uncovered.dividedBy(b.negativeTotal));
  const ev = evaluate(uncoveredRate, "OFFSET_DEFICIT");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Gains against losses",
      value: toNumber(b.totalDelta),
      formatted: `${formatINR(b.positiveTotal)} gained, ${formatINR(b.negativeTotal)} lost`
    }),
    columns: [col.text("side", "Movement"), col.money("amount", "Amount"), col.num("count", `${b.axis.label}s`)],
    rows: [
      { side: "Growth", amount: toNumber(b.positiveTotal), count: b.positives.length, _status: STATUS.GREEN },
      { side: "Decline", amount: toNumber(b.negativeTotal.negated()), count: b.negatives.length, _status: STATUS.AMBER },
      { side: "Net", amount: toNumber(b.totalDelta), count: b.members.length }
    ],
    redFlag: `RED FLAG — losses exceed gains by ${formatINR(uncovered)}`,
    narrative: b.totalDelta.isNegative()
      ? `${formatINR(b.positiveTotal)} of growth did not cover ${formatINR(b.negativeTotal)} of decline, leaving the business ${formatINR(uncovered)} short. Growth is happening but is not yet large enough to matter at the company level.`
      : `${formatINR(b.positiveTotal)} of growth more than covered ${formatINR(b.negativeTotal)} of decline, for a net gain of ${formatINR(b.totalDelta)}.`,
    costOfInaction: coiFromResult(coi.fromChange(b.totalDelta)),
    provenance: { rowsConsidered: b.members.length }
  });
}

/* ================================================================== */
/* A06 — how lopsided the movements are                                */
/* ================================================================== */

function contributionImbalance(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");

  // The share the single biggest mover takes of ALL movement, up and down
  // alike. HHI over the same magnitudes answers a subtly different question
  // (how evenly spread is the movement overall) and is far less legible on a
  // card than "one product is a quarter of everything that moved".
  const magnitudes = b.members.map((m) => m.delta.abs());
  const movement = magnitudes.reduce((a, v) => a.plus(v), new Decimal(0));
  const largest = magnitudes.reduce((a, v) => (v.greaterThan(a) ? v : a), new Decimal(0));
  const index = movement.isZero() ? null : largest.dividedBy(movement);
  const ev = evaluate(index, "MOVEMENT_CONCENTRATION");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Largest mover's share of all movement",
      value: toFraction(index),
      formatted: index === null ? "N/A" : formatPercent(index)
    }),
    columns: bridgeColumns(b),
    rows: bridgeRows(b),
    redFlag: `RED FLAG — the change is concentrated in a few ${b.axis.noun} rather than spread`,
    narrative: `HHI over the size of each movement says whether the period's change came from one or two ${b.axis.noun} or from broad drift. Concentrated movement is easier to act on: there are fewer things to fix.`,
    provenance: { rowsConsidered: b.members.length }
  });
}

/* ================================================================== */
/* A07 — how much of the decline the worst two explain                 */
/* ================================================================== */

function topNegativeContributors(cube, entry, params) {
  const n = params.n || 2;
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");
  if (!b.negatives.length) return idleBlock(entry, `no ${b.axis.noun} declined in this period`);

  const worst = b.members.filter((m) => m.delta.isNegative()).slice(0, n);
  const combined = worst.reduce((a, m) => a.plus(m.delta.abs()), new Decimal(0));
  const combinedShare = b.negativeTotal.isZero() ? null : combined.dividedBy(b.negativeTotal);

  const ev = evaluate(combinedShare, "TOP2_NEGATIVE_SHARE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Top ${n} contributors to the decline`,
      value: toFraction(combinedShare),
      formatted: formatPercent(combinedShare),
      delta: toNumber(combined),
      deltaFormatted: formatINR(combined)
    }),
    columns: bridgeColumns(b),
    rows: bridgeRows(b, (m) => (worst.includes(m) ? ev.status : m.delta.isNegative() ? STATUS.AMBER : STATUS.GREEN)),
    redFlag: `RED FLAG — ${worst.map((m) => m.label).join(" and ")} explain ${formatPercent(combinedShare)} of the entire decline`,
    narrative: `${worst.map((m) => m.label).join(" and ")} together account for ${formatINR(combined)} of the ${formatINR(b.negativeTotal)} lost. A concentrated cause is good news operationally — it means a small number of targeted interventions can reverse most of the damage.`,
    costOfInaction: coiFromAmount(combined.dividedBy(12).times(3), `${formatINR(combined)} lost across the top ${n} declining ${b.axis.noun}, pro-rated over 3 months`),
    provenance: { rowsConsidered: b.members.length, n }
  });
}

/* ================================================================== */
/* A08 — can growth cover the decline?                                 */
/* ================================================================== */

function offsetCapacity(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");

  const coverage = b.negativeTotal.isZero() ? null : b.positiveTotal.dividedBy(b.negativeTotal);
  const ev = evaluate(coverage === null ? null : Decimal.max(0, new Decimal(1).minus(coverage)), "OFFSET_DEFICIT");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Growth cover for decline",
      value: toNumber(coverage),
      formatted: coverage === null ? "No decline to cover" : formatPercent(coverage)
    }),
    columns: [col.text("entity", b.axis.label), col.money("delta", "Change"), col.status("attribution", "Role")],
    rows: b.members.map((m) => ({
      entity: m.label,
      delta: toNumber(m.delta),
      attribution: m.attribution,
      _status: m.delta.isNegative() ? STATUS.AMBER : STATUS.GREEN,
      _drill: { type: b.axis.drillType, name: m.label }
    })),
    redFlag: `RED FLAG — growth covers only ${formatPercent(coverage)} of the decline; the business is net shrinking`,
    narrative: coverage === null
      ? `Nothing declined, so there is nothing for growth to cover.`
      : `Growing ${b.axis.noun} added ${formatINR(b.positiveTotal)} against ${formatINR(b.negativeTotal)} lost — covering ${formatPercent(coverage)}. Below 100% the portfolio shrinks even while parts of it grow, which is the pattern that surprises owners most.`,
    provenance: { rowsConsidered: b.members.length }
  });
}

/* ================================================================== */
/* A09 — each movement against the average                             */
/* ================================================================== */

function changeVsAverage(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");

  const magnitudes = b.members.map((m) => m.delta.abs());
  const average = stats.mean(magnitudes);
  if (average === null || average.isZero()) return idleBlock(entry, "no movement to compare against an average");

  const rows = b.members.map((m) => ({
    entity: m.label,
    delta: toNumber(m.delta),
    multiple: toNumber(safeDivide(m.delta.abs(), average)),
    attribution: m.attribution,
    _status: m.delta.isNegative() && m.delta.abs().greaterThan(average.times(2)) ? STATUS.AMBER : STATUS.GREEN,
    _drill: { type: b.axis.drillType, name: m.label }
  }));

  const biggest = rows.reduce((a, r) => ((r.multiple || 0) > (a.multiple || 0) ? r : a), rows[0]);
  const ev = evaluate(biggest.multiple === null ? null : new Decimal(biggest.multiple), {
    rule: "One movement more than 2x the average = an outlier driving the period",
    metric: "largest movement as a multiple of the average",
    format: "ratio",
    bands: [
      { at: 2, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 3.5, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Largest movement (${biggest.entity})`,
      value: biggest.multiple,
      formatted: `${formatRatio(biggest.multiple)} the average`
    }),
    columns: [col.text("entity", b.axis.label), col.money("delta", "Change"), col.ratio("multiple", "vs Average Movement"), col.status("attribution", "Role")],
    rows,
    redFlag: `RED FLAG — ${biggest.entity} moved ${formatRatio(biggest.multiple)} the average, dominating the period`,
    narrative: `The average absolute movement was ${formatINR(average)}. Anything well above that is driving the period's result on its own and deserves its own explanation rather than being read as part of a general trend.`,
    provenance: { rowsConsidered: b.members.length }
  });
}

/* ================================================================== */
/* A10 — the company growth rate the bridge explains                   */
/* ================================================================== */

function companyGrowthRate(cube, entry, params) {
  // The company total is the same whichever axis it is decomposed along, so
  // this one analysis defaults its own rather than making every caller pass an
  // axis it does not otherwise use.
  const b = buildBridge(cube, { ...params, axis: params.axis || AXES.group });
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");

  const rate = b.baseTotal.isZero() ? null : b.totalDelta.dividedBy(b.baseTotal.abs());
  const declineMetric = rate === null ? null : (rate.isNegative() ? rate.negated() : new Decimal(0));
  const ev = evaluate(declineMetric, "COMPANY_DECLINE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${b.baseLabel} to ${b.comparisonLabel}`,
      value: toFraction(rate),
      formatted: rate === null ? "N/A" : formatPercent(rate, { sign: true }),
      delta: toNumber(b.totalDelta),
      deltaFormatted: formatINR(b.totalDelta, { sign: true })
    }),
    columns: [col.text("period", "Period"), col.money("revenue", "Revenue")],
    rows: [
      { period: b.baseLabel, revenue: toNumber(b.baseTotal) },
      { period: b.comparisonLabel, revenue: toNumber(b.compTotal) },
      { period: "Change", revenue: toNumber(b.totalDelta), _status: b.totalDelta.isNegative() ? STATUS.AMBER : STATUS.GREEN }
    ],
    redFlag: `RED FLAG — company revenue moved ${formatPercent(rate, { sign: true })} between the two halves of the period`,
    narrative: `Comparing the two halves of the window, revenue moved from ${formatINR(b.baseTotal)} to ${formatINR(b.compTotal)}, a change of ${formatPercent(rate, { sign: true })}. Everything else in this lens explains where that came from.`,
    costOfInaction: coiFromResult(coi.fromChange(b.totalDelta)),
    provenance: { rowsConsidered: b.members.length }
  });
}

/* ================================================================== */
/* Month-side variants (lens 12)                                       */
/* ================================================================== */

/** L12.A02 — the direction of the monthly series itself. */
function monthlyTrendDirection(cube, entry) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least two periods to judge direction");

  const series = cube.companySeries();
  const slope = stats.linearSlope(series);
  const streak = stats.declineStreak(series);
  const declineMetric = slope === null ? null : (slope.isNegative() ? slope.negated() : new Decimal(0));
  const companyAverage = stats.mean(series);
  const slopeShare = declineMetric === null || companyAverage === null || companyAverage.isZero()
    ? null
    : declineMetric.dividedBy(companyAverage.abs());
  const ev = evaluate(slopeShare, "NEGATIVE_SLOPE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Company monthly trend",
      value: toNumber(slope),
      formatted: `${formatINR(slope)}/month`
    }),
    columns: [col.month("month", "Month"), col.money("revenue", "Revenue"), col.num("streak", "Decline Streak")],
    rows: cube.periods.map((p, i) => ({
      month: p.label,
      revenue: toNumber(series[i]),
      streak: streak.byIndex[i],
      _status: streak.byIndex[i] >= 3 ? STATUS.AMBER : STATUS.GREEN,
      _drill: { type: "month", name: p.label }
    })),
    redFlag: `RED FLAG — the company trend is losing ${formatINR(slope)} a month`,
    narrative: `Fitted across all ${cube.periods.length} months, the company trend runs at ${formatINR(slope)} per month. The longest unbroken decline in the window was ${streak.longest} month${streak.longest === 1 ? "" : "s"}.`,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L12.A03 — is the decline persistent or intermittent? */
function declinePersistence(cube, entry) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least two periods to measure persistence");

  const series = cube.companySeries();
  const streak = stats.declineStreak(series);
  const declines = stats.momSeries(series).filter((g) => g !== null && g.isNegative()).length;
  const persistence = cube.periods.length > 1 ? new Decimal(declines).dividedBy(cube.periods.length - 1) : null;

  // The check itself is the latest month against the one before it — the
  // question is "is it still falling?", not "how often has it fallen". How
  // often is the context, and stays in the table and the narrative.
  const latest = series[series.length - 1];
  const prior = series[series.length - 2];
  const latestDelta = latest.minus(prior);
  const ev = evaluate(latestDelta.isNegative() ? latestDelta.negated() : new Decimal(0), "LATEST_MONTH_FELL");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Latest month vs prior (${cube.periods[cube.periods.length - 1].label})`,
      value: toNumber(latestDelta),
      formatted: formatINR(latestDelta, { sign: true }),
      delta: declines,
      deltaFormatted: `${declines} of ${cube.periods.length - 1} months declined`
    }),
    columns: [col.month("month", "Month"), col.money("revenue", "Revenue"), col.pct("mom", "MoM")],
    rows: cube.periods.map((p, i) => ({
      month: p.label,
      revenue: toNumber(series[i]),
      mom: i === 0 ? null : toFraction(series[i - 1].isZero() ? null : series[i].minus(series[i - 1]).dividedBy(series[i - 1].abs())),
      _status: i > 0 && series[i].lessThan(series[i - 1]) ? STATUS.AMBER : STATUS.GREEN,
      _drill: { type: "month", name: p.label }
    })),
    redFlag: `RED FLAG — the latest month fell ${formatINR(latestDelta.abs())} against the one before it`,
    narrative: `The latest month moved ${formatINR(latestDelta, { sign: true })} against the one before. Across the window revenue declined in ${declines} of ${cube.periods.length - 1} month-on-month steps, with a longest unbroken run of ${streak.longest}. Frequent small declines and one large drop need very different responses; this separates them.`,
    provenance: { periodsUsed: cube.periods.length }
  });
}

/** L12.A04 — how long recovery would take at the current growth rate. */
function breakEvenTimeline(cube, entry, params) {
  // Company-level, so it defaults its own axis rather than making callers pass
  // one it does not otherwise use.
  const b = buildBridge(cube, { ...params, axis: params.axis || AXES.group });
  if (!b) return idleBlock(entry, "need at least two periods to project a timeline");

  const series = cube.companySeries();
  const slope = stats.linearSlope(series);
  const latest = series[series.length - 1];

  // The timeline the workbook computes is a RUNWAY, not a repair estimate: at
  // the current negative trend, how many months until a fifth of the latest
  // month's revenue has gone. A book that is growing has no such clock, which
  // is the "N/A" branch of the workbook's own formula.
  const EROSION = new Decimal(0.2);
  const declining = slope !== null && slope.isNegative();
  const months = declining ? latest.times(EROSION).dividedBy(slope.abs()) : null;

  // Normalised higher-is-worse: how far inside a 12-month runway this sits.
  const shortfall = months === null ? null : Decimal.max(0, new Decimal(12).minus(months));
  const ev = evaluate(shortfall, "DECLINE_RUNWAY_SHORTFALL");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Months until a fifth of revenue is gone",
      value: toNumber(months, 4),
      formatted: months === null ? "N/A — the trend is not negative" : `${months.toFixed(1)} months`
    }),
    columns: [col.text("metric", "Measure"), col.money("value", "Value")],
    rows: [
      { metric: `Latest month (${cube.periods[cube.periods.length - 1].label})`, value: toNumber(latest) },
      { metric: "A fifth of that", value: toNumber(latest.times(EROSION)) },
      { metric: "Current trend per month", value: toNumber(slope) },
      { metric: "Change over the bridge", value: toNumber(b.totalDelta) }
    ],
    redFlag: months === null
      ? null
      : `RED FLAG — at ${formatINR(slope)} a month, a fifth of revenue is gone in ${months.toFixed(1)} months`,
    narrative: months === null
      ? `The fitted trend is not negative, so there is no erosion clock running. This measure only has meaning while revenue is trending down.`
      : `Revenue is trending at ${formatINR(slope)} a month against a latest month of ${formatINR(latest)}. Left alone, that erases a fifth of it in ${months.toFixed(1)} months. This is the do-nothing case, and it is the number any intervention should be argued against.`,
    costOfInaction: coiFromResult(coi.fromChange(b.totalDelta)),
    provenance: { periodsUsed: cube.periods.length }
  });
}

/**
 * L12.A05 — is the change spread across the portfolio or driven by outliers?
 *
 * The standard deviation of the changes against their average magnitude. Near
 * zero means everything moved by a similar amount; above 1 means one or two
 * entities moved very differently from the rest, and the portfolio average is
 * describing nobody.
 */
function changeDistribution(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to build a contribution bridge");
  if (b.members.length < 2) return idleBlock(entry, `need at least two ${b.axis.noun} to measure a distribution`);

  const deltas = b.members.map((m) => m.delta);
  const spread = stats.stdDev(deltas);
  const averageMagnitude = stats.mean(deltas.map((d) => d.abs()));
  const dispersion = averageMagnitude === null || averageMagnitude.isZero() || spread === null
    ? null
    : spread.dividedBy(averageMagnitude);

  const ev = evaluate(dispersion, "CHANGE_DISTRIBUTION_SPREAD");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Dispersion of changes",
      value: toFraction(dispersion),
      formatted: dispersion === null ? "N/A" : dispersion.toFixed(2)
    }),
    columns: bridgeColumns(b),
    rows: bridgeRows(b),
    redFlag: `RED FLAG — the change is driven by outliers rather than a broad shift across ${b.axis.noun}`,
    narrative: `The changes vary by ${spread === null ? "N/A" : formatINR(spread)} against an average movement of ${formatINR(averageMagnitude)}. A high ratio means a couple of ${b.axis.noun} moved very differently from the rest, so the portfolio average describes none of them and the outliers are where the story is.`,
    provenance: { rowsConsidered: b.members.length }
  });
}

/**
 * L12.A06 — net growth, net decline, or breakeven, in rupees.
 *
 * Deliberately the absolute figure rather than the rate L11.A10 reports. A
 * percentage answers "how fast"; the owner asking this question wants "how
 * much", and the two land very differently on a small base.
 */
function netRevenuePosition(cube, entry, params) {
  const b = buildBridge(cube, { ...params, axis: params.axis || AXES.group });
  if (!b) return idleBlock(entry, "need at least two periods to judge a net position");

  const declineShare = b.baseTotal.isZero() || !b.totalDelta.isNegative()
    ? new Decimal(0)
    : b.totalDelta.abs().dividedBy(b.baseTotal);
  const ev = evaluate(declineShare, "NET_REVENUE_DECLINE");

  const position = b.totalDelta.isZero() ? "Breakeven" : b.totalDelta.isNegative() ? "Net decline" : "Net growth";

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Net position (${b.baseLabel} to ${b.comparisonLabel})`,
      value: toNumber(b.totalDelta),
      formatted: formatINR(b.totalDelta, { sign: true }),
      delta: toFraction(b.baseTotal.isZero() ? null : b.totalDelta.dividedBy(b.baseTotal)),
      deltaFormatted: position
    }),
    columns: [col.text("period", "Period"), col.money("revenue", "Revenue")],
    rows: [
      { period: b.baseLabel, revenue: toNumber(b.baseTotal) },
      { period: b.comparisonLabel, revenue: toNumber(b.compTotal) },
      { period: "Net change", revenue: toNumber(b.totalDelta), _status: b.totalDelta.isNegative() ? STATUS.RED : STATUS.GREEN }
    ],
    redFlag: `RED FLAG — the company is in net revenue decline of ${formatINR(b.totalDelta.abs())}`,
    narrative: `${position}: ${formatINR(b.baseTotal)} became ${formatINR(b.compTotal)}, a net movement of ${formatINR(b.totalDelta, { sign: true })}. This is the one line that everything else in the bridge decomposes.`,
    costOfInaction: coiFromResult(coi.fromChange(b.totalDelta)),
    provenance: { rowsConsidered: b.members.length }
  });
}

/**
 * L12.A09 — what restoring every declining entity would be worth.
 *
 * The sum of the shortfalls only. Netting the growers off first would answer a
 * different question ("are we ahead?"); this one is "what is sitting on the
 * table", and a grower elsewhere does not make a declining city cheaper to fix.
 */
function recoveryPotential(cube, entry, params) {
  const b = buildBridge(cube, params);
  if (!b) return idleBlock(entry, "need at least two periods to size a recovery");
  if (!b.negatives.length) return idleBlock(entry, `no ${b.axis.noun} declined — there is nothing to recover`);

  const recoverable = b.negativeTotal;
  const recoverableShare = b.baseTotal.isZero() ? null : recoverable.dividedBy(b.baseTotal);
  const ev = evaluate(recoverableShare, "RECOVERABLE_SHARE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Recoverable across ${b.negatives.length} declining ${b.axis.noun}`,
      value: toNumber(recoverable),
      formatted: formatINR(recoverable),
      delta: toFraction(recoverableShare),
      deltaFormatted: formatPercent(recoverableShare)
    }),
    columns: bridgeColumns(b),
    rows: bridgeRows(b, (m) => (m.delta.isNegative() ? STATUS.AMBER : STATUS.GREEN)),
    redFlag: `RED FLAG — ${formatINR(recoverable)} a period sits in ${b.negatives.length} declining ${b.axis.noun}`,
    narrative: `Restoring every declining ${b.axis.label.toLowerCase()} to where it was would add ${formatINR(recoverable)} per period, ${formatPercent(recoverableShare)} of the base. That is a ceiling rather than a forecast, but it is the right size to judge whether an intervention is worth its cost.`,
    costOfInaction: coiFromAmount(recoverable.times(3), `${formatINR(recoverable)} per period across ${b.negatives.length} declining ${b.axis.noun}, over 3 months`),
    provenance: { rowsConsidered: b.members.length, decliningCount: b.negatives.length }
  });
}

/**
 * L12.A01 — the month-by-month bridge, and whether the data supports one.
 *
 * The workbook cannot answer this: its own Table 2 has revenue in only the
 * first and last month, so it carries a written apology where the analysis
 * should be. Against a real ledger every month is populated, so the analysis it
 * wanted is simply computed here — each month's movement against the one
 * before, summing to the company's change over the window.
 *
 * The structural note survives as a real check rather than a fixed sentence: if
 * a company's data IS sparse, this says so instead of pretending.
 */
function monthlyBridgeOverview(cube, entry) {
  if (cube.periods.length < 2) return idleBlock(entry, "need at least two periods to bridge month to month");

  const series = cube.companySeries();
  const populated = series.filter((v) => !v.isZero()).length;
  const coverage = new Decimal(populated).dividedBy(series.length);

  const steps = series.slice(1).map((value, i) => ({
    month: cube.periods[i + 1].label,
    revenue: toNumber(value),
    delta: toNumber(value.minus(series[i])),
    _status: value.lessThan(series[i]) ? STATUS.AMBER : STATUS.GREEN,
    _drill: { type: "month", name: cube.periods[i + 1].label }
  }));

  const totalDelta = series[series.length - 1].minus(series[0]);
  const declining = steps.filter((r) => r.delta < 0).length;

  // Higher is worse: the share of months carrying no revenue at all. A gappy
  // ledger makes every month-level conclusion in this lens weaker, and that is
  // worth saying out loud rather than burying.
  const ev = evaluate(new Decimal(1).minus(coverage), {
    rule: "More than a quarter of months empty = the monthly bridge is unreliable; more than half = unusable",
    metric: "share of months with no revenue",
    format: "percent",
    bands: [
      { at: 0.25, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.50, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Company change across ${cube.periods.length} months`,
      value: toNumber(totalDelta),
      formatted: formatINR(totalDelta, { sign: true }),
      delta: declining,
      deltaFormatted: `${declining} of ${steps.length} months fell`
    }),
    columns: [col.month("month", "Month"), col.money("revenue", "Revenue"), col.money("delta", "vs Prior Month")],
    rows: steps,
    redFlag: `RED FLAG — only ${populated} of ${series.length} months carry revenue, so month-level attribution is unreliable`,
    narrative: `Walking month by month, revenue moved ${formatINR(totalDelta, { sign: true })} across the window, falling in ${declining} of ${steps.length} steps. ${populated} of ${series.length} months carry revenue, so the bridge ${coverage.greaterThanOrEqualTo(0.75) ? "rests on a complete picture" : "rests on a partial one and should be read with that in mind"}.`,
    provenance: { periodsUsed: cube.periods.length, populatedPeriods: populated }
  });
}

/**
 * L12.A07 — what this dataset's shape prevents you from concluding.
 *
 * A data-quality analysis rather than a revenue one. The workbook hard-codes
 * "Degenerate Table" because its own sample had two populated months; here the
 * same question is asked of whatever the company actually has, and it stays
 * quiet when there is nothing wrong.
 */
function structuralLimitation(cube, entry) {
  const periods = cube.periods.length;
  const series = periods ? cube.companySeries() : [];
  const populated = series.filter((v) => !v.isZero()).length;
  const empty = periods - populated;

  const limitations = [];
  if (periods < 2) limitations.push("Month-over-month movement: unavailable — the window holds a single period");
  if (periods < 3) limitations.push("3-month momentum: unavailable — needs at least three periods");
  if (periods < 6) limitations.push("Half-over-half comparison: unavailable — needs at least six periods");
  if (empty > 0) limitations.push(`Monthly bridge: weakened — ${empty} of ${periods} months carry no revenue`);
  if (!cube.cities.length) limitations.push("City attribution: unavailable — no city dimension on these rows");
  if (!cube.groups.length) limitations.push("Product attribution: unavailable — no stock group on these rows");

  const ev = evaluate(new Decimal(limitations.length), {
    rule: "Any structural limitation on the dataset = flagged; three or more = the lens is materially degraded",
    metric: "structural limitations on this dataset",
    format: "number",
    bands: [
      { at: 1, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 3, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Structural limitations",
      value: limitations.length,
      formatted: limitations.length === 0
        ? "None — the data supports every analysis in this lens"
        : `${limitations.length} limitation${limitations.length === 1 ? "" : "s"}`
    }),
    columns: [col.text("limitation", "Analytical capability"), col.status("state", "State")],
    rows: limitations.length
      ? limitations.map((text) => ({ limitation: text, state: "Limited", _status: STATUS.AMBER }))
      : [{ limitation: `All ${periods} periods populated across ${cube.cities.length} cities and ${cube.groups.length} products`, state: "Complete", _status: STATUS.GREEN }],
    redFlag: `RED FLAG — ${limitations.length} structural limitations restrict what this lens can conclude`,
    narrative: limitations.length === 0
      ? `Nothing about the shape of this dataset restricts the analysis. Every measure in this lens is computed on complete data, so its conclusions stand on their own.`
      : `The shape of the data, not the business, is what limits these ${limitations.length} conclusions. Fixing them is a collection problem — a longer window or more complete posting in Tally — rather than anything to act on commercially.`,
    provenance: { periodsUsed: periods, populatedPeriods: populated, limitations: limitations.length }
  });
}

module.exports = {
  family: FAMILY.CONTRIBUTION,
  monthlyBridgeOverview,
  structuralLimitation,
  changeDistribution,
  netRevenuePosition,
  recoveryPotential,
  contributionRedFlags,
  largestNegative,
  largestPositive,
  netMoversBalance,
  positiveVsNegative,
  contributionImbalance,
  topNegativeContributors,
  offsetCapacity,
  changeVsAverage,
  companyGrowthRate,
  monthlyTrendDirection,
  declinePersistence,
  breakEvenTimeline
};
