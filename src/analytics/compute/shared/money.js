/**
 * Decimal arithmetic and Indian-format presentation for the analytics layer.
 *
 * Wraps src/utils/financialDecimal.js rather than replacing it — the precision
 * and rounding config there is the house standard. What this adds is the part
 * analytics specifically needs: division that returns null instead of throwing.
 *
 * Zero denominators are ordinary here, not exceptional: a city with no sales, a
 * product whose trough month is zero, a period with no revenue to take a share
 * of. `divide()` in financialDecimal throws on those, which would take down a
 * whole lens for one empty row. Every ratio in this module returns null instead,
 * and callers render null as "N/A" — the same thing the workbook does.
 */

const {
  Decimal,
  toDecimal,
  round,
  sum
} = require("../../../utils/financialDecimal");

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

const ZERO = new Decimal(0);

/** Division that yields null on a zero/invalid divisor rather than throwing. */
function safeDivide(numerator, denominator) {
  const d = toDecimal(denominator);
  if (d.isZero() || !d.isFinite()) return null;
  const n = toDecimal(numerator);
  if (!n.isFinite()) return null;
  return n.dividedBy(d);
}

/** `part / whole` as a fraction in 0..1 (not a percentage). Null if whole is 0. */
function share(part, whole) {
  return safeDivide(part, whole);
}

/**
 * Growth from `previous` to `current`, as a fraction.
 *
 * A zero base is genuinely undefined, not "infinite growth" — reporting 100%
 * or Infinity for a product that launched this month would fire every trigger
 * in the registry. Callers show "new" for that case.
 */
function growthRate(current, previous) {
  const base = toDecimal(previous);
  if (base.isZero()) return null;
  return toDecimal(current).minus(base).dividedBy(base.abs());
}

/** `a / b`, null when b is zero. Distinct from share() only in intent. */
function ratio(a, b) {
  return safeDivide(a, b);
}

/** Difference in percentage points between two fractions. */
function ppDelta(currentFraction, priorFraction) {
  if (currentFraction === null || priorFraction === null) return null;
  return toDecimal(currentFraction).minus(toDecimal(priorFraction));
}

/* ------------------------------------------------------------------ */
/* JSON boundary                                                       */
/* ------------------------------------------------------------------ */

/**
 * Decimal -> plain number for the API envelope.
 *
 * Everything upstream of here stays in Decimal; this is the single point where
 * precision is deliberately dropped, at the JSON boundary. Money rounds to 2dp,
 * fractions keep more so a 0.0316 CV does not collapse to 0.03.
 */
function toNumber(value, decimalPlaces = 2) {
  if (value === null || value === undefined) return null;
  const d = toDecimal(value);
  if (!d.isFinite()) return null;
  return Number(d.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP).toString());
}

/** As toNumber, but for fractions/ratios where 2dp would lose the signal. */
function toFraction(value, decimalPlaces = 6) {
  return toNumber(value, decimalPlaces);
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const INR_2DP = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₹12,34,567" — Indian digit grouping, whole rupees. */
function formatINR(value, { decimals = 0, sign = false } = {}) {
  if (value === null || value === undefined) return null;
  const d = toDecimal(value);
  if (!d.isFinite()) return null;

  const fmt = decimals === 0 ? INR : INR_2DP;
  const body = fmt.format(Math.abs(Number(d.toFixed(decimals))));
  const negative = d.isNegative() && !d.isZero();
  const prefix = negative ? "-" : sign && !d.isZero() ? "+" : "";
  return `${prefix}₹${body}`;
}

/**
 * "₹1.23 L" / "₹4.56 Cr" — lakhs and crores, as Indian management reporting
 * expects. Below a lakh it falls through to the full figure.
 */
function formatINRCompact(value) {
  if (value === null || value === undefined) return null;
  const d = toDecimal(value);
  if (!d.isFinite()) return null;

  const abs = d.abs();
  const negative = d.isNegative() && !d.isZero();
  const prefix = negative ? "-₹" : "₹";

  if (abs.greaterThanOrEqualTo(1e7)) return `${prefix}${abs.dividedBy(1e7).toFixed(2)} Cr`;
  if (abs.greaterThanOrEqualTo(1e5)) return `${prefix}${abs.dividedBy(1e5).toFixed(2)} L`;
  return formatINR(d);
}

/** A 0..1 fraction as "12.3%". Pass a fraction, never an already-scaled number. */
function formatPercent(fraction, { decimals = 1, sign = false } = {}) {
  if (fraction === null || fraction === undefined) return null;
  const d = toDecimal(fraction);
  if (!d.isFinite()) return null;
  const scaled = d.times(100);
  const prefix = sign && scaled.isPositive() && !scaled.isZero() ? "+" : "";
  return `${prefix}${scaled.toFixed(decimals)}%`;
}

/** Percentage points, for share shifts: "+2.0pp". */
function formatPP(fraction, { decimals = 1 } = {}) {
  if (fraction === null || fraction === undefined) return null;
  const d = toDecimal(fraction);
  if (!d.isFinite()) return null;
  const scaled = d.times(100);
  const prefix = scaled.isPositive() && !scaled.isZero() ? "+" : "";
  return `${prefix}${scaled.toFixed(decimals)}pp`;
}

/** A multiple, as "3.32x". */
function formatRatio(value, { decimals = 2 } = {}) {
  if (value === null || value === undefined) return null;
  const d = toDecimal(value);
  if (!d.isFinite()) return null;
  return `${d.toFixed(decimals)}x`;
}

/** Plain count/number with Indian grouping. */
function formatNumber(value, { decimals = 0 } = {}) {
  if (value === null || value === undefined) return null;
  const d = toDecimal(value);
  if (!d.isFinite()) return null;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(d.toString()));
}

module.exports = {
  Decimal,
  ZERO,
  toDecimal,
  round,
  sum,
  safeDivide,
  share,
  growthRate,
  ratio,
  ppDelta,
  toNumber,
  toFraction,
  formatINR,
  formatINRCompact,
  formatPercent,
  formatPP,
  formatRatio,
  formatNumber
};
