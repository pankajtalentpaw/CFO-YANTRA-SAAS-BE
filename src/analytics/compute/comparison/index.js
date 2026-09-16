/**
 * Comparison builders — head-to-head pairs and cross-market ranking.
 *
 * Covers lens 7 (product vs product), lens 8 (product ranking by city), lens 13
 * (month vs month) and lens 14 (month ranking by city). Lenses 7 and 13 are the
 * only user-parameterised analyses in the whole report: the owner picks which
 * two entities to compare. Where nothing is picked, they default to the two
 * largest, which is the comparison most people would make first.
 *
 * Ranking is always computed WITHIN each city and then averaged. A product that
 * is second everywhere is a stronger position than one that is first in a small
 * market and fifth in every other, and a plain revenue ranking cannot tell them
 * apart.
 */

const { FAMILY } = require("../../models/analysisBlock");
const { evaluate } = require("../../engine/triggerEvaluator");
const kit = require("../../engine/blockKit");
const stats = require("../shared/stats");
const {
  Decimal, toNumber, toFraction, share, safeDivide,
  formatINR, formatPercent, formatRatio
} = require("../shared/money");

const { idleBlock, perEntityBlock, singleMetricBlock, coiFromAmount, makeHeadline, col, STATUS } = kit;

/* ================================================================== */
/* Pair resolution                                                     */
/* ================================================================== */

/**
 * Resolve the two entities to compare and their per-city breakdown.
 *
 * `params.a` / `params.b` come from the query string (subCatA/subCatB or
 * monthA/monthB). An unrecognised name falls back to the default rather than
 * erroring — the owner mistyping a product should not 500 the lens.
 */
function resolvePair(cube, params) {
  const byMonth = params.mode === "month";

  const universe = byMonth
    ? cube.periods.map((p) => ({ key: p.key, label: p.label }))
    : cube.groups.map((g) => ({ key: g, label: g }));

  // Every head-to-head builder reads the comparison city by city, so a cube
  // with no cities has nothing to compare even when two months exist on the
  // axis — which is exactly the all-zero case.
  if (universe.length < 2 || !cube.cities.length) return null;

  const totalOf = (key) => (byMonth ? cube.periodTotal(key) : cube.groupTotal(key));
  const find = (wanted) => {
    if (!wanted) return null;
    const text = String(wanted).trim().toLowerCase();
    return universe.find((u) => u.label.toLowerCase() === text || u.key.toLowerCase() === text) || null;
  };

  const ranked = [...universe].sort((x, y) => totalOf(y.key).comparedTo(totalOf(x.key)));
  const a = find(params.a) || ranked[0];
  const b = find(params.b) || (ranked.find((u) => u.key !== a.key) || ranked[1]);

  const cityRow = (entity) => cube.cities.map((cityName) => ({
    city: cityName,
    revenue: byMonth
      ? cube.cityPeriodTotal
        ? cube.cityPeriodTotal(cityName, entity.key)
        : (cube.matrix.cityPeriod.get(cityName) || new Map()).get(entity.key) || new Decimal(0)
      : cube.comboTotal(cityName, entity.key)
  }));

  return {
    byMonth,
    label: byMonth ? "Month" : "SubCategory",
    noun: byMonth ? "months" : "products",
    drillType: byMonth ? "month" : "product",
    a: { ...a, total: totalOf(a.key), byCity: cityRow(a) },
    b: { ...b, total: totalOf(b.key), byCity: cityRow(b) },
    universe,
    defaulted: !params.a && !params.b
  };
}

/** Leader, trailer and the gap between them. */
function gapOf(pair) {
  const leader = pair.a.total.greaterThanOrEqualTo(pair.b.total) ? pair.a : pair.b;
  const trailer = leader === pair.a ? pair.b : pair.a;
  const gap = leader.total.minus(trailer.total);
  return { leader, trailer, gap, gapRate: leader.total.isZero() ? null : gap.dividedBy(leader.total) };
}

/** The per-city comparison table both head-to-head lenses render. */
function pairRows(pair) {
  return pair.a.byCity.map((row, i) => {
    const other = pair.b.byCity[i];
    const delta = row.revenue.minus(other.revenue);
    return {
      city: row.city,
      a: toNumber(row.revenue),
      b: toNumber(other.revenue),
      delta: toNumber(delta),
      winner: delta.isZero() ? "Tie" : delta.isPositive() ? pair.a.label : pair.b.label,
      _status: delta.isZero() ? STATUS.GREEN : STATUS.GREEN,
      _drill: { type: "city", name: row.city }
    };
  });
}

function pairColumns(pair) {
  return [
    col.text("city", "City"),
    col.money("a", pair.a.label),
    col.money("b", pair.b.label),
    col.money("delta", "Difference"),
    col.status("winner", "Leader")
  ];
}

/** Note that a pair was auto-selected, so the reader knows it can be changed. */
function pairNote(pair) {
  return pair.defaulted
    ? `Comparing the two largest ${pair.noun} by default — pick any two to compare instead.`
    : null;
}

/* ================================================================== */
/* Head-to-head (lenses 7 and 13)                                      */
/* ================================================================== */

/** A01 — the gap, and whether the two are even comparable in scale. */
function headToHeadGap(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const { leader, trailer, gap, gapRate } = gapOf(pair);
  const ev = evaluate(gapRate, "HEAD_TO_HEAD_GAP");
  const wins = pairRows(pair);

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${pair.a.label} vs ${pair.b.label}`,
      value: toNumber(gap),
      formatted: `${leader.label} leads by ${formatINR(gap)}`,
      delta: toFraction(gapRate),
      deltaFormatted: formatPercent(gapRate)
    }),
    columns: pairColumns(pair),
    rows: wins,
    note: pairNote(pair),
    redFlag: `RED FLAG — ${leader.label} and ${trailer.label} differ by ${formatPercent(gapRate)}, too far apart to compare like for like`,
    narrative: `${leader.label} earns ${formatINR(leader.total)} against ${trailer.label}'s ${formatINR(trailer.total)}, a gap of ${formatPercent(gapRate)}. ${ev.fired ? "At this distance they are not really competing for the same demand, and the comparison is more useful as a scale check than a contest." : "They are close enough in scale for the comparison to be meaningful."}`,
    costOfInaction: coiFromAmount(gap.dividedBy(12).times(3), `${formatINR(gap)} gap between ${leader.label} and ${trailer.label}, pro-rated over 3 months`),
    provenance: { a: pair.a.label, b: pair.b.label, defaulted: pair.defaulted }
  });
}

/** A02 — the same gap expressed as a multiple. */
function headToHeadRatio(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const { leader, trailer } = gapOf(pair);
  const ratio = safeDivide(leader.total, trailer.total);
  const ev = evaluate(ratio, {
    rule: "Leader more than 2x the trailer = different scale; more than 4x = RED",
    metric: "leader-to-trailer multiple",
    format: "ratio",
    bands: [
      { at: 2, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 4, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${leader.label} as a multiple of ${trailer.label}`,
      value: toNumber(ratio),
      formatted: ratio === null ? "N/A" : formatRatio(ratio)
    }),
    columns: pairColumns(pair),
    rows: pairRows(pair),
    note: pairNote(pair),
    redFlag: `RED FLAG — ${leader.label} earns ${formatRatio(ratio)} what ${trailer.label} does`,
    narrative: `Expressed as a multiple, ${leader.label} is ${ratio === null ? "N/A" : formatRatio(ratio)} the size of ${trailer.label}. A multiple above 2x usually means the two serve different demand rather than competing directly.`,
    provenance: { a: pair.a.label, b: pair.b.label }
  });
}

/** A03 — who wins where. */
function dominancePattern(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const rows = pairRows(pair);
  const aWins = rows.filter((r) => r.winner === pair.a.label).length;
  const bWins = rows.filter((r) => r.winner === pair.b.label).length;
  const contested = rows.filter((r) => r.a > 0 && r.b > 0).length;
  const sweepRate = rows.length ? new Decimal(Math.max(aWins, bWins)).dividedBy(rows.length) : null;

  const ev = evaluate(sweepRate, {
    rule: "One entity winning every city = no contest anywhere",
    metric: "share of cities won by the stronger entity",
    format: "percent",
    bands: [
      { at: 0.75, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 1.0, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Cities where ${pair.a.label} leads`,
      value: aWins,
      formatted: `${pair.a.label} ${aWins}, ${pair.b.label} ${bWins}`
    }),
    columns: pairColumns(pair),
    rows,
    note: pairNote(pair),
    redFlag: `RED FLAG — one entity wins every city; there is no market where the other competes`,
    narrative: `${pair.a.label} leads in ${aWins} ${aWins === 1 ? "city" : "cities"}, ${pair.b.label} in ${bWins}. ${contested} ${contested === 1 ? "city has" : "cities have"} both present, which is where the comparison actually means something — elsewhere one simply is not sold.`,
    provenance: { a: pair.a.label, b: pair.b.label, aWins, bWins, contested }
  });
}

/** A04 — how big the gap is in each city. */
function gapMagnitude(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const rows = pair.a.byCity.map((row, i) => {
    const other = pair.b.byCity[i];
    const larger = row.revenue.greaterThanOrEqualTo(other.revenue) ? row.revenue : other.revenue;
    const gap = row.revenue.minus(other.revenue).abs();
    const gapRate = larger.isZero() ? null : gap.dividedBy(larger);
    return {
      city: row.city,
      gap: toNumber(gap),
      gapPct: toFraction(gapRate),
      leader: row.revenue.equals(other.revenue) ? "Tie" : row.revenue.greaterThan(other.revenue) ? pair.a.label : pair.b.label,
      _drill: { type: "city", name: row.city }
    };
  });

  const worst = rows.filter((r) => r.gapPct !== null).sort((a, b) => b.gapPct - a.gapPct)[0] || null;

  // The headline gap is between the two full-period totals — the question is
  // "how far apart are these two overall", and the widest single city answers a
  // narrower one that the table below already covers.
  const larger = pair.a.total.greaterThanOrEqualTo(pair.b.total) ? pair.a.total : pair.b.total;
  const overallGap = larger.isZero() ? null : pair.a.total.minus(pair.b.total).abs().dividedBy(larger);
  const ev = evaluate(overallGap, "HEAD_TO_HEAD_GAP");

  return singleMetricBlock(entry, {
    ev,
    headline: worst
      ? makeHeadline({
        label: `Gap as a share of ${larger === pair.a.total ? pair.a.label : pair.b.label}`,
        value: toFraction(overallGap),
        formatted: formatPercent(overallGap),
        delta: worst.gapPct,
        deltaFormatted: `widest in ${worst.city} at ${formatPercent(worst.gapPct)}`
      })
      : makeHeadline({ label: "Gap magnitude", value: null, formatted: "Not assessed" }),
    columns: [col.text("city", "City"), col.money("gap", "Gap"), col.pct("gapPct", "Gap %"), col.status("leader", "Leader")],
    rows,
    note: pairNote(pair),
    redFlag: worst ? `RED FLAG — the gap reaches ${formatPercent(worst.gapPct)} in ${worst.city}` : null,
    narrative: `Reading the gap city by city separates a uniform difference in scale from a market-specific weakness. A gap that appears in only one city is an execution question; one that appears everywhere is a product question.`,
    provenance: { a: pair.a.label, b: pair.b.label }
  });
}

/** A05 — the single city where the gap is worst, in rupees. */
function largestGapCity(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const rows = pair.a.byCity.map((row, i) => {
    const other = pair.b.byCity[i];
    return { city: row.city, gap: row.revenue.minus(other.revenue).abs(), a: row.revenue, b: other.revenue };
  }).sort((x, y) => y.gap.comparedTo(x.gap));

  const worst = rows[0];
  const totalGap = rows.reduce((acc, r) => acc.plus(r.gap), new Decimal(0));
  const concentration = totalGap.isZero() ? null : worst.gap.dividedBy(totalGap);

  const ev = evaluate(concentration, {
    rule: "One city carrying over half the total gap = localised, not structural",
    metric: "share of the total gap in a single city",
    format: "percent",
    bands: [
      { at: 0.50, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.75, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Largest gap (${worst.city})`,
      value: toNumber(worst.gap),
      formatted: formatINR(worst.gap),
      delta: toFraction(concentration),
      deltaFormatted: formatPercent(concentration)
    }),
    columns: [col.text("city", "City"), col.money("a", pair.a.label), col.money("b", pair.b.label), col.money("gap", "Gap")],
    rows: rows.map((r) => ({
      city: r.city,
      a: toNumber(r.a),
      b: toNumber(r.b),
      gap: toNumber(r.gap),
      _status: r === worst ? STATUS.AMBER : STATUS.GREEN,
      _drill: { type: "city", name: r.city }
    })),
    note: pairNote(pair),
    redFlag: `RED FLAG — ${worst.city} alone accounts for ${formatPercent(concentration)} of the total gap`,
    narrative: `${worst.city} carries the widest gap at ${formatINR(worst.gap)}. Where one city dominates the difference, the fix is local and cheap; where it is spread evenly, the difference is structural.`,
    provenance: { a: pair.a.label, b: pair.b.label }
  });
}

/** A06 — the cities where the smaller entity actually wins. */
function underdogWins(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const { leader, trailer } = gapOf(pair);
  const isA = trailer === pair.a;
  const rows = pairRows(pair).filter((r) => r.winner === trailer.label);
  const winRate = cube.cities.length ? new Decimal(rows.length).dividedBy(cube.cities.length) : null;

  // Higher is worse: the underdog winning nowhere is the weak case.
  const ev = evaluate(winRate === null ? null : new Decimal(1).minus(winRate), {
    rule: "Trailing entity winning no city = no local advantage to build on",
    metric: "cities where the trailing entity does not lead",
    format: "percent",
    bands: [
      { at: 0.75, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 1.0, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Cities where ${trailer.label} leads`,
      value: rows.length,
      formatted: `${rows.length} of ${cube.cities.length}`
    }),
    columns: pairColumns(pair),
    rows: rows.length ? rows : pairRows(pair),
    note: pairNote(pair),
    redFlag: `RED FLAG — ${trailer.label} does not lead in any city against ${leader.label}`,
    narrative: rows.length
      ? `${trailer.label} beats ${leader.label} in ${rows.map((r) => r.city).join(", ")}. Those markets show the trailing ${pair.noun.replace(/s$/, "")} can win, which makes them the template for the rest.`
      : `${trailer.label} does not lead ${leader.label} in any city. Without a single market where it wins, there is no local advantage to build a recovery on.`,
    provenance: { a: pair.a.label, b: pair.b.label, underdog: trailer.label, wins: rows.length }
  });
}

/** A07 — the gap weighted by how much revenue each city carries. */
function revenueWeightedGap(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  let weighted = new Decimal(0);
  const rows = pair.a.byCity.map((row, i) => {
    const other = pair.b.byCity[i];
    const cityTotal = cube.cityTotal(row.city);
    const cityWeight = share(cityTotal, cube.totals.total);
    const gap = row.revenue.minus(other.revenue).abs();
    const contribution = cityWeight ? gap.times(cityWeight) : new Decimal(0);
    weighted = weighted.plus(contribution);
    return {
      city: row.city,
      gap: toNumber(gap),
      weight: toFraction(cityWeight),
      weighted: toNumber(contribution),
      _drill: { type: "city", name: row.city }
    };
  });

  const weightedShare = share(weighted, cube.totals.total);
  const ev = evaluate(weightedShare, {
    rule: "Revenue-weighted gap above 2% of total revenue = material; above 5% = RED",
    metric: "revenue-weighted gap",
    format: "percent",
    bands: [
      { at: 0.02, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.05, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Revenue-weighted gap",
      value: toNumber(weighted),
      formatted: formatINR(weighted)
    }),
    columns: [col.text("city", "City"), col.money("gap", "Raw Gap"), col.pct("weight", "City Weight"), col.money("weighted", "Weighted Gap")],
    rows,
    note: pairNote(pair),
    redFlag: `RED FLAG — the weighted gap reaches ${formatINR(weighted)}`,
    narrative: `A large gap in a small city matters less than a small gap in a large one. Weighting by each city's share of total revenue gives the gap that actually moves the company number.`,
    provenance: { a: pair.a.label, b: pair.b.label }
  });
}

/** A08 — are the two moving in the same direction? */
function growthDirectionComparison(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");
  if (pair.byMonth) return idleBlock(entry, "a single month has no trend of its own to compare");

  const seriesA = cube.groupSeries(pair.a.key);
  const seriesB = cube.groupSeries(pair.b.key);
  const slopeA = stats.linearSlope(seriesA);
  const slopeB = stats.linearSlope(seriesB);

  const diverging = slopeA && slopeB && slopeA.isPositive() !== slopeB.isPositive();
  const worst = slopeA && slopeB ? (slopeA.lessThan(slopeB) ? pair.a : pair.b) : null;
  const worstSlope = slopeA && slopeB ? Decimal.min(slopeA, slopeB) : null;

  const slopeDecline = worstSlope === null ? null : (worstSlope.isNegative() ? worstSlope.negated() : new Decimal(0));
  const referenceAverage = stats.mean(cube.companySeries());
  const slopeShare = slopeDecline === null || referenceAverage === null || referenceAverage.isZero()
    ? null
    : slopeDecline.dividedBy(referenceAverage.abs());
  const ev = evaluate(slopeShare, "NEGATIVE_SLOPE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Trend comparison",
      value: toNumber(slopeA === null || slopeB === null ? null : slopeA.minus(slopeB)),
      formatted: diverging ? "Moving in opposite directions" : "Moving together"
    }),
    columns: [col.text("entity", pair.label), col.money("total", "Revenue"), col.money("slope", "Trend (₹/month)"), col.status("direction", "Direction")],
    rows: [
      { entity: pair.a.label, total: toNumber(pair.a.total), slope: toNumber(slopeA), direction: slopeA === null ? "—" : slopeA.isPositive() ? "Growing" : "Declining", _drill: { type: pair.drillType, name: pair.a.label } },
      { entity: pair.b.label, total: toNumber(pair.b.total), slope: toNumber(slopeB), direction: slopeB === null ? "—" : slopeB.isPositive() ? "Growing" : "Declining", _drill: { type: pair.drillType, name: pair.b.label } }
    ],
    note: pairNote(pair),
    redFlag: worst ? `RED FLAG — ${worst.label} is losing ${formatINR(worstSlope)} a month on trend` : null,
    narrative: diverging
      ? `The two are moving in opposite directions, so today's gap will keep widening on its own. That matters more than the gap's current size.`
      : `Both are moving the same way, so the gap between them is roughly stable. The comparison is about position rather than momentum.`,
    provenance: { a: pair.a.label, b: pair.b.label }
  });
}

/** A09 — are they in the same league at all? */
function scaleDifference(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const { leader, trailer, gap } = gapOf(pair);
  const combined = pair.a.total.plus(pair.b.total);
  const combinedShare = share(combined, cube.totals.total);
  const leaderShareOfPair = combined.isZero() ? null : leader.total.dividedBy(combined);

  const ev = evaluate(leaderShareOfPair, {
    rule: "One entity holding over 65% of the pair = not a like-for-like contest",
    metric: "leader's share of the pair",
    format: "percent",
    bands: [
      { at: 0.65, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.80, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: "Gap as a share of company revenue",
      value: toFraction(share(gap, cube.totals.total)),
      formatted: formatPercent(combinedShare),
      delta: toNumber(combined),
      deltaFormatted: formatINR(combined)
    }),
    columns: [col.text("entity", pair.label), col.money("total", "Revenue"), col.pct("ofPair", "Share of Pair"), col.pct("ofCompany", "Share of Company")],
    rows: [pair.a, pair.b].map((e) => ({
      entity: e.label,
      total: toNumber(e.total),
      ofPair: toFraction(share(e.total, combined)),
      ofCompany: toFraction(share(e.total, cube.totals.total)),
      _drill: { type: pair.drillType, name: e.label }
    })),
    note: pairNote(pair),
    redFlag: `RED FLAG — ${leader.label} holds ${formatPercent(leaderShareOfPair)} of the pair, so this is not a like-for-like contest`,
    narrative: `Together the two account for ${formatPercent(combinedShare)} of company revenue. Within the pair the split is ${formatPercent(leaderShareOfPair)} to ${leader.label}, with ${formatINR(gap)} between them.`,
    provenance: { a: pair.a.label, b: pair.b.label }
  });
}

/** A10 (designed) — what closing the gap would be worth. */
function headToHeadRecovery(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const { leader, trailer } = gapOf(pair);
  const leaderRows = leader === pair.a ? pair.a.byCity : pair.b.byCity;
  const trailerRows = leader === pair.a ? pair.b.byCity : pair.a.byCity;

  // Only cities where the trailer is already present. Closing a gap where it is
  // not sold at all is a distribution decision, not a recovery one.
  let recoverable = new Decimal(0);
  const rows = leaderRows.map((row, i) => {
    const behind = trailerRows[i];
    const present = !behind.revenue.isZero();
    const shortfall = present && row.revenue.greaterThan(behind.revenue) ? row.revenue.minus(behind.revenue) : new Decimal(0);
    recoverable = recoverable.plus(shortfall);
    return {
      city: row.city,
      leaderRevenue: toNumber(row.revenue),
      trailerRevenue: toNumber(behind.revenue),
      recoverable: toNumber(shortfall),
      status: present ? (shortfall.isZero() ? "Already ahead" : "Addressable") : "Not stocked",
      _status: shortfall.isZero() ? STATUS.GREEN : STATUS.AMBER,
      _drill: { type: "city", name: row.city }
    };
  });

  const totalGap = leader.total.minus(trailer.total);
  const recoverableShare = share(recoverable, cube.totals.total);
  const ev = evaluate(recoverableShare, {
    rule: "Addressable gap above 3% of company revenue = worth a plan; above 6% = RED",
    metric: "addressable head-to-head shortfall",
    format: "percent",
    bands: [
      { at: 0.03, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.06, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${trailer.label} shortfall against ${leader.label}`,
      value: toNumber(totalGap),
      formatted: formatINR(totalGap),
      delta: toNumber(recoverable),
      deltaFormatted: `${formatINR(recoverable)} where ${trailer.label} already sells`
    }),
    columns: [
      col.text("city", "City"),
      col.money("leaderRevenue", leader.label),
      col.money("trailerRevenue", trailer.label),
      col.money("recoverable", "Addressable"),
      col.status("status", "Status")
    ],
    rows,
    note: pairNote(pair),
    redFlag: `RED FLAG — ${formatINR(recoverable)} sits between ${trailer.label} and ${leader.label} in cities where both already sell`,
    narrative: `Counting only the cities where ${trailer.label} is already stocked, closing the gap to ${leader.label} would be worth ${formatINR(recoverable)}. Cities marked "Not stocked" are excluded deliberately — putting a product into a new market is a different and larger decision than growing one already there.`,
    costOfInaction: coiFromAmount(recoverable.dividedBy(12).times(3), `${formatINR(recoverable)} addressable shortfall, pro-rated over 3 months`),
    provenance: { a: pair.a.label, b: pair.b.label, derivedAnalysis: true }
  });
}

/* ================================================================== */
/* Ranking across cities (lenses 8 and 14)                             */
/* ================================================================== */

/**
 * Rank every entity within every city.
 *
 * EVERY entity is ranked in every city, including the ones with no revenue
 * there — they tie for last, which is what Excel's RANK does and what sheets 10
 * and 13 are built on. Skipping them would rank a product sold in one city on
 * that city alone, so a single strong market would read as portfolio-wide
 * strength; ranking it last where it does not sell is the more honest reading
 * of "how does this product do across our markets".
 *
 * Ties share the better rank and the next rank is skipped (1, 2, 3, 3, 5),
 * again matching RANK. `absentIn` records where a rank came from no revenue at
 * all, so a card can still distinguish "sells badly here" from "not sold here".
 */
function rankMatrix(cube, params) {
  const byMonth = params.mode === "month";
  const entities = byMonth
    ? cube.periods.map((p) => ({ key: p.key, label: p.label }))
    : cube.groups.map((g) => ({ key: g, label: g }));

  if (!entities.length || !cube.cities.length) return null;

  const valueOf = (cityName, entity) => (byMonth
    ? (cube.matrix.cityPeriod.get(cityName) || new Map()).get(entity.key) || new Decimal(0)
    : cube.comboTotal(cityName, entity.key));

  const ranksByEntity = new Map(entities.map((e) => [e.key, new Map()]));
  const absentIn = new Map(entities.map((e) => [e.key, new Set()]));

  for (const cityName of cube.cities) {
    const values = entities.map((e) => valueOf(cityName, e));
    const ranks = stats.rankDescending(values);
    entities.forEach((e, i) => {
      ranksByEntity.get(e.key).set(cityName, ranks[i]);
      if (values[i].isZero()) absentIn.get(e.key).add(cityName);
    });
  }

  const rows = entities.map((e) => {
    const perCity = ranksByEntity.get(e.key);
    const present = [...perCity.values()].filter((v) => v !== null);
    const avgRank = present.length ? stats.mean(present) : null;
    return {
      ...e,
      total: byMonth ? cube.periodTotal(e.key) : cube.groupTotal(e.key),
      perCity,
      present,
      avgRank,
      absentIn: absentIn.get(e.key),
      bestRank: present.length ? Math.min(...present) : null,
      worstRank: present.length ? Math.max(...present) : null,
      rankSpread: present.length >= 2 ? Math.max(...present) - Math.min(...present) : null
    };
  }).filter((r) => !r.total.isZero());

  return {
    byMonth,
    label: byMonth ? "Month" : "SubCategory",
    noun: byMonth ? "months" : "products",
    drillType: byMonth ? "month" : "product",
    threshold: byMonth ? "MONTH_RANK_WEAK" : "AVERAGE_RANK_WEAK",
    strongAt: byMonth ? 4 : 2,
    weakAt: byMonth ? 10 : 5,
    entities: rows,
    cities: cube.cities
  };
}

function rankColumns(m) {
  return [
    col.text("entity", m.label),
    col.money("revenue", "Revenue"),
    col.num("avgRank", "Avg Rank"),
    ...m.cities.map((c) => col.num(`c_${c}`, c)),
    col.status("strength", "Market Power")
  ];
}

function rankRows(m, classify) {
  return m.entities.map((e) => {
    const row = {
      entity: e.label,
      revenue: toNumber(e.total),
      avgRank: toNumber(e.avgRank, 2),
      strength: classify(e),
      _drill: { type: m.drillType, name: e.label }
    };
    for (const c of m.cities) row[`c_${c}`] = e.perCity.get(c);
    return row;
  });
}

/** A01 — average rank and the STRONG/MIXED/WEAK verdict. */
function rankingConsistency(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const evaluations = [];
  const offenders = [];
  const classify = (e) => {
    if (e.avgRank === null) return "Not ranked";
    if (e.avgRank.lessThanOrEqualTo(m.strongAt)) return "STRONG";
    if (e.avgRank.greaterThanOrEqualTo(m.weakAt)) return "WEAK";
    return "MIXED";
  };

  for (const e of m.entities) {
    const ev = evaluate(e.avgRank, m.threshold, { subject: e.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: e.label, metricFormatted: `avg rank ${e.avgRank && e.avgRank.toFixed(1)}` });
  }

  const rows = rankRows(m, classify);
  const strong = rows.filter((r) => r.strength === "STRONG").length;
  const weak = rows.filter((r) => r.strength === "WEAK").length;

  return perEntityBlock(entry, {
    axis: { label: m.label, noun: m.noun },
    columns: rankColumns(m),
    rows: rows.map((r, i) => ({ ...r, _status: evaluations[i].status })),
    evaluations,
    offenders,
    headline: makeHeadline({
      label: "Market power",
      value: strong,
      formatted: `${strong} strong, ${weak} weak, ${rows.length - strong - weak} mixed`
    }),
    narrative: `Rank is computed inside each city and then averaged, so a ${m.noun.replace(/s$/, "")} that places second everywhere scores better than one that wins a single small market and trails elsewhere. Blank cells mean it was not sold in that city — absence is a coverage fact, not a bad rank, so it is left out of the average.`,
    provenance: { rowsConsidered: m.entities.length, cities: m.cities.length }
  });
}

/** A02 — how much each entity's rank swings between cities. */
function rankDispersion(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const evaluations = [];
  const offenders = [];

  const rows = m.entities.map((e) => {
    const ev = evaluate(e.rankSpread === null ? null : new Decimal(e.rankSpread), {
      rule: "Rank varying by 2 or more places between cities = inconsistent; 4 or more = RED",
      metric: "rank spread across cities",
      format: "number",
      bands: [
        { at: 2, status: STATUS.AMBER, severity: "MEDIUM" },
        { at: 4, status: STATUS.RED, severity: "HIGH" }
      ]
    }, { subject: e.label });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: e.label, metricFormatted: `${e.rankSpread} places` });

    return {
      entity: e.label,
      revenue: toNumber(e.total),
      best: e.present.length ? Math.min(...e.present) : null,
      worst: e.present.length ? Math.max(...e.present) : null,
      spread: e.rankSpread,
      _status: ev.status,
      _drill: { type: m.drillType, name: e.label }
    };
  });

  return perEntityBlock(entry, {
    axis: { label: m.label, noun: m.noun },
    columns: [col.text("entity", m.label), col.money("revenue", "Revenue"), col.num("best", "Best Rank"), col.num("worst", "Worst Rank"), col.num("spread", "Spread")],
    rows,
    evaluations,
    offenders,
    headline: makeHeadline({
      label: "Widest rank swing",
      value: rows.reduce((a, b) => ((b.spread || 0) > (a.spread || 0) ? b : a), rows[0]).spread,
      formatted: `${rows.reduce((a, b) => ((b.spread || 0) > (a.spread || 0) ? b : a), rows[0]).entity} swings ${rows.reduce((a, b) => ((b.spread || 0) > (a.spread || 0) ? b : a), rows[0]).spread} places`
    }),
    narrative: `A wide rank spread means performance depends heavily on the city. That points at execution or coverage differences between territories rather than anything intrinsic to the ${m.noun.replace(/s$/, "")}, which makes it fixable.`,
    provenance: { rowsConsidered: m.entities.length }
  });
}

/** A03 — who takes first place most often. */
function mostFrequentlyTop(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const rows = m.entities.map((e) => ({
    entity: e.label,
    revenue: toNumber(e.total),
    firsts: [...e.perCity.values()].filter((r) => r === 1).length,
    topTwo: [...e.perCity.values()].filter((r) => r !== null && r <= 2).length,
    _drill: { type: m.drillType, name: e.label }
  })).sort((a, b) => b.firsts - a.firsts || b.revenue - a.revenue);

  const leader = rows[0];
  const dominance = m.cities.length ? new Decimal(leader.firsts).dividedBy(m.cities.length) : null;
  const ev = evaluate(dominance, "RANK_LEADER_UBIQUITY");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Most often first (${leader.entity})`,
      value: leader.firsts,
      formatted: `${leader.firsts} of ${m.cities.length} cities`
    }),
    columns: [col.text("entity", m.label), col.money("revenue", "Revenue"), col.num("firsts", "Cities Led"), col.num("topTwo", "Top-2 Finishes")],
    rows: rows.map((r) => ({ ...r, _status: r === leader ? ev.status : STATUS.GREEN })),
    redFlag: `RED FLAG — ${leader.entity} leads ${formatPercent(dominance)} of cities, so the book depends on one ${m.noun.replace(/s$/, "")}`,
    narrative: `${leader.entity} takes first place in ${leader.firsts} of ${m.cities.length} cities. Consistent leadership is a strength, but when one ${m.noun.replace(/s$/, "")} wins nearly everywhere the business has a single engine rather than a portfolio.`,
    provenance: { rowsConsidered: rows.length }
  });
}

/** A04 — the weakest performer overall. */
function weakestOverall(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const ranked = m.entities.filter((e) => e.avgRank !== null).sort((a, b) => b.avgRank.comparedTo(a.avgRank));
  if (!ranked.length) return idleBlock(entry, "no entities could be ranked");

  const worst = ranked[0];

  // Judged as a share of the field, not an absolute rank: averaging 5th is
  // damning out of six and unremarkable out of thirteen.
  const ev = evaluate(worst.avgRank.dividedBy(m.entities.length), "WEAKEST_RANK_SHARE", { subject: worst.label });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Weakest overall (${worst.label})`,
      value: toNumber(worst.avgRank, 2),
      formatted: `avg rank ${worst.avgRank.toFixed(1)}`
    }),
    columns: [col.text("entity", m.label), col.money("revenue", "Revenue"), col.num("avgRank", "Avg Rank"), col.num("cities", "Cities Present")],
    rows: ranked.map((e) => ({
      entity: e.label,
      revenue: toNumber(e.total),
      avgRank: toNumber(e.avgRank, 2),
      cities: e.present.length,
      _status: e === worst ? ev.status : STATUS.GREEN,
      _drill: { type: m.drillType, name: e.label }
    })),
    redFlag: `RED FLAG — ${worst.label} averages rank ${worst.avgRank.toFixed(1)} across the cities it sells in`,
    narrative: `${worst.label} ranks lowest on average at ${worst.avgRank.toFixed(1)}, on ${formatINR(worst.total)} of revenue. A weak rank on meaningful revenue is worth fixing; a weak rank on trivial revenue is worth exiting.`,
    provenance: { rowsConsidered: ranked.length }
  });
}

/** A05 — do the cities agree on the ordering? */
function rankingAgreement(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || m.entities.length < 2 || m.cities.length < 2) return idleBlock(entry, "need at least two entities and two cities to measure agreement");

  const spreads = m.entities.map((e) => e.rankSpread).filter((v) => v !== null);
  if (!spreads.length) return idleBlock(entry, "no entity appears in enough cities to compare rankings");

  // Agreement is a HEAD COUNT: how many entities every city places within one
  // rank of each other. An average spread hides the shape — three entities
  // everyone agrees on plus three nobody does averages the same as six mild
  // disagreements, and those are very different books to run.
  const agreed = m.entities.filter((e) => e.rankSpread !== null && e.rankSpread <= 1);
  const disagreed = m.entities.length - agreed.length;

  const averageSpread = stats.mean(spreads);
  const maxSpread = Math.max(1, m.entities.length - 1);
  const agreement = new Decimal(1).minus(averageSpread.dividedBy(maxSpread));

  // Fires when the cities agree on at most one entity. Stated against this
  // company's entity count rather than a fixed number, so it means the same
  // thing for six products or sixty.
  const ev = evaluate(new Decimal(disagreed), {
    rule: "Cities agreeing on at most one entity's rank = no shared view of the portfolio",
    metric: "entities the cities do not agree on",
    format: "number",
    bands: [{ at: Math.max(1, m.entities.length - 1), status: STATUS.AMBER, severity: "MEDIUM" }]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${m.label}s the cities agree on`,
      value: agreed.length,
      formatted: `${agreed.length} of ${m.entities.length}`,
      delta: toFraction(agreement),
      deltaFormatted: `${formatPercent(agreement)} ordering agreement`
    }),
    columns: [col.text("entity", m.label), col.num("avgRank", "Avg Rank"), col.num("spread", "Rank Spread")],
    rows: m.entities.map((e) => ({
      entity: e.label,
      avgRank: toNumber(e.avgRank, 2),
      spread: e.rankSpread,
      _drill: { type: m.drillType, name: e.label }
    })),
    redFlag: `RED FLAG — the cities agree on the rank of only ${agreed.length} of ${m.entities.length} ${m.noun}`,
    narrative: `High agreement means one national plan works. Low agreement means each city has its own preferences and needs its own assortment and promotion plan — more expensive to run, but ignoring it wastes the spend.`,
    provenance: { rowsConsidered: m.entities.length, cities: m.cities.length }
  });
}

/** A06 — entities that never reach the top N anywhere. */
function neverTopN(cube, entry, params) {
  const n = params.topN || 2;
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const never = m.entities.filter((e) => ![...e.perCity.values()].some((r) => r !== null && r <= n));
  const neverRevenue = never.reduce((a, e) => a.plus(e.total), new Decimal(0));
  const proportion = new Decimal(never.length).dividedBy(m.entities.length);

  const ev = evaluate(proportion, {
    rule: `Over a third of ${m.noun} never reaching the top ${n} = a weak tail; over half = RED`,
    metric: `${m.noun} never in the top ${n}`,
    format: "percent",
    bands: [
      { at: 0.34, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 0.50, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Never in the top ${n}`,
      value: never.length,
      formatted: `${never.length} of ${m.entities.length} ${m.noun}`,
      delta: toNumber(neverRevenue),
      deltaFormatted: formatINR(neverRevenue)
    }),
    columns: [col.text("entity", m.label), col.money("revenue", "Revenue"), col.num("bestRank", "Best Rank Anywhere"), col.status("flag", `In Top ${n}?`)],
    rows: m.entities.map((e) => ({
      entity: e.label,
      revenue: toNumber(e.total),
      bestRank: e.present.length ? Math.min(...e.present) : null,
      flag: never.includes(e) ? `Never top ${n}` : "Yes",
      _status: never.includes(e) ? STATUS.AMBER : STATUS.GREEN,
      _drill: { type: m.drillType, name: e.label }
    })),
    redFlag: `RED FLAG — ${never.length} ${m.noun} carrying ${formatINR(neverRevenue)} never reach the top ${n} in any city`,
    narrative: `${never.length} ${m.noun} never place in the top ${n} anywhere, together worth ${formatINR(neverRevenue)}. Not reaching the top in a single market usually means the offer is uncompetitive rather than under-distributed.`,
    provenance: { rowsConsidered: m.entities.length, n }
  });
}

/** A07 — is leadership concentrated in one entity? */
function dominantConcentration(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const leaders = new Map();
  for (const cityName of m.cities) {
    const winner = m.entities.find((e) => e.perCity.get(cityName) === 1);
    if (winner) leaders.set(winner.label, (leaders.get(winner.label) || 0) + 1);
  }
  const ranked = [...leaders.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return idleBlock(entry, "no city has a clear leader");

  const distinctLeaders = ranked.length;

  // The dominance question is about ONE entity's reach, not about how many
  // leaders there are: a book with two leaders splitting eight cities 7-1 is a
  // concentration story, and counting distinct leaders would call it healthy.
  const topLeaderWins = ranked[0][1];
  const ubiquity = new Decimal(topLeaderWins).dividedBy(m.cities.length);
  const ev = evaluate(ubiquity, "RANK_LEADER_UBIQUITY");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Widest lead across ${m.cities.length} cities`,
      value: toFraction(ubiquity),
      formatted: `${ranked[0][0]} leads ${topLeaderWins} of ${m.cities.length}`,
      delta: distinctLeaders,
      deltaFormatted: `${distinctLeaders} distinct leaders`
    }),
    columns: [col.text("entity", m.label), col.num("cities", "Cities Led")],
    rows: ranked.map(([name, count]) => ({
      entity: name,
      cities: count,
      _status: count > m.cities.length / 2 ? STATUS.AMBER : STATUS.GREEN,
      _drill: { type: m.drillType, name }
    })),
    redFlag: `RED FLAG — ${ranked[0][0]} is first in ${topLeaderWins} of ${m.cities.length} cities`,
    narrative: `${ranked[0][0]} takes first place in ${topLeaderWins} of ${m.cities.length} cities, with ${distinctLeaders} distinct ${m.noun} leading somewhere. One name winning nearly everywhere is a narrow base — profitable while it lasts, and a single point of failure if demand for it moves.`,
    provenance: { rowsConsidered: ranked.length }
  });
}

/** A08 — how varied each city's own preferences are. */
function cityPreferenceDiversity(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  // The score itself: how many DIFFERENT entities take first place somewhere.
  // One leader everywhere means a single national plan and a single point of
  // failure; a different leader in every city means genuinely local markets.
  const leaders = new Map();
  for (const cityName of m.cities) {
    const winner = m.entities.find((e) => e.perCity.get(cityName) === 1);
    if (winner) leaders.set(cityName, winner.label);
  }
  const distinctLeaders = new Set(leaders.values()).size;

  const leaderCounts = new Map();
  for (const name of leaders.values()) leaderCounts.set(name, (leaderCounts.get(name) || 0) + 1);
  const mostShared = leaderCounts.size ? Math.max(...leaderCounts.values()) : 0;
  const sharedRate = m.cities.length ? new Decimal(mostShared).dividedBy(m.cities.length) : null;

  const evaluations = [];
  const offenders = [];

  const rows = cube.cities.map((cityName) => {
    const values = m.entities.map((e) => (params.mode === "month"
      ? (cube.matrix.cityPeriod.get(cityName) || new Map()).get(e.key) || new Decimal(0)
      : cube.comboTotal(cityName, e.key)));
    const active = values.filter((v) => !v.isZero());
    const index = stats.hhi(values);
    const ev = evaluate(stats.concentrationMultiple(index, m.entities.length), "HHI", { subject: cityName });
    evaluations.push(ev);
    if (ev.status === STATUS.RED) offenders.push({ name: cityName, metricFormatted: index && index.toFixed(4) });

    return {
      city: cityName,
      revenue: toNumber(cube.cityTotal(cityName)),
      leader: leaders.get(cityName) || "—",
      active: active.length,
      hhi: toFraction(index),
      effective: toNumber(stats.diversificationScore(values)),
      _status: ev.status,
      _drill: { type: "city", name: cityName }
    };
  });

  return singleMetricBlock(entry, {
    ev: evaluate(sharedRate, "RANK_LEADER_UBIQUITY"),
    columns: [col.text("city", "City"), col.money("revenue", "Revenue"), col.text("leader", `Leading ${m.label}`), col.num("active", `Active ${m.label}s`), col.num("hhi", "HHI"), col.num("effective", `Effective ${m.label}s`)],
    rows,
    redFlag: `RED FLAG — ${mostShared} of ${m.cities.length} cities all put the same ${m.noun.replace(/s$/, "")} first`,
    headline: makeHeadline({
      label: `Distinct leaders across ${m.cities.length} cities`,
      value: distinctLeaders,
      formatted: `${distinctLeaders} of ${m.cities.length} cities have their own leader`
    }),
    narrative: `${distinctLeaders} different ${m.noun} take first place across ${m.cities.length} cities. Few distinct leaders means one national plan works and one product carries the book; many means each market has its own champion, which costs more to serve but is far harder to disrupt. Per-city HHI below restates how concentrated each market's buying is.`,
    provenance: { rowsConsidered: rows.length, distinctLeaders }
  });
}

/** A09 — the risk carried by the lowest-ranked entities. */
function bottomRankedRisk(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const ranked = m.entities.filter((e) => e.avgRank !== null).sort((a, b) => b.avgRank.comparedTo(a.avgRank));
  if (!ranked.length) return idleBlock(entry, "no entities could be ranked");

  // The risk is being bottom of the pile in SEVERAL markets at once, which is a
  // product that has stopped working rather than one bad territory. An average
  // rank cannot separate the two: last place in one city and mid-table in three
  // averages out to something unremarkable.
  const bottomThird = Math.ceil(m.entities.length * (2 / 3));
  const bottomHits = (e) => m.cities.filter((c) => {
    const r = e.perCity.get(c);
    return r !== null && r !== undefined && r > bottomThird;
  }).length;

  const worstEverywhere = ranked.reduce((a, e) => (bottomHits(e) > bottomHits(a) ? e : a), ranked[0]);
  const hits = bottomHits(worstEverywhere);

  // Last place outright, which is a harder fact than "in the bottom third".
  const cityWorstRank = new Map(m.cities.map((c) => [c, Math.max(...m.entities.map((e) => e.perCity.get(c) || 0))]));
  const lastPlaceHits = (e) => m.cities.filter((c) => e.perCity.get(c) === cityWorstRank.get(c)).length;
  const mostLastPlaces = ranked.reduce((a, e) => (lastPlaceHits(e) > lastPlaceHits(a) ? e : a), ranked[0]);
  const lastPlaces = lastPlaceHits(mostLastPlaces);

  const bottomCount = Math.max(1, Math.round(ranked.length / 3));
  const bottom = ranked.slice(0, bottomCount);
  const bottomRevenue = bottom.reduce((a, e) => a.plus(e.total), new Decimal(0));
  const bottomShare = share(bottomRevenue, cube.totals.total);

  const ev = evaluate(new Decimal(hits), "BOTTOM_RANK_UBIQUITY");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Markets where one ${m.noun.replace(/s$/, "")} finishes last`,
      value: lastPlaces,
      formatted: lastPlaces === 0
        ? `No ${m.noun.replace(/s$/, "")} finishes last anywhere`
        : `${mostLastPlaces.label} last in ${lastPlaces} of ${m.cities.length}`,
      delta: hits,
      deltaFormatted: `${worstEverywhere.label} bottom-third in ${hits} of ${m.cities.length}`
    }),
    columns: [col.text("entity", m.label), col.money("revenue", "Revenue"), col.num("avgRank", "Avg Rank"), col.pct("sharePct", "Share of Total")],
    rows: bottom.map((e) => ({
      entity: e.label,
      revenue: toNumber(e.total),
      avgRank: toNumber(e.avgRank, 2),
      sharePct: toFraction(share(e.total, cube.totals.total)),
      _status: STATUS.AMBER,
      _drill: { type: m.drillType, name: e.label }
    })),
    redFlag: `RED FLAG — ${worstEverywhere.label} ranks in the bottom third of ${hits} of ${m.cities.length} cities`,
    narrative: `${mostLastPlaces.label} finishes last in ${lastPlaces} of ${m.cities.length} cities, and ${worstEverywhere.label} sits in the bottom third of ${hits} of ${m.cities.length} — weak in several markets at once rather than in one difficult territory. Behind it, the weakest-ranked third of the portfolio still carries ${formatPercent(bottomShare)} of revenue, which is what makes the ranking worth acting on.`,
    provenance: { rowsConsidered: ranked.length, bottomCount, bottomThird, hits, lastPlaces }
  });
}

/** A10 (designed) — where rank and revenue disagree. */
function rankRevenueDivergence(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || m.entities.length < 2) return idleBlock(entry, "need at least two entities to compare rank against revenue");

  const revenueRanks = stats.rankDescending(m.entities.map((e) => e.total));
  const rows = m.entities.map((e, i) => {
    const byRevenue = revenueRanks[i];
    const byRank = e.avgRank;
    const divergence = byRank === null ? null : new Decimal(byRevenue).minus(byRank);
    return {
      entity: e.label,
      revenue: toNumber(e.total),
      revenueRank: byRevenue,
      avgRank: toNumber(byRank, 2),
      divergence: toNumber(divergence, 2),
      reading: divergence === null ? "—"
        : divergence.greaterThan(1) ? "Wins small markets"
          : divergence.lessThan(-1) ? "Losing where it matters"
            : "Consistent",
      _status: divergence !== null && divergence.lessThan(-1) ? STATUS.AMBER : STATUS.GREEN,
      _drill: { type: m.drillType, name: e.label }
    };
  });

  const worst = rows.filter((r) => r.divergence !== null).sort((a, b) => a.divergence - b.divergence)[0];
  const ev = evaluate(worst && worst.divergence !== null ? new Decimal(Math.max(0, -worst.divergence)) : null, {
    rule: "Ranking 2 or more places worse than revenue implies = losing in the large markets",
    metric: "rank-behind-revenue divergence",
    format: "number",
    bands: [
      { at: 1.5, status: STATUS.AMBER, severity: "MEDIUM" },
      { at: 3, status: STATUS.RED, severity: "HIGH" }
    ]
  });

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: worst ? `Largest divergence (${worst.entity})` : "Rank vs revenue",
      value: worst ? worst.divergence : null,
      formatted: worst ? `${worst.divergence > 0 ? "+" : ""}${worst.divergence} places` : "N/A"
    }),
    columns: [
      col.text("entity", m.label),
      col.money("revenue", "Revenue"),
      col.num("revenueRank", "Rank by Revenue"),
      col.num("avgRank", "Avg Rank in City"),
      col.num("divergence", "Divergence"),
      col.status("reading", "Reading")
    ],
    rows,
    redFlag: worst ? `RED FLAG — ${worst.entity} ranks ${Math.abs(worst.divergence)} places worse in-city than its revenue suggests` : null,
    narrative: `Rank and revenue usually agree. Where a ${m.noun.replace(/s$/, "")} ranks better than its revenue implies, it is winning many small markets. Where it ranks worse, it is losing narrowly in the large ones — the more urgent case, because the revenue at stake is bigger.`,
    provenance: { rowsConsidered: rows.length, derivedAnalysis: true }
  });
}


/* ================================================================== */
/* Period ranking (lens 14)                                            */
/* ================================================================== */

/**
 * Rank rows read the other way round: per CITY across the periods.
 *
 * The lens 8 view asks "where does this product sit across our markets"; three
 * of the lens 14 analyses ask the transpose — "how steadily does this market
 * rank its own months" — which needs each city's row of ranks, not each
 * period's column.
 */
function cityRankRows(m) {
  return m.cities.map((cityName) => ({
    city: cityName,
    ranks: m.entities.map((e) => e.perCity.get(cityName)).filter((r) => r !== null && r !== undefined)
  })).filter((r) => r.ranks.length >= 2);
}

/** The average rank one entity holds across every city. */
function averageRankOf(m, entity) {
  const ranks = m.cities.map((c) => entity.perCity.get(c)).filter((r) => r !== null && r !== undefined);
  return ranks.length ? stats.mean(ranks.map((r) => new Decimal(r))) : null;
}

/**
 * L14.A02 — where the most recent period sits in the ranking.
 *
 * Averaged across cities, so one strong market cannot hide a latest month that
 * ranked badly everywhere else.
 */
function latestPeriodAverageRank(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || m.entities.length < 2) return idleBlock(entry, "need at least two periods to rank");

  const latest = m.entities[m.entities.length - 1];
  const avgRank = averageRankOf(m, latest);
  if (avgRank === null) return idleBlock(entry, "the latest period could not be ranked in any city");

  const rankShare = avgRank.dividedBy(m.entities.length);
  const ev = evaluate(rankShare, "LATEST_PERIOD_RANK_SHARE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${latest.label} average rank across ${m.cities.length} cities`,
      value: toFraction(avgRank),
      formatted: `${avgRank.toFixed(2)} of ${m.entities.length}`,
      delta: toFraction(rankShare),
      deltaFormatted: formatPercent(rankShare)
    }),
    columns: [col.text("city", "City"), col.num("rank", `${latest.label} Rank`), col.money("revenue", "Revenue")],
    rows: m.cities.map((cityName) => ({
      city: cityName,
      rank: latest.perCity.get(cityName),
      revenue: toNumber(params.mode === "month"
        ? (cube.matrix.cityPeriod.get(cityName) || new Map()).get(latest.key) || new Decimal(0)
        : cube.comboTotal(cityName, latest.key)),
      _drill: { type: "city", name: cityName }
    })),
    redFlag: `RED FLAG — ${latest.label} ranks ${avgRank.toFixed(1)} of ${m.entities.length} on average, in the bottom third`,
    narrative: `Across ${m.cities.length} cities, ${latest.label} averages rank ${avgRank.toFixed(2)} out of ${m.entities.length}. A recent period sitting low in its own year is the earliest read on a downturn that revenue totals have not yet made obvious.`,
    provenance: { rowsConsidered: m.cities.length, periodsUsed: m.entities.length }
  });
}

/**
 * L14.A03 — the period that ranks best across all markets.
 *
 * Informational by design: knowing which month is strongest everywhere is a
 * planning input, not a problem, so this never colours itself red.
 */
function strongestOverall(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const scored = m.entities
    .map((e) => ({ entity: e, avgRank: averageRankOf(m, e) }))
    .filter((r) => r.avgRank !== null)
    .sort((a, b) => a.avgRank.comparedTo(b.avgRank));
  if (!scored.length) return idleBlock(entry, "nothing could be ranked");

  const best = scored[0];
  const ev = evaluate(new Decimal(0), {
    rule: "Informational — the strongest period is a planning input, not a risk",
    metric: "best average rank across markets",
    format: "number",
    bands: []
  });
  ev.evaluated = `NOT TRIGGERED — ${best.entity.label} is the strongest ${m.noun.replace(/s$/, "")}, averaging rank ${best.avgRank.toFixed(2)}`;

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Best ${m.noun.replace(/s$/, "")} (${best.entity.label})`,
      value: toFraction(best.avgRank),
      formatted: `avg rank ${best.avgRank.toFixed(2)} of ${m.entities.length}`
    }),
    columns: [col.text("entity", m.label), col.money("revenue", "Revenue"), col.num("avgRank", "Avg Rank")],
    rows: scored.map((r) => ({
      entity: r.entity.label,
      revenue: toNumber(r.entity.total),
      avgRank: toNumber(r.avgRank, 2),
      _status: r === best ? STATUS.GREEN : undefined,
      _drill: { type: m.drillType, name: r.entity.label }
    })),
    narrative: `${best.entity.label} ranks best across the markets, averaging ${best.avgRank.toFixed(2)} of ${m.entities.length}. Averaging the rank rather than the revenue keeps a single large city from deciding the answer on its own — this is the ${m.noun.replace(/s$/, "")} that works everywhere.`,
    provenance: { rowsConsidered: scored.length }
  });
}

/**
 * L14.A05 — how the first period's ranking compares with the last.
 *
 * Positive means the latest period ranks BETTER than the earliest (a smaller
 * rank number), so the sign reads the way an owner expects: up is good.
 */
function firstVsLastRankChange(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || m.entities.length < 2) return idleBlock(entry, "need at least two periods to compare");

  const first = m.entities[0];
  const last = m.entities[m.entities.length - 1];

  const perCity = m.cities.map((cityName) => {
    const a = first.perCity.get(cityName);
    const b = last.perCity.get(cityName);
    return {
      city: cityName,
      firstRank: a,
      lastRank: b,
      improvement: a === null || b === null || a === undefined || b === undefined ? null : a - b,
      _drill: { type: "city", name: cityName }
    };
  });

  const changes = perCity.map((r) => r.improvement).filter((v) => v !== null);
  if (!changes.length) return idleBlock(entry, "neither period could be ranked in any city");
  const average = stats.mean(changes.map((v) => new Decimal(v)));

  // Higher is worse, so the metric is the DETERIORATION: how far the latest
  // period slipped, as a share of the window.
  const drift = average.isNegative() ? average.negated().dividedBy(m.entities.length) : new Decimal(0);
  const ev = evaluate(drift, "RANK_DRIFT_SHARE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${last.label} vs ${first.label} rank change`,
      value: toFraction(average),
      formatted: `${average.greaterThan(0) ? "+" : ""}${average.toFixed(2)} positions`
    }),
    columns: [col.text("city", "City"), col.num("firstRank", `${first.label} Rank`), col.num("lastRank", `${last.label} Rank`), col.num("improvement", "Improvement")],
    rows: perCity.map((r) => ({
      ...r,
      _status: r.improvement === null ? undefined : r.improvement >= 0 ? STATUS.GREEN : STATUS.AMBER
    })),
    redFlag: `RED FLAG — ${last.label} ranks ${average.abs().toFixed(1)} positions worse than ${first.label} on average`,
    narrative: `Comparing the same position a year apart, ${last.label} ranks ${average.greaterThanOrEqualTo(0) ? `${average.toFixed(2)} positions better` : `${average.abs().toFixed(2)} positions worse`} than ${first.label} across ${m.cities.length} cities. Rank rather than revenue is the point: it asks whether the period held its place in its own year, which strips out any overall growth or decline.`,
    provenance: { rowsConsidered: changes.length, periodsUsed: m.entities.length }
  });
}

/**
 * L14.A06 — which market's ranking jumps about the most.
 *
 * A city whose months rank all over the place cannot be forecast from its own
 * history, whatever its total revenue says.
 */
function rankVolatilityByCity(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || m.entities.length < 2) return idleBlock(entry, "need at least two periods to measure volatility");

  const rows = cityRankRows(m).map((r) => {
    const spread = stats.stdDev(r.ranks.map((v) => new Decimal(v)));
    return { city: r.city, periods: r.ranks.length, volatility: spread, _drill: { type: "city", name: r.city } };
  });
  if (!rows.length) return idleBlock(entry, "no city has enough ranked periods to measure volatility");

  const worst = rows.reduce((a, b) => (b.volatility && a.volatility && b.volatility.greaterThan(a.volatility) ? b : a), rows[0]);
  const volatilityShare = worst.volatility === null ? null : worst.volatility.dividedBy(m.entities.length);
  const ev = evaluate(volatilityShare, "RANK_VOLATILITY_SHARE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Most volatile ranking (${worst.city})`,
      value: toFraction(worst.volatility),
      formatted: worst.volatility === null ? "N/A" : `${worst.volatility.toFixed(2)} rank positions`
    }),
    columns: [col.text("city", "City"), col.num("periods", `${m.label}s Ranked`), col.num("volatility", "Rank Std Dev")],
    rows: rows.map((r) => ({
      city: r.city,
      periods: r.periods,
      volatility: toNumber(r.volatility, 2),
      _status: r === worst ? ev.status : STATUS.GREEN,
      _drill: r._drill
    })),
    redFlag: `RED FLAG — ${worst.city} swings ${worst.volatility && worst.volatility.toFixed(1)} rank positions between its best and worst months`,
    narrative: `${worst.city} moves most in the ranking, with a standard deviation of ${worst.volatility === null ? "N/A" : worst.volatility.toFixed(2)} positions across ${m.entities.length} ${m.noun}. A market that reshuffles its own months this much cannot be forecast from its history, so stock and staffing there need a wider buffer than its revenue alone would suggest.`,
    provenance: { rowsConsidered: rows.length, periodsUsed: m.entities.length }
  });
}

/**
 * L14.A07 — how many periods rank near the top in every market.
 *
 * A period that is top-N on average everywhere is a genuinely reliable season;
 * one that is first in a single city and mid-table elsewhere is not.
 */
function consistentlyTopN(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || !m.entities.length) return idleBlock(entry, "no entities with revenue to rank");

  const topN = params.topN || 3;
  const scored = m.entities
    .map((e) => ({ entity: e, avgRank: averageRankOf(m, e) }))
    .filter((r) => r.avgRank !== null);
  if (!scored.length) return idleBlock(entry, "nothing could be ranked");

  const consistent = scored.filter((r) => r.avgRank.lessThanOrEqualTo(topN));

  // Informational. Knowing which periods are dependably strong is a planning
  // input; the workbook states no trigger for it and neither does this. The
  // absence of a strong season is reported in the narrative, not as a red card.
  const ev = evaluate(new Decimal(0), {
    rule: `Informational — ${m.noun} averaging inside the top ${topN} across every market`,
    metric: `${m.noun} that are consistently top ${topN}`,
    format: "number",
    bands: []
  });
  ev.evaluated = consistent.length
    ? `NOT TRIGGERED — ${consistent.length} ${m.noun} average inside the top ${topN} across every city`
    : `NOT TRIGGERED — no ${m.noun.replace(/s$/, "")} averages inside the top ${topN} in every city`;

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Consistently top ${topN} across ${m.cities.length} cities`,
      value: consistent.length,
      formatted: `${consistent.length} of ${m.entities.length} ${m.noun}`
    }),
    columns: [col.text("entity", m.label), col.money("revenue", "Revenue"), col.num("avgRank", "Avg Rank"), col.status("verdict", "Verdict")],
    rows: scored
      .sort((a, b) => a.avgRank.comparedTo(b.avgRank))
      .map((r) => ({
        entity: r.entity.label,
        revenue: toNumber(r.entity.total),
        avgRank: toNumber(r.avgRank, 2),
        verdict: r.avgRank.lessThanOrEqualTo(topN) ? `Top ${topN} everywhere` : "Mixed",
        _status: r.avgRank.lessThanOrEqualTo(topN) ? STATUS.GREEN : undefined,
        _drill: { type: m.drillType, name: r.entity.label }
      })),
    redFlag: `RED FLAG — no ${m.noun.replace(/s$/, "")} averages inside the top ${topN} across all cities`,
    narrative: `${consistent.length} of ${m.entities.length} ${m.noun} average inside the top ${topN} across every city. Those are the ones worth planning around; where the count is zero, the cities have no shared strong season and each needs its own calendar.`,
    provenance: { rowsConsidered: scored.length, topN }
  });
}

/**
 * L14.A08 — are recent periods ranking worse than early ones?
 *
 * Compares the average rank of the last few periods against the first few. Rank
 * rather than revenue, so a business that is growing overall can still show its
 * recent months slipping relative to their own year.
 */
function recentVsHistoricalRank(cube, entry, params) {
  const m = rankMatrix(cube, params);
  const window = params.window || 3;
  if (!m || m.entities.length < window * 2) {
    return idleBlock(entry, `need at least ${window * 2} periods to compare recent against early`);
  }

  const early = m.entities.slice(0, window);
  const recent = m.entities.slice(-window);

  const ranksOf = (list) => list
    .flatMap((e) => m.cities.map((c) => e.perCity.get(c)))
    .filter((r) => r !== null && r !== undefined)
    .map((r) => new Decimal(r));

  const recentAvg = stats.mean(ranksOf(recent));
  const earlyAvg = stats.mean(ranksOf(early));
  if (recentAvg === null || earlyAvg === null) return idleBlock(entry, "not enough ranked periods to compare");

  const drift = recentAvg.minus(earlyAvg);
  const driftShare = drift.isPositive() ? drift.dividedBy(m.entities.length) : new Decimal(0);
  const ev = evaluate(driftShare, "RANK_DRIFT_SHARE");

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Last ${window} ${m.noun} average rank`,
      value: toFraction(recentAvg),
      formatted: `${recentAvg.toFixed(2)} vs ${earlyAvg.toFixed(2)} early`,
      delta: toFraction(drift),
      deltaFormatted: `${drift.greaterThan(0) ? "+" : ""}${drift.toFixed(2)} positions`
    }),
    columns: [col.text("window", "Window"), col.text("periods", m.label + "s"), col.num("avgRank", "Avg Rank")],
    rows: [
      { window: `First ${window}`, periods: early.map((e) => e.label).join(", "), avgRank: toNumber(earlyAvg, 2) },
      { window: `Last ${window}`, periods: recent.map((e) => e.label).join(", "), avgRank: toNumber(recentAvg, 2), _status: drift.greaterThan(0) ? STATUS.AMBER : STATUS.GREEN }
    ],
    redFlag: `RED FLAG — the last ${window} ${m.noun} rank ${drift.toFixed(1)} positions worse than the first ${window}`,
    narrative: `The most recent ${window} ${m.noun} average rank ${recentAvg.toFixed(2)} against ${earlyAvg.toFixed(2)} for the first ${window}. Because this compares ranks and not rupees, it isolates whether recent periods are slipping WITHIN their own year — a signal that survives whatever the overall growth rate is doing.`,
    provenance: { periodsUsed: m.entities.length, window }
  });
}

/**
 * L14.A09 — which market improved its ranking most.
 *
 * Good news by design. The workbook flags this as a GREEN SIGNAL rather than a
 * trigger, and it stays that way here: finding a city that climbed the table is
 * never a reason to colour a card red.
 */
function mostImprovedByRank(cube, entry, params) {
  const m = rankMatrix(cube, params);
  if (!m || m.entities.length < 2) return idleBlock(entry, "need at least two periods to measure improvement");

  const first = m.entities[0];
  const last = m.entities[m.entities.length - 1];

  const rows = m.cities.map((cityName) => {
    const a = first.perCity.get(cityName);
    const b = last.perCity.get(cityName);
    return {
      city: cityName,
      firstRank: a,
      lastRank: b,
      improvement: a === null || b === null || a === undefined || b === undefined ? null : a - b,
      _drill: { type: "city", name: cityName }
    };
  });

  const improvements = rows.filter((r) => r.improvement !== null);
  if (!improvements.length) return idleBlock(entry, "neither period could be ranked in any city");

  const best = improvements.reduce((a, b) => (b.improvement > a.improvement ? b : a), improvements[0]);

  const ev = evaluate(new Decimal(0), {
    rule: "Informational — a city climbing the ranking is a green signal, never a trigger",
    metric: "largest rank improvement",
    format: "number",
    bands: []
  });
  ev.evaluated = best.improvement > 0
    ? `GREEN SIGNAL — ${best.city} improved ${best.improvement} rank positions from ${first.label} to ${last.label}`
    : `NOT TRIGGERED — no city improved its ranking between ${first.label} and ${last.label}`;

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `Largest rank improvement (${best.city})`,
      value: best.improvement,
      formatted: `${best.improvement > 0 ? "+" : ""}${best.improvement} positions`
    }),
    columns: [col.text("city", "City"), col.num("firstRank", `${first.label} Rank`), col.num("lastRank", `${last.label} Rank`), col.num("improvement", "Improvement")],
    rows: rows.map((r) => ({
      ...r,
      _status: r.improvement === null ? undefined : r.improvement > 0 ? STATUS.GREEN : undefined
    })),
    narrative: best.improvement > 0
      ? `${best.city} climbed ${best.improvement} places between ${first.label} and ${last.label} — the clearest improvement in the book, and worth understanding well enough to repeat elsewhere.`
      : `No city improved its ranking between ${first.label} and ${last.label}. Where every market has slipped or held, the cause is more likely to be company-wide than local.`,
    provenance: { rowsConsidered: improvements.length }
  });
}

/**
 * L13.A07 — what the two periods are worth together.
 *
 * Informational, and deliberately so: a combined total is context for the
 * comparison above it — how much of the year these two periods actually
 * represent — not a test that anything can fail.
 */
function combinedTotal(cube, entry, params) {
  const pair = resolvePair(cube, params);
  if (!pair) return idleBlock(entry, "need at least two entities to compare");

  const combined = pair.a.total.plus(pair.b.total);
  const combinedShare = share(combined, cube.totals.total);

  const ev = evaluate(new Decimal(0), {
    rule: "Informational — the combined total is context, not a test",
    metric: "combined revenue of the two periods",
    format: "currency",
    bands: []
  });
  ev.evaluated = `NOT TRIGGERED — ${pair.a.label} and ${pair.b.label} together are worth ${formatINR(combined)}`;

  return singleMetricBlock(entry, {
    ev,
    headline: makeHeadline({
      label: `${pair.a.label} and ${pair.b.label} combined`,
      value: toNumber(combined),
      formatted: formatINR(combined),
      delta: toFraction(combinedShare),
      deltaFormatted: `${formatPercent(combinedShare)} of company revenue`
    }),
    columns: [col.text("entity", pair.label), col.money("revenue", "Revenue"), col.pct("sharePct", "Share of Company")],
    rows: [
      { entity: pair.a.label, revenue: toNumber(pair.a.total), sharePct: toFraction(share(pair.a.total, cube.totals.total)), _drill: { type: pair.drillType, name: pair.a.label } },
      { entity: pair.b.label, revenue: toNumber(pair.b.total), sharePct: toFraction(share(pair.b.total, cube.totals.total)), _drill: { type: pair.drillType, name: pair.b.label } },
      { entity: "Combined", revenue: toNumber(combined), sharePct: toFraction(combinedShare) }
    ],
    narrative: `${pair.a.label} and ${pair.b.label} together account for ${formatINR(combined)}, ${formatPercent(combinedShare)} of company revenue. That share is what decides how much the comparison above actually matters: a wide gap between two ${pair.noun} carrying a tenth of the book is a smaller problem than a narrow one between two carrying half.`,
    provenance: { rowsConsidered: 2, defaulted: pair.defaulted }
  });
}

module.exports = {
  family: FAMILY.COMPARISON,
  combinedTotal,
  latestPeriodAverageRank,
  strongestOverall,
  firstVsLastRankChange,
  rankVolatilityByCity,
  consistentlyTopN,
  recentVsHistoricalRank,
  mostImprovedByRank,
  headToHeadGap,
  headToHeadRatio,
  dominancePattern,
  gapMagnitude,
  largestGapCity,
  underdogWins,
  revenueWeightedGap,
  growthDirectionComparison,
  scaleDifference,
  headToHeadRecovery,
  rankingConsistency,
  rankDispersion,
  mostFrequentlyTop,
  weakestOverall,
  rankingAgreement,
  neverTopN,
  dominantConcentration,
  cityPreferenceDiversity,
  bottomRankedRisk,
  rankRevenueDivergence
};
