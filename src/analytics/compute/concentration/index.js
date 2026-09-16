/**
 * Concentration builders — how evenly revenue is spread, and what rides on the
 * largest few.
 *
 * Covers lens 2 (city balance), lens 9 (HHI risk register) and lens 10 (top
 * product x city combinations). As with the trend family, each builder is
 * written against an axis descriptor so the registry can point it at cities,
 * products, months or combos without duplicating the maths.
 */

const { FAMILY } = require("../../models/analysisBlock");
const { evaluate } = require("../../engine/triggerEvaluator");
const { drillFor } = require("../../engine/axes");
const kit = require("../../engine/blockKit");
const stats = require("../shared/stats");
const {
  Decimal, toNumber, toFraction, share, safeDivide,
  formatINR, formatPercent, formatNumber, formatRatio
} = require("../shared/money");

const { idleBlock, prepare, perEntityBlock, singleMetricBlock, coiFromAmount, makeHeadline, col, STATUS } = kit;

/* ================================================================== */
/* Distribution across an axis (lens 2)                                */
/* ================================================================== */

/**
 * L02.A01 — each member against an equal split of the total.
 *
 * The benchmark answers "what would this member earn if every one of them
 * pulled its weight equally", which is the comparison an owner actually makes.
 */
function equalShareBenchmark(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2 });
  if (!enough) return idleBlock(entry, `need at least two ${axis.noun} to compare against an equal share`);

  const grand = cube.totals.total;
  const benchmark = grand.dividedBy(members.length);

  const evaluations = [];
  const offenders = [];

  const rows = members.map((m) => {
    const deviation = m.total.minus(benchmark);
    const deviationRate = benchmark.isZero() ? null : deviation.dividedBy(benchmark);
    // Normalised so higher is worse: distance from the benchmark, either way.
    const ev = evaluate(deviationRate === null ? null : deviationRate.abs(), "EQUAL_SHARE_DEVIATION", { subject: m.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: m.label, metricFormatted: formatPercent(deviationRate, { sign: true }) });

    return {
      entity: m.label,
      revenue: toNumber(m.total),
      benchmark: toNumber(benchmark),
      deviation: toNumber(deviation),
      deviationPct: toFraction(deviationRate),
      flag: deviation.isPositive() ? "ABOVE BENCHMARK — concentration source" : "BELOW BENCHMARK — under-developed",
      _status: ev.status,
      _drill: drillFor(axis, m)
    };
  });

  const above = rows.filter((r) => r.deviation > 0);

  return perEntityBlock(entry, {
    axis,
    columns: [
      col.text("entity", axis.label),
      col.money("revenue", "Revenue"),
      col.money("benchmark", "Equal-Share Benchmark"),
      col.money("deviation", "Deviation"),
      col.pct("deviationPct", "% Deviation"),
      col.status("flag", "Balance")
    ],
    rows,
    evaluations,
    offenders,
    headline: makeHeadline({
      label: `Equal-share benchmark across ${members.length} ${axis.noun}`,
      value: toNumber(benchmark),
      formatted: formatINR(benchmark)
    }),
    narrative: `An equal split would give each ${axis.label.toLowerCase()} ${formatINR(benchmark)}. ${above.length} of ${members.length} sit above it, and those are where the concentration lives. Being above the benchmark is not itself a problem — it becomes one when a dominant ${axis.label.toLowerCase()} is also softening.`,
    provenance: { rowsConsidered: members.length }
  });
}

/** L02.A02 — ranking, and how far the leader is ahead of the tail. */
function rankingScaleGap(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2 });
  if (!enough) return idleBlock(entry, `need at least two ${axis.noun} to rank`);

  const totals = members.map((m) => m.total);
  const ranks = stats.rankDescending(totals);
  const largest = members[0];
  const smallest = members[members.length - 1];
  const multiple = safeDivide(largest.total, smallest.total);

  // Higher is worse: a bigger multiple means a more lopsided book.
  const ev = evaluate(multiple, {
    rule: "Largest more than 3x the smallest = lopsided; more than 5x = severe",
    metric: "largest-to-smallest multiple",
    format: "ratio",
    bands: [
      { at: 3, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 5, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  const rows = members.map((m, i) => ({
    entity: m.label,
    rank: ranks[i],
    revenue: toNumber(m.total),
    sharePct: toFraction(share(m.total, cube.totals.total)),
    vsLargest: toFraction(share(m.total, largest.total)),
    _drill: drillFor(axis, m)
  }));

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${largest.label} vs ${smallest.label}`,
      value: toNumber(multiple),
      formatted: multiple === null ? "N/A" : formatRatio(multiple)
    }),
    columns: [
      col.text("entity", axis.label),
      col.num("rank", "Rank"),
      col.money("revenue", "Revenue"),
      col.pct("sharePct", "Share of Total"),
      col.pct("vsLargest", `% of ${largest.label}`)
    ],
    rows,
    redFlag: `RED FLAG — ${largest.label} earns ${formatRatio(multiple)} what ${smallest.label} does`,
    narrative: `${largest.label} leads at ${formatINR(largest.total)}; ${smallest.label} trails at ${formatINR(smallest.total)}. A wide scale gap is worth understanding before it is worth fixing — the small ${axis.label.toLowerCase()} may be an under-developed market or simply a smaller one.`,
    provenance: { rowsConsidered: members.length }
  });
}

/** L02.A03, L09.A03 — HHI across an axis. */
function hhiIndex(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2 });
  if (!enough) return idleBlock(entry, `need at least two ${axis.noun} to measure concentration`);

  const totals = members.map((m) => m.total);
  const index = stats.hhi(totals);
  const diversification = stats.diversificationScore(totals);
  const evenSplit = safeDivide(1, members.length);
  const ev = evaluate(stats.concentrationMultiple(index, members.length), "HHI");

  const rows = members.map((m) => {
    const s = share(m.total, cube.totals.total);
    return {
      entity: m.label,
      revenue: toNumber(m.total),
      sharePct: toFraction(s),
      contribution: toFraction(s === null ? null : s.times(s)),
      _drill: drillFor(axis, m)
    };
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `HHI across ${members.length} ${axis.noun}`,
      value: toFraction(index),
      formatted: index === null ? "N/A" : index.toFixed(4),
      delta: toNumber(diversification),
      deltaFormatted: diversification === null ? null : `${diversification.toFixed(2)} effective ${axis.noun}`
    }),
    columns: [
      col.text("entity", axis.label),
      col.money("revenue", "Revenue"),
      col.pct("sharePct", "Share"),
      col.num("contribution", "HHI Contribution")
    ],
    rows,
    redFlag: `RED FLAG — HHI of ${index && index.toFixed(4)} across ${axis.noun} indicates concentrated revenue`,
    narrative: `HHI runs from ${evenSplit === null ? "1/n" : evenSplit.toFixed(4)} (a perfectly even split across these ${members.length} ${axis.noun}) up to 1 (everything in one). At ${index === null ? "N/A" : index.toFixed(4)} the book behaves like roughly ${diversification === null ? "N/A" : diversification.toFixed(1)} equally-sized ${axis.noun}.`,
    provenance: { rowsConsidered: members.length }
  });
}

/** L02.A04 — the smallest as a share of the largest. */
function smallestVsLargest(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2 });
  if (!enough) return idleBlock(entry, `need at least two ${axis.noun} to compare`);

  const largest = members[0];
  const smallest = members[members.length - 1];
  const proportion = safeDivide(smallest.total, largest.total);
  // Higher is worse, so invert: a small proportion means a big gap.
  const gapMetric = proportion === null ? null : new Decimal(1).minus(proportion);

  const ev = evaluate(gapMetric, {
    rule: "Smallest below 40% of the largest = AMBER; below 20% = RED",
    metric: "gap between the smallest and largest",
    format: "percent",
    bands: [
      { at: 0.60, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.80, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${smallest.label} as a share of ${largest.label}`,
      value: toFraction(proportion),
      formatted: formatPercent(proportion)
    }),
    columns: [col.text("entity", axis.label), col.money("revenue", "Revenue"), col.pct("vsLargest", `% of ${largest.label}`)],
    rows: members.map((m) => ({
      entity: m.label,
      revenue: toNumber(m.total),
      vsLargest: toFraction(share(m.total, largest.total)),
      _drill: drillFor(axis, m)
    })),
    redFlag: `RED FLAG — ${smallest.label} is only ${formatPercent(proportion)} of ${largest.label}`,
    narrative: `The weakest ${axis.label.toLowerCase()} earns ${formatPercent(proportion)} of what the strongest does. Whether that is a problem depends on market size — a genuinely small market is not the same as an under-served one.`,
    provenance: { rowsConsidered: members.length }
  });
}

/** L02.A05 — a compact growth summary across the axis. */
function growthSummary(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, `need at least two periods to summarise growth`);

  const rows = members.map((m) => {
    const first = m.series[0];
    const last = m.series[m.series.length - 1];
    const change = last.minus(first);
    const rate = first.isZero() ? null : change.dividedBy(first.abs());
    return {
      entity: m.label,
      first: toNumber(first),
      last: toNumber(last),
      change: toNumber(change),
      changePct: toFraction(rate),
      direction: change.isZero() ? "Flat" : change.isPositive() ? "Growing" : "Declining",
      _status: change.isNegative() ? STATUS.AMBER : STATUS.GREEN,
      _drill: drillFor(axis, m)
    };
  });

  const declining = rows.filter((r) => r.direction === "Declining");
  const decliningShare = members.length ? new Decimal(declining.length).dividedBy(members.length) : null;
  const ev = evaluate(decliningShare, "DECLINING_SHARE_OF_ENTITIES");
  const lostRevenue = rows.reduce((a, r) => (r.change < 0 ? a.plus(new Decimal(-r.change)) : a), new Decimal(0));

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${axis.label} growth summary`,
      value: declining.length,
      formatted: `${members.length - declining.length} growing, ${declining.length} declining`
    }),
    columns: [
      col.text("entity", axis.label),
      col.money("first", cube.periods[0].label),
      col.money("last", cube.periods[cube.periods.length - 1].label),
      col.money("change", "Change"),
      col.pct("changePct", "Change %"),
      col.status("direction", "Direction")
    ],
    rows,
    redFlag: `RED FLAG — ${declining.length} of ${members.length} ${axis.noun} shrank, giving up ${formatINR(lostRevenue)} of monthly run-rate`,
    narrative: `Measured first month against last, ${declining.length} of ${members.length} ${axis.noun} ended lower than they started, together giving up ${formatINR(lostRevenue)} of monthly run-rate.`,
    costOfInaction: coiFromAmount(lostRevenue.dividedBy(12).times(3), `${formatINR(lostRevenue)} of monthly run-rate lost, pro-rated over 3 months`),
    provenance: { rowsConsidered: members.length }
  });
}

/** L02.A06 — average revenue per period, per member. */
function averagePerPeriod(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params);
  if (!enough) return idleBlock(entry, `no ${axis.noun} with revenue in this period`);

  const rows = members.map((m) => ({
    entity: m.label,
    total: toNumber(m.total),
    average: toNumber(stats.mean(m.series)),
    best: toNumber(stats.peakTrough(m.series).peak),
    worst: toNumber(stats.peakTrough(m.series).trough),
    _drill: drillFor(axis, m)
  }));

  const companyAverage = stats.mean(cube.companySeries());

  // Informational: there is no threshold an average can breach. Evaluated
  // against an empty band list so the block reads GREEN — IDLE is reserved for
  // "not enough data to judge", and this had plenty.
  const ev = evaluate(new Decimal(0), {
    rule: "No threshold — reference measure",
    metric: `average revenue per ${axis.label.toLowerCase()} per period`,
    format: "currency",
    bands: []
  });

  return singleMetricBlock(entry, {
    ev: { ...ev, evaluated: `Reference view — average monthly revenue per ${axis.label.toLowerCase()}` },
    headline: makeHeadline({
      label: "Company average per month",
      value: toNumber(companyAverage),
      formatted: formatINR(companyAverage)
    }),
    columns: [
      col.text("entity", axis.label),
      col.money("total", "Total"),
      col.money("average", "Avg / Month"),
      col.money("best", "Best Month"),
      col.money("worst", "Worst Month")
    ],
    rows,
    narrative: `Average monthly revenue is the planning number — what each ${axis.label.toLowerCase()} can be expected to deliver in a typical month. The spread between best and worst says how much to trust it.`,
    provenance: { rowsConsidered: members.length, periodsUsed: cube.periods.length }
  });
}

/** L02.A07 — each member as a multiple of the smallest. */
function multipleOfSmallest(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2 });
  if (!enough) return idleBlock(entry, `need at least two ${axis.noun} to compare`);

  const smallest = members[members.length - 1];
  const largestMultiple = safeDivide(members[0].total, smallest.total);

  const ev = evaluate(largestMultiple, {
    rule: "Largest more than 4x the smallest = RED",
    metric: "largest-to-smallest multiple",
    format: "ratio",
    bands: [
      { at: 2.5, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 4, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Largest as a multiple of ${smallest.label}`,
      value: toNumber(largestMultiple),
      formatted: largestMultiple === null ? "N/A" : formatRatio(largestMultiple)
    }),
    columns: [col.text("entity", axis.label), col.money("revenue", "Revenue"), col.ratio("multiple", `Multiple of ${smallest.label}`)],
    rows: members.map((m) => ({
      entity: m.label,
      revenue: toNumber(m.total),
      multiple: toNumber(safeDivide(m.total, smallest.total)),
      _drill: drillFor(axis, m)
    })),
    redFlag: `RED FLAG — the largest ${axis.label.toLowerCase()} is ${formatRatio(largestMultiple)} the smallest`,
    narrative: `Expressing every ${axis.label.toLowerCase()} as a multiple of the smallest makes the spread legible at a glance without needing to read the rupee figures.`,
    provenance: { rowsConsidered: members.length }
  });
}

/** L02.A08 — how much revenue sits behind growing vs declining members. */
function revenueByDirection(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to judge direction");

  let growingRevenue = new Decimal(0);
  let decliningRevenue = new Decimal(0);

  const rows = members.map((m) => {
    const slope = stats.linearSlope(m.series);
    const direction = slope === null || slope.isZero() ? "Flat" : slope.isPositive() ? "Growing" : "Declining";
    if (direction === "Growing") growingRevenue = growingRevenue.plus(m.total);
    if (direction === "Declining") decliningRevenue = decliningRevenue.plus(m.total);

    return {
      entity: m.label,
      revenue: toNumber(m.total),
      slope: toNumber(slope),
      direction,
      _status: direction === "Declining" ? STATUS.AMBER : STATUS.GREEN,
      _drill: drillFor(axis, m)
    };
  });

  const decliningWeight = share(decliningRevenue, cube.totals.total);
  const ev = evaluate(decliningWeight, {
    rule: "More than half of revenue on a declining trend = AMBER; more than 70% = RED",
    metric: "revenue attached to declining entities",
    format: "percent",
    bands: [
      { at: 0.50, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.70, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Revenue on a declining trend",
      value: toFraction(decliningWeight),
      formatted: formatPercent(decliningWeight),
      delta: toNumber(decliningRevenue),
      deltaFormatted: formatINR(decliningRevenue)
    }),
    columns: [col.text("entity", axis.label), col.money("revenue", "Revenue"), col.money("slope", "Trend (₹/month)"), col.status("direction", "Direction")],
    rows,
    redFlag: `RED FLAG — ${formatPercent(decliningWeight)} of revenue (${formatINR(decliningRevenue)}) sits with declining ${axis.noun}`,
    narrative: `Counting how many ${axis.noun} are declining understates the risk; weighting by revenue is what matters. ${formatINR(decliningRevenue)} is attached to declining ${axis.noun} against ${formatINR(growingRevenue)} growing.`,
    provenance: { rowsConsidered: members.length }
  });
}

/** L02.A09 — median against mean, to expose skew. */
function medianVsMean(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2 });
  if (!enough) return idleBlock(entry, `need at least two ${axis.noun} to measure skew`);

  const totals = members.map((m) => m.total);
  const meanValue = stats.mean(totals);
  const medianValue = stats.median(totals);
  const skew = meanValue && !meanValue.isZero() ? meanValue.minus(medianValue).dividedBy(meanValue.abs()) : null;

  const ev = evaluate(skew === null ? null : skew.abs(), {
    rule: "Mean more than 20% away from the median = significant skew",
    metric: "skew between mean and median",
    format: "percent",
    bands: [
      { at: 0.20, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.40, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Mean vs median skew",
      value: toFraction(skew),
      formatted: formatPercent(skew, { sign: true })
    }),
    columns: [col.text("metric", "Measure"), col.money("value", "Value")],
    rows: [
      { metric: `Mean ${axis.label} revenue`, value: toNumber(meanValue) },
      { metric: `Median ${axis.label} revenue`, value: toNumber(medianValue) },
      { metric: "Difference", value: toNumber(meanValue && medianValue ? meanValue.minus(medianValue) : null) }
    ],
    redFlag: `RED FLAG — the mean sits ${formatPercent(skew, { sign: true })} away from the median, so a few large ${axis.noun} are pulling the average`,
    narrative: `When the mean sits well above the median, a handful of large ${axis.noun} are carrying the average and the typical ${axis.label.toLowerCase()} is smaller than the headline suggests. Plan against the median.`,
    provenance: { rowsConsidered: members.length }
  });
}

/** L02.A10 — quartile classification, strongest quarter first. */
function quartileClassification(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2 });
  if (!enough) return idleBlock(entry, `need at least two ${axis.noun} to classify`);

  const totals = members.map((m) => m.total);
  const quartiles = stats.quartileByRank(totals);
  const ranks = stats.rankDescending(totals);
  const labels = { 1: "Q1 — Core", 2: "Q2 — Strong", 3: "Q3 — Developing", 4: "Q4 — Marginal" };

  const bottom = members.filter((_, i) => quartiles[i] === 4);
  const bottomRevenue = bottom.reduce((a, m) => a.plus(m.total), new Decimal(0));
  const bottomShare = share(bottomRevenue, cube.totals.total);

  const ev = evaluate(bottomShare === null ? null : new Decimal(1).minus(bottomShare), {
    rule: "Bottom quartile holding under 10% of revenue = concentrated in the top",
    metric: "revenue outside the bottom quartile",
    format: "percent",
    bands: [
      { at: 0.85, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.95, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Bottom-quartile share of revenue",
      value: toFraction(bottomShare),
      formatted: formatPercent(bottomShare)
    }),
    columns: [col.text("entity", axis.label), col.num("rank", "Rank"), col.money("revenue", "Revenue"), col.pct("sharePct", "Share"), col.status("quartile", "Quartile")],
    rows: members.map((m, i) => ({
      entity: m.label,
      rank: ranks[i],
      revenue: toNumber(m.total),
      sharePct: toFraction(share(m.total, cube.totals.total)),
      quartile: labels[quartiles[i]] || "—",
      _status: quartiles[i] === 4 ? STATUS.AMBER : STATUS.GREEN,
      _drill: drillFor(axis, m)
    })),
    redFlag: `RED FLAG — the bottom quartile contributes only ${formatPercent(bottomShare)} of revenue`,
    narrative: `Quartiles turn a ranked list into an action list: Q1 ${axis.noun} are what must be protected, Q4 are where either investment or an exit decision belongs.`,
    provenance: { rowsConsidered: members.length }
  });
}

/* ================================================================== */
/* HHI risk register (lens 9)                                          */
/* ================================================================== */

/**
 * The cells one axis member decomposes into, for concentration purposes.
 *
 * A product's cells are its per-city rows; a city's are its per-product rows.
 * Empty cells are dropped rather than counted as zero — a product a city has
 * never stocked is not a perfectly diversified month pattern, it is an absence,
 * and averaging a zero in would understate every real cell beside it.
 *
 * Any other axis has no second dimension to split on, so it is its own cell.
 */
function concentrationCells(cube, axis, member) {
  const pair = (label, series, total) => ({ label, series, total });

  if (axis.key === "group") {
    return cube.cities
      .map((c) => pair(c, cube.comboSeries(c, member.key), cube.comboTotal(c, member.key)))
      .filter((cell) => !cell.total.isZero());
  }
  if (axis.key === "city") {
    return cube.groups
      .map((g) => pair(g, cube.comboSeries(member.key, g), cube.comboTotal(member.key, g)))
      .filter((cell) => !cell.total.isZero());
  }
  return [pair(member.label, member.series, member.total)];
}

/**
 * Per-member monthly HHI — "does this product's revenue in a typical city land
 * in a few months, or arrive evenly?"
 *
 * MEASURED PER CELL, THEN AVERAGED, which is what sheet 11 Table 1 does:
 * `AVERAGEIFS('02_MAIN_MIS'!$W$5:$W$28, ...)` averages the monthly HHI of each
 * SubCategory x City row within the product. Summing a product across its
 * cities first and taking one HHI is a materially gentler number — city
 * seasonality cancels out against itself — so the split has to happen before
 * the concentration measure, not after. The diversification score is likewise
 * the mean of the cells' own scores, not 1/mean(HHI); the two differ because
 * the reciprocal is not linear.
 */
function hhiRegisterRows(cube, axis, members) {
  return members.map((m) => {
    const cells = concentrationCells(cube, axis, m);
    const indices = cells.map((c) => stats.hhi(c.series)).filter((h) => h !== null);
    const scores = cells.map((c) => stats.diversificationScore(c.series)).filter((d) => d !== null);

    const index = indices.length ? stats.mean(indices) : null;
    const diversification = scores.length ? stats.mean(scores) : null;

    // Peak month stays a property of the member as a whole: it answers "when
    // does this product actually land?", which is a portfolio question, not a
    // per-city one.
    const pt = stats.peakTrough(m.series);
    const peakPeriod = pt ? cube.periods[pt.peakIndex] : null;
    const peakShare = m.total.isZero() || !pt ? null : pt.peak.dividedBy(m.total);

    return { member: m, index, diversification, peakPeriod, peakShare, cellCount: cells.length };
  });
}

/** L09.A01 — the register itself: HHI per product across months. */
function hhiRegister(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to measure monthly concentration");

  const computed = hhiRegisterRows(cube, axis, members);
  const evaluations = [];
  const offenders = [];

  const rows = computed.map(({ member, index, diversification, peakPeriod, peakShare }) => {
    const ev = evaluate(stats.concentrationMultiple(index, cube.periods.length), "HHI", { subject: member.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: member.label, metricFormatted: index && index.toFixed(4) });

    return {
      entity: member.label,
      revenue: toNumber(member.total),
      hhi: toFraction(index),
      diversification: toNumber(diversification),
      peakMonth: peakPeriod ? peakPeriod.label : null,
      peakShare: toFraction(peakShare),
      _status: ev.status,
      _drill: drillFor(axis, member)
    };
  });

  return perEntityBlock(entry, {
    axis,
    columns: [
      col.text("entity", axis.label),
      col.money("revenue", "Revenue"),
      col.num("hhi", "HHI (across months)"),
      col.num("diversification", "Effective Months"),
      col.month("peakMonth", "Peak Month"),
      col.pct("peakShare", "Peak Month Share")
    ],
    rows,
    evaluations,
    offenders,
    headline: makeHeadline({
      label: `${axis.noun} at high monthly concentration`,
      value: offenders.length,
      formatted: `${offenders.length} of ${members.length}`
    }),
    narrative: `This measures whether a ${axis.label.toLowerCase()}'s revenue arrives evenly through the year or lands in a few months. Across ${cube.periods.length} months, a perfectly even spread scores ${(1 / cube.periods.length).toFixed(4)}. High concentration means seasonal dependency — fine if it is predictable, dangerous if it is not.`,
    provenance: { rowsConsidered: members.length, periodsUsed: cube.periods.length }
  });
}

/** L09.A02 — the single most concentrated member. */
function highestHhi(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to measure concentration");

  const computed = hhiRegisterRows(cube, axis, members)
    .filter((r) => r.index !== null)
    .sort((a, b) => b.index.comparedTo(a.index));
  if (!computed.length) return idleBlock(entry, `no ${axis.noun} have enough revenue to measure`);

  const worst = computed[0];
  const ev = evaluate(stats.concentrationMultiple(worst.index, cube.periods.length), "HHI_MEMBER_MAX", { subject: worst.member.label });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Most month-concentrated (${worst.member.label})`,
      value: toFraction(worst.index),
      formatted: worst.index.toFixed(4)
    }),
    columns: [col.text("entity", axis.label), col.num("hhi", "HHI"), col.month("peakMonth", "Peak Month"), col.pct("peakShare", "Peak Share")],
    rows: computed.map(({ member, index, peakPeriod, peakShare }) => ({
      entity: member.label,
      hhi: toFraction(index),
      peakMonth: peakPeriod ? peakPeriod.label : null,
      peakShare: toFraction(peakShare),
      _drill: drillFor(axis, member)
    })),
    redFlag: `RED FLAG — ${worst.member.label} concentrates ${formatPercent(worst.peakShare)} of its revenue in ${worst.peakPeriod && worst.peakPeriod.label}`,
    narrative: `${worst.member.label} has the least even month-to-month revenue. The question to settle is whether that is genuine seasonality, which can be planned around, or irregular one-off orders, which cannot.`,
    provenance: { rowsConsidered: members.length }
  });
}

/** L09.A03 — the portfolio average, and how far the worst sits from it. */
function averagePortfolioHhi(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to measure concentration");

  const computed = hhiRegisterRows(cube, axis, members).filter((r) => r.index !== null);
  if (!computed.length) return idleBlock(entry, `no ${axis.noun} have enough revenue to measure`);

  const average = stats.mean(computed.map((r) => r.index));
  const ev = evaluate(stats.concentrationMultiple(average, cube.periods.length), "HHI_PORTFOLIO_AVERAGE");
  const evenSplit = 1 / cube.periods.length;

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Average portfolio HHI",
      value: toFraction(average),
      formatted: average === null ? "N/A" : average.toFixed(4)
    }),
    columns: [col.text("entity", axis.label), col.num("hhi", "HHI"), col.num("vsAverage", "vs Portfolio Avg")],
    rows: computed.map(({ member, index }) => ({
      entity: member.label,
      hhi: toFraction(index),
      vsAverage: toFraction(average && !average.isZero() ? index.minus(average) : null),
      _drill: drillFor(axis, member)
    })),
    redFlag: `RED FLAG — the portfolio averages ${average && average.toFixed(4)}, above the moderate-concentration threshold`,
    narrative: `Averaging HHI across ${computed.length} ${axis.noun} gives a single portfolio-level read. A perfectly even spread over ${cube.periods.length} months would score ${evenSplit.toFixed(4)}; the portfolio sits at ${average === null ? "N/A" : average.toFixed(4)}.`,
    provenance: { rowsConsidered: computed.length }
  });
}

/** L09.A04 — the spread between the most and least concentrated. */
function hhiSpread(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minMembers: 2, minPeriods: 2 });
  if (!enough) return idleBlock(entry, `need at least two ${axis.noun} to measure a spread`);

  const computed = hhiRegisterRows(cube, axis, members)
    .filter((r) => r.index !== null)
    .sort((a, b) => b.index.comparedTo(a.index));
  if (computed.length < 2) return idleBlock(entry, `need at least two ${axis.noun} with revenue`);

  const worst = computed[0];
  const best = computed[computed.length - 1];
  const spread = worst.index.minus(best.index);

  const ev = evaluate(stats.concentrationMultiple(spread, cube.periods.length), "HHI_SPREAD");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({ label: "HHI spread", value: toFraction(spread), formatted: spread.toFixed(4) }),
    columns: [col.text("entity", axis.label), col.num("hhi", "HHI"), col.status("position", "Position")],
    rows: computed.map(({ member, index }, i) => ({
      entity: member.label,
      hhi: toFraction(index),
      position: i === 0 ? "Most concentrated" : i === computed.length - 1 ? "Most diversified" : "—",
      _drill: drillFor(axis, member)
    })),
    redFlag: `RED FLAG — ${worst.member.label} (${worst.index.toFixed(4)}) and ${best.member.label} (${best.index.toFixed(4)}) behave very differently`,
    narrative: `A wide spread means the portfolio cannot be managed with one seasonal plan: ${worst.member.label} is concentrated where ${best.member.label} is even.`,
    provenance: { rowsConsidered: computed.length }
  });
}

/** L09.A05 — how many members sit above the moderate-concentration line. */
function aboveConcentrationThreshold(cube, entry, params) {
  const limit = new Decimal(params.limit || 0.10);
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to measure concentration");

  const computed = hhiRegisterRows(cube, axis, members).filter((r) => r.index !== null);
  if (!computed.length) return idleBlock(entry, `no ${axis.noun} have enough revenue to measure`);

  const above = computed.filter((r) => r.index.greaterThan(limit));
  const proportion = new Decimal(above.length).dividedBy(computed.length);
  const exposedRevenue = above.reduce((a, r) => a.plus(r.member.total), new Decimal(0));

  const ev = evaluate(proportion, "HHI_ABOVE_MODERATE");

  // The workbook escalates on a single badly concentrated member even when the
  // count stays below half — one product landing 20% of its year in one month
  // is a real exposure regardless of how well behaved its neighbours are.
  const severe = computed.filter((r) => r.index.greaterThan(0.15));
  if (severe.length) {
    ev.status = STATUS.RED;
    ev.severity = "HIGH";
    ev.priority = 2;
    ev.fired = true;
    ev.evaluated = `TRIGGERED — ${severe.length} ${axis.noun} above HHI 0.15`;
  }

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Above HHI ${limit.toFixed(2)}`,
      value: above.length,
      formatted: `${above.length} of ${computed.length} ${axis.noun}`
    }),
    columns: [col.text("entity", axis.label), col.num("hhi", "HHI"), col.money("revenue", "Revenue"), col.status("flag", "Above Threshold")],
    rows: computed.map(({ member, index }) => ({
      entity: member.label,
      hhi: toFraction(index),
      revenue: toNumber(member.total),
      flag: index.greaterThan(limit) ? "Yes" : "No",
      _status: index.greaterThan(limit) ? STATUS.AMBER : STATUS.GREEN,
      _drill: drillFor(axis, member)
    })),
    redFlag: `RED FLAG — ${above.length} ${axis.noun} carrying ${formatINR(exposedRevenue)} are concentrated into a few months`,
    narrative: `${above.length} of ${computed.length} ${axis.noun} sit above HHI ${limit.toFixed(2)}, covering ${formatINR(exposedRevenue)}. That revenue depends on a small number of months landing as expected.`,
    provenance: { rowsConsidered: computed.length, limit: toFraction(limit) }
  });
}

/** L09.A06 — the steadiest member, as the benchmark to copy. */
function mostDiversified(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to measure concentration");

  const computed = hhiRegisterRows(cube, axis, members)
    .filter((r) => r.index !== null)
    .sort((a, b) => a.index.comparedTo(b.index));
  if (!computed.length) return idleBlock(entry, `no ${axis.noun} have enough revenue to measure`);

  const best = computed[0];
  const ev = evaluate(stats.concentrationMultiple(best.index, cube.periods.length), "HHI", { subject: best.member.label });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Steadiest month-to-month (${best.member.label})`,
      value: toFraction(best.index),
      formatted: best.index.toFixed(4),
      delta: toNumber(best.diversification),
      deltaFormatted: best.diversification === null ? null : `${best.diversification.toFixed(1)} effective months`
    }),
    columns: [col.text("entity", axis.label), col.num("hhi", "HHI"), col.num("diversification", "Effective Months"), col.money("revenue", "Revenue")],
    rows: computed.map(({ member, index, diversification }) => ({
      entity: member.label,
      hhi: toFraction(index),
      diversification: toNumber(diversification),
      revenue: toNumber(member.total),
      _drill: drillFor(axis, member)
    })),
    redFlag: null,
    narrative: `${best.member.label} has the most even revenue across the year, behaving like ${best.diversification === null ? "N/A" : best.diversification.toFixed(1)} equally-sized months. It is the benchmark for what predictable demand looks like in this book.`,
    provenance: { rowsConsidered: computed.length }
  });
}

/** L09.A07 — revenue weighted by how concentrated it is. */
function hhiWeightedExposure(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to measure concentration");

  const computed = hhiRegisterRows(cube, axis, members).filter((r) => r.index !== null);
  if (!computed.length) return idleBlock(entry, `no ${axis.noun} have enough revenue to measure`);

  let exposure = new Decimal(0);
  const rows = computed.map(({ member, index }) => {
    const weighted = member.total.times(index);
    exposure = exposure.plus(weighted);
    return {
      entity: member.label,
      revenue: toNumber(member.total),
      hhi: toFraction(index),
      exposure: toNumber(weighted),
      _drill: drillFor(axis, member)
    };
  });

  const exposureShare = share(exposure, cube.totals.total);

  // The workbook measures this as a HEAD COUNT — how many members sit above the
  // portfolio's own average HHI — and keys its trigger off that, not off the
  // rupee exposure. The weighted rupees stay in the table because the title
  // promises them and they are what makes the count actionable.
  const average = stats.mean(computed.map((r) => r.index));
  const aboveAverage = computed.filter((r) => r.index.greaterThan(average));
  const aboveShare = new Decimal(aboveAverage.length).dividedBy(computed.length);
  const ev = evaluate(aboveShare, "HHI_ABOVE_AVERAGE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Above average concentration",
      value: aboveAverage.length,
      formatted: `${aboveAverage.length} of ${computed.length} ${axis.noun}`,
      delta: toNumber(exposure),
      deltaFormatted: `${formatINR(exposure)} concentration-weighted`
    }),
    columns: [col.text("entity", axis.label), col.money("revenue", "Revenue"), col.num("hhi", "HHI"), col.money("exposure", "Weighted Exposure")],
    rows,
    redFlag: `RED FLAG — ${formatINR(exposure)} of revenue is exposed to month-concentration risk`,
    narrative: `Multiplying each ${axis.label.toLowerCase()}'s revenue by its own HHI gives the rupees genuinely at risk from lumpy demand — ${formatINR(exposure)}, or ${formatPercent(exposureShare)} of the book. A small concentrated product matters far less than a large one.`,
    costOfInaction: coiFromAmount(exposure.dividedBy(12).times(3), `${formatINR(exposure)} concentration-weighted exposure, pro-rated over 3 months`),
    provenance: { rowsConsidered: computed.length }
  });
}

/** L09.A08 — distance from a perfectly even spread. */
function diversificationGap(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to measure concentration");

  const computed = hhiRegisterRows(cube, axis, members).filter((r) => r.index !== null);
  if (!computed.length) return idleBlock(entry, `no ${axis.noun} have enough revenue to measure`);

  const ideal = new Decimal(1).dividedBy(cube.periods.length);
  const gaps = computed.map((r) => r.index.minus(ideal));

  // The gap the workbook measures is between the members, not against the even
  // spread: how many times more concentrated the worst member is than the best.
  const ranked = [...computed].sort((a, b) => b.index.comparedTo(a.index));
  const highest = ranked[0].index;
  const lowest = ranked[ranked.length - 1].index;
  const ratio = lowest.isZero() ? null : highest.dividedBy(lowest);

  const ev = evaluate(ratio, "HHI_MAX_MIN_RATIO");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Highest vs lowest member HHI",
      value: toFraction(ratio),
      formatted: ratio === null ? "N/A" : `${ratio.toFixed(2)}x`
    }),
    columns: [col.text("entity", axis.label), col.num("hhi", "HHI"), col.num("ideal", "Even Spread"), col.num("gap", "Gap")],
    rows: computed.map(({ member, index }, i) => ({
      entity: member.label,
      hhi: toFraction(index),
      ideal: toFraction(ideal),
      gap: toFraction(gaps[i]),
      _status: gaps[i].greaterThan(0.15) ? STATUS.AMBER : STATUS.GREEN,
      _drill: drillFor(axis, member)
    })),
    redFlag: `RED FLAG — ${ranked[0].member.label} is ${ratio && ratio.toFixed(2)}x as concentrated as ${ranked[ranked.length - 1].member.label}`,
    narrative: `A perfectly even spread across ${cube.periods.length} months scores ${ideal.toFixed(4)}. A wide ratio between the most and least concentrated ${axis.noun} means one seasonal plan cannot serve the whole portfolio.`,
    provenance: { rowsConsidered: computed.length }
  });
}

/** L09.A09 — a single 0-100 concentration health score. */
function concentrationHealthScore(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to score concentration health");

  const computed = hhiRegisterRows(cube, axis, members).filter((r) => r.index !== null);
  if (!computed.length) return idleBlock(entry, `no ${axis.noun} have enough revenue to measure`);

  const average = stats.mean(computed.map((r) => r.index));
  const ideal = new Decimal(1).dividedBy(cube.periods.length);
  const highest = computed.reduce((a, r) => (r.index.greaterThan(a) ? r.index : a), computed[0].index);
  const aboveModerate = computed.filter((r) => r.index.greaterThan(0.10)).length;

  // The workbook's own scoring: start at 100, dock 10 for every member above
  // moderate concentration, then dock 500x however far the worst member sits
  // above a perfectly even spread. Clamped to 0-100 — the raw formula can run
  // negative on a badly concentrated book, and a negative "health score out of
  // 100" reads as a bug to anyone looking at the card.
  const score = Decimal.max(0, Decimal.min(100,
    new Decimal(100)
      .minus(new Decimal(aboveModerate).times(10))
      .minus(highest.minus(ideal).times(500))));

  const ev = evaluate(new Decimal(100).minus(score), "HHI_HEALTH_SHORTFALL");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Concentration health score",
      value: toNumber(score, 4),
      formatted: `${score.toFixed(0)} / 100`
    }),
    columns: [col.text("metric", "Component"), col.num("value", "Value")],
    rows: [
      { metric: "Average HHI across the portfolio", value: toFraction(average) },
      { metric: "Highest member HHI", value: toFraction(highest) },
      { metric: `Even spread over ${cube.periods.length} months`, value: toFraction(ideal) },
      { metric: `${axis.label}s above moderate concentration (-10 each)`, value: aboveModerate },
      { metric: "Health score (0-100)", value: toNumber(score, 4) }
    ],
    redFlag: `RED FLAG — concentration health scores ${score.toFixed(0)} out of 100`,
    narrative: `The score starts at 100 and docks 10 points for every ${axis.label.toLowerCase()} above moderate concentration, then penalises how far the worst one sits above an even spread across ${cube.periods.length} months. At ${score.toFixed(0)} the book is ${score.greaterThan(70) ? "reasonably spread" : score.greaterThan(50) ? "moderately lumpy" : "heavily concentrated"}.`,
    provenance: { rowsConsidered: computed.length }
  });
}

/** L09.A10 — the revenue available from smoothing the worst offenders. */
function concentrationImprovement(cube, entry, params) {
  const { axis, members, enough } = prepare(cube, params, { minPeriods: 2 });
  if (!enough) return idleBlock(entry, "need at least two periods to measure improvement potential");

  const computed = hhiRegisterRows(cube, axis, members).filter((r) => r.index !== null);
  if (!computed.length) return idleBlock(entry, `no ${axis.noun} have enough revenue to measure`);

  // Excess = how much total concentration the portfolio carries above what a
  // perfectly even book would. Each member contributes 1/periods at best, so
  // the floor for the whole portfolio is members/periods; everything above that
  // is headroom. The per-member rupee shortfall stays in the table as the
  // actionable half of the same question.
  const ideal = new Decimal(1).dividedBy(cube.periods.length);
  const totalIndex = computed.reduce((acc, r) => acc.plus(r.index), new Decimal(0));
  const excess = totalIndex.minus(ideal.times(computed.length));

  let potential = new Decimal(0);
  const rows = computed.map(({ member, index }) => {
    const average = stats.mean(member.series);
    const shortfall = member.series.reduce(
      (acc, v) => (v.lessThan(average) ? acc.plus(average.minus(v)) : acc),
      new Decimal(0)
    );
    potential = potential.plus(shortfall);
    return {
      entity: member.label,
      hhi: toFraction(index),
      excess: toFraction(index.minus(ideal)),
      average: toNumber(average),
      shortfall: toNumber(shortfall),
      _drill: drillFor(axis, member)
    };
  });

  const potentialShare = share(potential, cube.totals.total);
  const ev = evaluate(stats.concentrationMultiple(excess, cube.periods.length), "HHI_EXCESS_TOTAL");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Excess concentration above an even book",
      value: toFraction(excess),
      formatted: excess.toFixed(4),
      delta: toNumber(potential),
      deltaFormatted: `${formatINR(potential)} recoverable by smoothing`
    }),
    columns: [
      col.text("entity", axis.label),
      col.num("hhi", "HHI"),
      col.num("excess", "Above Even Spread"),
      col.money("average", "Avg / Month"),
      col.money("shortfall", "Below-Average Shortfall")
    ],
    rows,
    redFlag: `RED FLAG — the portfolio carries ${excess.toFixed(4)} of concentration above an evenly spread book`,
    narrative: `An evenly spread book of ${computed.length} ${axis.noun} over ${cube.periods.length} months would total ${ideal.times(computed.length).toFixed(4)} in HHI; this one totals ${totalIndex.toFixed(4)}. The ${excess.toFixed(4)} difference is the smoothing headroom, worth ${formatINR(potential)} if every below-average month were lifted to its own average.`,
    costOfInaction: coiFromAmount(potential.dividedBy(12).times(3), `${formatINR(potential)} of below-average months, pro-rated over 3 months`),
    provenance: { rowsConsidered: computed.length }
  });
}

/* ================================================================== */
/* Top-N combinations (lens 10)                                        */
/* ================================================================== */

/** Active combos as { label, revenue, share }, strongest first. */
function rankedCombos(cube) {
  const grand = cube.totals.total;
  return cube
    .allCombos()
    .filter((c) => c.isActive)
    .sort((a, b) => b.revenue.comparedTo(a.revenue))
    .map((c, i) => ({
      rank: i + 1,
      label: `${c.group} x ${c.city}`,
      city: c.city,
      group: c.group,
      revenue: c.revenue,
      share: share(c.revenue, grand)
    }));
}

/** L10.A01/A02/A03/A07 — the top-N Pareto check, parameterised by N. */
function topNConcentration(cube, entry, params) {
  const n = params.n || 3;
  const threshold = params.threshold || "TOP3_CONCENTRATION";
  const combos = rankedCombos(cube);
  if (!combos.length) return idleBlock(entry, "no active product x city combinations");

  const top = combos.slice(0, n);
  const combined = top.reduce((a, c) => a.plus(c.revenue), new Decimal(0));
  const combinedShare = share(combined, cube.totals.total);
  const ev = evaluate(combinedShare, threshold);

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Top ${n} combination${n === 1 ? "" : "s"}`,
      value: toFraction(combinedShare),
      formatted: formatPercent(combinedShare),
      delta: toNumber(combined),
      deltaFormatted: formatINR(combined)
    }),
    columns: [col.num("rank", "Rank"), col.text("combo", "SubCategory x City"), col.money("revenue", "Revenue"), col.pct("sharePct", "Share"), col.pct("cumulative", "Cumulative")],
    rows: (() => {
      let running = new Decimal(0);
      return combos.slice(0, Math.max(n, 10)).map((c) => {
        running = running.plus(c.revenue);
        return {
          rank: c.rank,
          combo: c.label,
          revenue: toNumber(c.revenue),
          sharePct: toFraction(c.share),
          cumulative: toFraction(share(running, cube.totals.total)),
          _status: c.rank <= n ? ev.status : STATUS.GREEN,
          _drill: { type: "product", name: c.group }
        };
      });
    })(),
    redFlag: `RED FLAG — ${top.map((c) => c.label).join(", ")} together carry ${formatPercent(combinedShare)} of all revenue`,
    narrative: `${top.map((c) => c.label).join(", ")} account for ${formatINR(combined)} — ${formatPercent(combinedShare)} of the business. These are the relationships that must not be allowed to lapse; concentration here is a coverage question before it is a strategy question.`,
    provenance: { combosConsidered: combos.length, n }
  });
}

/** L10.A04 — the drop from each rank to the next. */
function adjacentDropoff(cube, entry) {
  const combos = rankedCombos(cube);
  if (combos.length < 2) return idleBlock(entry, "need at least two active combinations to measure a drop-off");

  const rows = combos.slice(0, 10).map((c, i, arr) => {
    const next = arr[i + 1];
    const drop = next ? c.revenue.minus(next.revenue) : null;
    const dropRate = next && !c.revenue.isZero() ? drop.dividedBy(c.revenue) : null;
    return {
      rank: c.rank,
      combo: c.label,
      revenue: toNumber(c.revenue),
      drop: toNumber(drop),
      dropPct: toFraction(dropRate),
      _drill: { type: "product", name: c.group }
    };
  });

  const firstDrop = combos.length > 1
    ? combos[0].revenue.minus(combos[1].revenue).dividedBy(combos[0].revenue.isZero() ? new Decimal(1) : combos[0].revenue)
    : null;

  const ev = evaluate(firstDrop, {
    rule: "Rank 1 more than 25% ahead of rank 2 = top-heavy; more than 50% = RED",
    metric: "drop from rank 1 to rank 2",
    format: "percent",
    bands: [
      { at: 0.25, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.50, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Drop from rank 1 to rank 2",
      value: toFraction(firstDrop),
      formatted: formatPercent(firstDrop)
    }),
    columns: [col.num("rank", "Rank"), col.text("combo", "SubCategory x City"), col.money("revenue", "Revenue"), col.money("drop", "Drop to Next"), col.pct("dropPct", "Drop %")],
    rows,
    redFlag: `RED FLAG — ${combos[0].label} sits ${formatPercent(firstDrop)} clear of the next combination`,
    narrative: `A steep drop between the top ranks means the business has one standout relationship rather than a broad base. A gentle slope is healthier: it means several combinations could absorb a loss.`,
    provenance: { combosConsidered: combos.length }
  });
}

/** L10.A05/A06 — how many distinct cities or products appear in the top N. */
function representationInTopN(cube, entry, params) {
  const n = params.n || 5;
  const facet = params.facet === "group" ? "group" : "city";
  const label = facet === "group" ? "SubCategory" : "City";
  const noun = facet === "group" ? "products" : "cities";
  const universe = facet === "group" ? cube.groups : cube.cities;

  const combos = rankedCombos(cube);
  if (!combos.length) return idleBlock(entry, "no active product x city combinations");

  const top = combos.slice(0, n);
  const present = new Set(top.map((c) => c[facet]));
  const coverageRate = universe.length ? new Decimal(present.size).dividedBy(universe.length) : null;

  // Higher is worse: fewer distinct participants means more concentration.
  const ev = evaluate(coverageRate === null ? null : new Decimal(1).minus(coverageRate), {
    rule: `Top ${n} drawn from under half of all ${noun} = concentrated`,
    metric: `${noun} absent from the top ${n}`,
    format: "percent",
    bands: [
      { at: 0.50, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.70, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  const byFacet = new Map();
  for (const c of top) byFacet.set(c[facet], (byFacet.get(c[facet]) || 0) + 1);

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${label === "City" ? "Cities" : "Products"} represented in the top ${n}`,
      value: present.size,
      formatted: `${present.size} of ${universe.length}`
    }),
    columns: [col.text("entity", label), col.num("appearances", `Appearances in Top ${n}`), col.money("revenue", `Revenue in Top ${n}`)],
    rows: universe.map((name) => ({
      entity: name,
      appearances: byFacet.get(name) || 0,
      revenue: toNumber(top.filter((c) => c[facet] === name).reduce((a, c) => a.plus(c.revenue), new Decimal(0))),
      _status: byFacet.has(name) ? STATUS.GREEN : STATUS.AMBER,
      _drill: { type: facet === "group" ? "product" : "city", name }
    })),
    redFlag: `RED FLAG — only ${present.size} of ${universe.length} ${noun} appear in the top ${n} combinations`,
    narrative: `The top ${n} combinations are drawn from ${present.size} of ${universe.length} ${noun}. The ones absent are either genuinely small or under-developed — worth separating before deciding where to invest.`,
    provenance: { combosConsidered: combos.length, n, facet }
  });
}

/** L10.A08 — the gap between the best and the tenth-best combination. */
function rankGap(cube, entry, params) {
  const from = params.from || 1;
  const to = params.to || 10;
  const combos = rankedCombos(cube);
  if (combos.length < 2) return idleBlock(entry, "need at least two active combinations to measure a gap");

  const high = combos[from - 1];
  const low = combos[Math.min(to, combos.length) - 1];
  const multiple = safeDivide(high.revenue, low.revenue);

  const ev = evaluate(multiple, {
    rule: `Rank ${from} more than 5x rank ${to} = top-heavy; more than 10x = RED`,
    metric: `rank ${from} to rank ${to} multiple`,
    format: "ratio",
    bands: [
      { at: 5, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 10, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Rank ${from} vs rank ${Math.min(to, combos.length)}`,
      value: toNumber(multiple),
      formatted: multiple === null ? "N/A" : formatRatio(multiple)
    }),
    columns: [col.num("rank", "Rank"), col.text("combo", "SubCategory x City"), col.money("revenue", "Revenue")],
    rows: combos.slice(0, Math.min(to, combos.length)).map((c) => ({
      rank: c.rank,
      combo: c.label,
      revenue: toNumber(c.revenue),
      _status: c.rank === from || c.rank === Math.min(to, combos.length) ? STATUS.AMBER : STATUS.GREEN,
      _drill: { type: "product", name: c.group }
    })),
    redFlag: `RED FLAG — ${high.label} earns ${formatRatio(multiple)} what ${low.label} does`,
    narrative: `${high.label} at ${formatINR(high.revenue)} against ${low.label} at ${formatINR(low.revenue)}. A very wide gap says the tail contributes little and effort is better spent protecting the head.`,
    provenance: { combosConsidered: combos.length, from, to }
  });
}

/** L10.A09 — whether one city owns the top combinations. */
function dominanceInTopN(cube, entry, params) {
  const n = params.n || 5;
  const facet = params.facet === "group" ? "group" : "city";
  const label = facet === "group" ? "SubCategory" : "City";

  const combos = rankedCombos(cube);
  if (!combos.length) return idleBlock(entry, "no active product x city combinations");

  const top = combos.slice(0, n);
  const byFacet = new Map();
  for (const c of top) {
    byFacet.set(c[facet], (byFacet.get(c[facet]) || new Decimal(0)).plus(c.revenue));
  }
  const topRevenue = top.reduce((a, c) => a.plus(c.revenue), new Decimal(0));
  const ranked = [...byFacet.entries()].sort((a, b) => b[1].comparedTo(a[1]));
  const leader = ranked[0];
  const leaderShare = share(leader[1], topRevenue);

  const ev = evaluate(leaderShare, {
    rule: `One ${label.toLowerCase()} holding over 50% of the top ${n} = AMBER; over 70% = RED`,
    metric: `leading ${label.toLowerCase()}'s share of the top ${n}`,
    format: "percent",
    bands: [
      { at: 0.50, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.70, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${leader[0]}'s share of the top ${n}`,
      value: toFraction(leaderShare),
      formatted: formatPercent(leaderShare)
    }),
    columns: [col.text("entity", label), col.money("revenue", `Revenue in Top ${n}`), col.pct("sharePct", `Share of Top ${n}`), col.num("combos", "Combinations")],
    rows: ranked.map(([name, revenue]) => ({
      entity: name,
      revenue: toNumber(revenue),
      sharePct: toFraction(share(revenue, topRevenue)),
      combos: top.filter((c) => c[facet] === name).length,
      _status: name === leader[0] ? ev.status : STATUS.GREEN,
      _drill: { type: facet === "group" ? "product" : "city", name }
    })),
    redFlag: `RED FLAG — ${leader[0]} holds ${formatPercent(leaderShare)} of the top ${n} combinations`,
    narrative: `Within the top ${n} combinations, ${leader[0]} accounts for ${formatPercent(leaderShare)}. Concentration inside the head of the book compounds the risk already flagged by the top-N share.`,
    provenance: { combosConsidered: combos.length, n, facet }
  });
}

/** L10.A10 — how little the long tail contributes. */
function tailRisk(cube, entry, params) {
  const headCount = params.head || 5;
  const combos = rankedCombos(cube);
  if (combos.length <= headCount) return idleBlock(entry, `fewer than ${headCount + 1} active combinations — there is no tail to assess`);

  const tail = combos.slice(headCount);
  const tailRevenue = tail.reduce((a, c) => a.plus(c.revenue), new Decimal(0));
  const tailShare = share(tailRevenue, cube.totals.total);

  // Higher is worse: a thinner tail means more rides on the head.
  const ev = evaluate(tailShare === null ? null : new Decimal(1).minus(tailShare), {
    rule: `Tail beyond the top ${headCount} contributing under 25% = AMBER; under 15% = RED`,
    metric: "revenue concentrated in the head",
    format: "percent",
    bands: [
      { at: 0.75, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.85, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Tail beyond the top ${headCount}`,
      value: toFraction(tailShare),
      formatted: formatPercent(tailShare),
      delta: toNumber(tailRevenue),
      deltaFormatted: formatINR(tailRevenue)
    }),
    columns: [col.num("rank", "Rank"), col.text("combo", "SubCategory x City"), col.money("revenue", "Revenue"), col.pct("sharePct", "Share")],
    rows: tail.map((c) => ({
      rank: c.rank,
      combo: c.label,
      revenue: toNumber(c.revenue),
      sharePct: toFraction(c.share),
      _drill: { type: "product", name: c.group }
    })),
    redFlag: `RED FLAG — the ${tail.length} combinations outside the top ${headCount} contribute only ${formatPercent(tailShare)} of revenue`,
    narrative: `${tail.length} combinations sit outside the top ${headCount} and together contribute ${formatINR(tailRevenue)}. A thin tail is not automatically wrong — but it means there is no second line of revenue if a head combination falters.`,
    provenance: { combosConsidered: combos.length, headCount }
  });
}

module.exports = {
  family: FAMILY.CONCENTRATION,
  equalShareBenchmark,
  rankingScaleGap,
  hhiIndex,
  smallestVsLargest,
  growthSummary,
  averagePerPeriod,
  multipleOfSmallest,
  revenueByDirection,
  medianVsMean,
  quartileClassification,
  hhiRegister,
  highestHhi,
  averagePortfolioHhi,
  hhiSpread,
  aboveConcentrationThreshold,
  mostDiversified,
  hhiWeightedExposure,
  diversificationGap,
  concentrationHealthScore,
  concentrationImprovement,
  topNConcentration,
  adjacentDropoff,
  representationInTopN,
  rankGap,
  dominanceInTopN,
  tailRisk
};
