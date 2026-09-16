/**
 * Statistical primitives shared by the 160 analyses.
 *
 * Excel conventions matter here, because the workbook is the correctness oracle
 * and every value has to land within ±0.01 of it. Two were verified against the
 * workbook's own computed cells rather than assumed:
 *
 *   - Standard deviation is the SAMPLE form (n-1 divisor, Excel STDEV.S).
 *     Ahmedabad's 13 months give 3431.0984 sample vs 3296.4927 population; the
 *     workbook says 3431.0984. Same result for New Delhi and Jaipur.
 *   - Slope is ordinary least squares over evenly spaced x (Excel SLOPE),
 *     reproducing -785.7143, -4741.7582 and 2013.7363 exactly.
 *
 * Every function takes a plain array of Decimal-coercible values already
 * aligned to the dense period axis, so index i is period i with no gaps. That
 * alignment is what makes streaks and regressions meaningful; see period.js.
 */

const { Decimal, toDecimal, safeDivide, growthRate } = require("./money");

/** Coerce a series to Decimals once, so downstream loops stay cheap. */
function toSeries(values) {
  if (!Array.isArray(values)) return [];
  return values.map((v) => toDecimal(v === null || v === undefined ? 0 : v));
}

/* ------------------------------------------------------------------ */
/* Central tendency and spread                                         */
/* ------------------------------------------------------------------ */

function total(values) {
  return toSeries(values).reduce((acc, v) => acc.plus(v), new Decimal(0));
}

function mean(values) {
  const series = toSeries(values);
  if (!series.length) return null;
  return total(series).dividedBy(series.length);
}

function median(values) {
  const series = toSeries(values).slice().sort((a, b) => a.comparedTo(b));
  if (!series.length) return null;
  const mid = Math.floor(series.length / 2);
  return series.length % 2 === 1
    ? series[mid]
    : series[mid - 1].plus(series[mid]).dividedBy(2);
}

/**
 * Sample standard deviation (n-1), matching Excel STDEV.S as used throughout
 * the workbook. A single observation has no spread to measure — null, not zero.
 */
function stdDev(values) {
  const series = toSeries(values);
  if (series.length < 2) return null;
  const m = mean(series);
  const ss = series.reduce((acc, v) => acc.plus(v.minus(m).pow(2)), new Decimal(0));
  return ss.dividedBy(series.length - 1).sqrt();
}

/** Coefficient of variation as a fraction. Null when the mean is zero. */
function coefficientOfVariation(values) {
  const m = mean(values);
  const sd = stdDev(values);
  if (m === null || sd === null || m.isZero()) return null;
  return sd.dividedBy(m.abs());
}

/* ------------------------------------------------------------------ */
/* Trend                                                               */
/* ------------------------------------------------------------------ */

/**
 * Least-squares slope over evenly spaced x — revenue change per period.
 *
 * x is the period index, so the unit is rupees per month. Fewer than two
 * points has no slope; identical x (impossible on a dense axis) would divide
 * by zero and returns null.
 */
function linearSlope(values) {
  const series = toSeries(values);
  const n = series.length;
  if (n < 2) return null;

  let sumX = new Decimal(0);
  let sumY = new Decimal(0);
  let sumXY = new Decimal(0);
  let sumXX = new Decimal(0);

  for (let i = 0; i < n; i++) {
    const x = new Decimal(i + 1);
    sumX = sumX.plus(x);
    sumY = sumY.plus(series[i]);
    sumXY = sumXY.plus(x.times(series[i]));
    sumXX = sumXX.plus(x.times(x));
  }

  const denominator = new Decimal(n).times(sumXX).minus(sumX.times(sumX));
  if (denominator.isZero()) return null;
  return new Decimal(n).times(sumXY).minus(sumX.times(sumY)).dividedBy(denominator);
}

/**
 * Consecutive month-on-month declines.
 *
 * `byIndex[i]` is the streak length as at period i (0 for the first period,
 * which has nothing to compare against) — the running-streak table the workbook
 * prints. `longest` is the maximum, `current` the streak still open at the end.
 * Flat months break a streak: unchanged revenue is not a decline.
 */
function declineStreak(values) {
  const series = toSeries(values);
  const byIndex = new Array(series.length).fill(0);
  if (series.length < 2) return { byIndex, longest: 0, current: 0 };

  let run = 0;
  let longest = 0;
  for (let i = 1; i < series.length; i++) {
    run = series[i].lessThan(series[i - 1]) ? run + 1 : 0;
    byIndex[i] = run;
    if (run > longest) longest = run;
  }
  return { byIndex, longest, current: run };
}

/** The mirror of declineStreak, for growth runs. */
function growthStreak(values) {
  const series = toSeries(values);
  const byIndex = new Array(series.length).fill(0);
  if (series.length < 2) return { byIndex, longest: 0, current: 0 };

  let run = 0;
  let longest = 0;
  for (let i = 1; i < series.length; i++) {
    run = series[i].greaterThan(series[i - 1]) ? run + 1 : 0;
    byIndex[i] = run;
    if (run > longest) longest = run;
  }
  return { byIndex, longest, current: run };
}

/** Growth of the last period over the one before it. */
function latestGrowth(values) {
  const series = toSeries(values);
  if (series.length < 2) return null;
  return growthRate(series[series.length - 1], series[series.length - 2]);
}

/**
 * Trailing window against the window before it — the workbook's "3M vs prior
 * 3M" momentum. Needs 2*window periods; anything shorter would compare against
 * a partial window and overstate the change.
 */
function rollingMomentum(values, window = 3) {
  const series = toSeries(values);
  if (series.length < window * 2 || window < 1) return null;

  const recent = series.slice(series.length - window);
  const prior = series.slice(series.length - window * 2, series.length - window);

  const recentAvg = total(recent).dividedBy(window);
  const priorAvg = total(prior).dividedBy(window);

  return {
    recentAvg,
    priorAvg,
    change: recentAvg.minus(priorAvg),
    changeRate: priorAvg.isZero() ? null : recentAvg.minus(priorAvg).dividedBy(priorAvg.abs())
  };
}

/** Month-on-month growth for every period after the first. */
function momSeries(values) {
  const series = toSeries(values);
  const out = [];
  for (let i = 1; i < series.length; i++) out.push(growthRate(series[i], series[i - 1]));
  return out;
}

/* ------------------------------------------------------------------ */
/* Extremes                                                            */
/* ------------------------------------------------------------------ */

/**
 * Peak, trough, and the swing between them.
 *
 * `ratio` is peak/trough and is null when the trough is zero — the workbook
 * writes "N/A (Trough is 0)" there, and a sentinel like 999.99 would be treated
 * as a real number by every downstream threshold.
 *
 * Ties take the earliest period, so a flat series reports its first month.
 */
function peakTrough(values) {
  const series = toSeries(values);
  if (!series.length) return null;

  let peakIndex = 0;
  let troughIndex = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i].greaterThan(series[peakIndex])) peakIndex = i;
    if (series[i].lessThan(series[troughIndex])) troughIndex = i;
  }

  const peak = series[peakIndex];
  const trough = series[troughIndex];
  return {
    peak,
    peakIndex,
    trough,
    troughIndex,
    swing: peak.minus(trough),
    ratio: trough.isZero() ? null : peak.dividedBy(trough)
  };
}

/** Distance from the historical peak to the latest period. */
function peakToCurrent(values) {
  const series = toSeries(values);
  if (!series.length) return null;

  const pt = peakTrough(series);
  const current = series[series.length - 1];
  const gap = current.minus(pt.peak);
  return {
    peak: pt.peak,
    peakIndex: pt.peakIndex,
    current,
    gap,
    gapRate: pt.peak.isZero() ? null : gap.dividedBy(pt.peak.abs())
  };
}

/* ------------------------------------------------------------------ */
/* Concentration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Herfindahl-Hirschman Index over a set of values, computed from their own
 * shares of their own total. Ranges 1/n (perfectly even) to 1 (one entity).
 * Null when the total is zero — there is no distribution to measure.
 */
function hhi(values) {
  const series = toSeries(values);
  if (!series.length) return null;
  const grand = total(series);
  if (grand.isZero()) return null;

  return series.reduce((acc, v) => {
    const s = v.dividedBy(grand);
    return acc.plus(s.times(s));
  }, new Decimal(0));
}

/**
 * HHI as a MULTIPLE of what a perfectly even spread would score.
 *
 * Raw HHI cannot be compared against a fixed threshold, because its floor moves
 * with the number of members: 13 even months score 0.077, but 4 even cities
 * score 0.25 and 2 even months score 0.5. Judging all three against "0.15 =
 * moderate" flagged perfectly balanced books as concentrated purely for having
 * few members — every 4-city business was RED on city concentration.
 *
 * Dividing by the 1/N floor fixes that: 1.0 is perfectly even whatever N is,
 * 2.0 is twice as concentrated as even, and the thresholds mean one thing.
 */
function concentrationMultiple(hhiValue, memberCount) {
  if (hhiValue === null || hhiValue === undefined || !memberCount || memberCount < 1) return null;
  return toDecimal(hhiValue).times(memberCount);
}

/** 1/HHI — the "effective number of entities" the workbook calls diversification. */
function diversificationScore(values) {
  const h = hhi(values);
  if (h === null || h.isZero()) return null;
  return new Decimal(1).dividedBy(h);
}

/** Combined share of the n largest values. */
function topNShare(values, n) {
  const series = toSeries(values);
  if (!series.length || n < 1) return null;
  const grand = total(series);
  if (grand.isZero()) return null;

  const sorted = series.slice().sort((a, b) => b.comparedTo(a));
  const top = sorted.slice(0, n).reduce((acc, v) => acc.plus(v), new Decimal(0));
  return top.dividedBy(grand);
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Competition ranking (1224) by descending value, matching Excel RANK: equal
 * values share the best rank and the next rank skips accordingly.
 *
 * Returns ranks in the caller's original order.
 */
function rankDescending(values) {
  const series = toSeries(values);
  const order = series
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value.comparedTo(a.value));

  const ranks = new Array(series.length).fill(null);
  for (let i = 0; i < order.length; i++) {
    ranks[order[i].index] = i > 0 && order[i].value.equals(order[i - 1].value)
      ? ranks[order[i - 1].index]
      : i + 1;
  }
  return ranks;
}

/**
 * Quartile bucket 1..4 by descending value — Q1 is the strongest quarter.
 * Used by the workbook's city classification.
 */
function quartileByRank(values) {
  const ranks = rankDescending(values);
  const n = ranks.length;
  if (!n) return [];
  return ranks.map((r) => {
    if (r === null) return null;
    return Math.min(4, Math.floor(((r - 1) * 4) / n) + 1);
  });
}

/* ------------------------------------------------------------------ */
/* Distribution shape                                                  */
/* ------------------------------------------------------------------ */

/** How many entities are growing, declining or flat, by their own slope. */
function growthDeclineBalance(seriesByEntity) {
  let growing = 0;
  let declining = 0;
  let flat = 0;

  for (const values of seriesByEntity || []) {
    const slope = linearSlope(values);
    if (slope === null || slope.isZero()) flat++;
    else if (slope.isPositive()) growing++;
    else declining++;
  }
  return { growing, declining, flat, total: growing + declining + flat };
}

/** Split a period series into first and second half — the front/back-loading test. */
function halves(values) {
  const series = toSeries(values);
  if (series.length < 2) return null;
  const mid = Math.ceil(series.length / 2);
  return { first: series.slice(0, mid), second: series.slice(mid) };
}

module.exports = {
  toSeries,
  total,
  mean,
  median,
  stdDev,
  coefficientOfVariation,
  cv: coefficientOfVariation,
  linearSlope,
  declineStreak,
  growthStreak,
  latestGrowth,
  rollingMomentum,
  momSeries,
  peakTrough,
  peakToCurrent,
  hhi,
  concentrationMultiple,
  diversificationScore,
  topNShare,
  rankDescending,
  quartileByRank,
  growthDeclineBalance,
  halves,
  safeDivide
};
