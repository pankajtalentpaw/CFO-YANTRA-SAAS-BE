/**
 * Cost of Inaction and the forward horizons.
 *
 * The formulas are the workbook's own, read off its formula cells rather than
 * inferred from the displayed values (sheet 07, E29:F32):
 *
 *   D                      = endRevenue - startRevenue     (endpoint to endpoint)
 *   Cost of Inaction (3mo) = IF(D < 0, -D / 12 * 3, "N/A -- growing")
 *   Addressable Opp. (6mo) = IF(D < 0, -D * 6, 0)
 *
 * Verified against the workbook: Ahmedabad D = -10,500 gives 2,625 and 63,000;
 * New Delhi D = -47,500 gives 11,875 and 285,000.
 *
 * Note the two are on different bases — the first pro-rates D as if it were an
 * annual figure, the second compounds it as a monthly run-rate. That asymmetry
 * is the workbook's, and it is reproduced rather than corrected because the
 * workbook is the acceptance oracle for all 160 analyses. `basis` on the output
 * states which convention produced each number so a reader is never guessing.
 *
 * Growth is not a cost. A growing entity gets a null amount, never a zero that
 * would sort alongside genuinely assessed entities on the dashboards.
 */

const { Decimal, toDecimal, formatINR } = require("../compute/shared/money");
const { mean } = require("../compute/shared/stats");

const COI_MONTHS = 3;
const OPPORTUNITY_MONTHS = 6;

/**
 * Cost of inaction from an endpoint-to-endpoint change.
 *
 * @param {Decimal|number} change  end minus start; negative means decline
 * @returns {{ amount, amountFormatted, opportunity, opportunityFormatted, basis, horizonMonths, isDeclining }}
 */
function fromChange(change) {
  const delta = toDecimal(change === null || change === undefined ? 0 : change);

  if (!delta.isNegative() || delta.isZero()) {
    return {
      amount: null,
      amountFormatted: null,
      opportunity: new Decimal(0),
      opportunityFormatted: formatINR(0),
      basis: "Not declining — no cost of inaction to recover",
      horizonMonths: COI_MONTHS,
      isDeclining: false
    };
  }

  const magnitude = delta.abs();
  const amount = magnitude.dividedBy(12).times(COI_MONTHS);
  const opportunity = magnitude.times(OPPORTUNITY_MONTHS);

  return {
    amount,
    amountFormatted: formatINR(amount),
    opportunity,
    opportunityFormatted: formatINR(opportunity),
    basis: `${formatINR(magnitude)} decline from first to last month, pro-rated over ${COI_MONTHS} months`,
    horizonMonths: COI_MONTHS,
    isDeclining: true
  };
}

/** Cost of inaction for one series, taken endpoint to endpoint. */
function fromSeries(series) {
  if (!Array.isArray(series) || series.length < 2) {
    return {
      amount: null,
      amountFormatted: null,
      opportunity: new Decimal(0),
      opportunityFormatted: formatINR(0),
      basis: "Not enough periods to measure a change",
      horizonMonths: COI_MONTHS,
      isDeclining: false
    };
  }
  const start = toDecimal(series[0]);
  const end = toDecimal(series[series.length - 1]);
  return fromChange(end.minus(start));
}

/**
 * Total cost of inaction across many entities — only the declining ones
 * contribute, which is what makes the figure defensible as "recoverable".
 */
function aggregate(entries) {
  let amount = new Decimal(0);
  let opportunity = new Decimal(0);
  let decliningCount = 0;

  for (const entry of entries || []) {
    if (!entry || !entry.isDeclining) continue;
    decliningCount++;
    if (entry.amount) amount = amount.plus(entry.amount);
    if (entry.opportunity) opportunity = opportunity.plus(entry.opportunity);
  }

  if (!decliningCount) {
    return {
      amount: null,
      amountFormatted: null,
      opportunity: new Decimal(0),
      opportunityFormatted: formatINR(0),
      basis: "No declining entities — nothing to recover",
      horizonMonths: COI_MONTHS,
      isDeclining: false,
      decliningCount: 0
    };
  }

  return {
    amount,
    amountFormatted: formatINR(amount),
    opportunity,
    opportunityFormatted: formatINR(opportunity),
    basis: `Sum across ${decliningCount} declining ${decliningCount === 1 ? "entity" : "entities"}, pro-rated over ${COI_MONTHS} months`,
    horizonMonths: COI_MONTHS,
    isDeclining: true,
    decliningCount
  };
}

/**
 * The forward horizons the workbook prints as "3-Month View" / "6-Month View" —
 * trailing averages of the series, not projections (sheet 09, B81:B82).
 *
 * A window longer than the series would average a partial window and overstate
 * it, so it returns null instead.
 */
function horizons(series) {
  const list = Array.isArray(series) ? series : [];
  const trailingAverage = (n) => (list.length >= n ? mean(list.slice(list.length - n)) : null);

  const three = trailingAverage(3);
  const six = trailingAverage(6);

  return {
    threeMonth: three,
    threeMonthFormatted: three === null ? null : formatINR(three),
    sixMonth: six,
    sixMonthFormatted: six === null ? null : formatINR(six),
    basis: "Trailing average revenue per month"
  };
}

module.exports = { fromChange, fromSeries, aggregate, horizons, COI_MONTHS, OPPORTUNITY_MONTHS };
