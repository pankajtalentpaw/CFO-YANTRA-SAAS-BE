/**
 * Shared scaffolding for analysis builders.
 *
 * Six compute families assemble the same block shape from the same parts, so
 * the assembly lives here once. A builder's own file should contain only the
 * measurement it is actually responsible for.
 *
 * Two block shapes cover all 160:
 *
 *   perEntityBlock  — one row per axis member, each independently evaluated,
 *                     block status = the worst row. ("Which cities are in
 *                     decline?")
 *   singleMetricBlock — one number for the whole company, evaluated once, with
 *                     a supporting table. ("What share do the top 3 combos
 *                     hold?")
 */

const {
  STATUS, FORMAT, makeBlock, makeHeadline, makeTable, makeCostOfInaction
} = require("../models/analysisBlock");
const { worstOf, redFlagText } = require("./triggerEvaluator");
const { resolveMembers } = require("./axes");
const coi = require("../prescriptive/costOfInaction");
const { Decimal, toNumber, formatINR } = require("../compute/shared/money");

/**
 * A block that could not be computed, saying why.
 *
 * Distinct from GREEN on purpose: an analysis that never ran must never read as
 * "all clear". That single confusion would undermine confidence in all 160.
 */
function idleBlock(entry, reason, extra = {}) {
  return makeBlock(entry, {
    status: STATUS.IDLE,
    priority: 5,
    trigger: { rule: extra.rule || null, evaluated: `NOT ASSESSED: ${reason}`, fired: false },
    provenance: { reason, ...extra.provenance }
  });
}

/** Axis members with series and totals resolved, plus an "is there enough?" flag. */
function prepare(cube, params, { minMembers = 1, minPeriods = 1, includeEmpty = false } = {}) {
  const axis = params.axis;
  if (!axis) throw new Error("builder requires params.axis");
  const members = resolveMembers(cube, axis, { includeEmpty });
  return {
    axis,
    members,
    enough: members.length >= minMembers && cube.periods.length >= minPeriods
  };
}

/** The forward horizons, converted for the JSON envelope. */
function horizonOf(series) {
  if (!series || !series.length) return null;
  const h = coi.horizons(series);
  return {
    threeMonth: toNumber(h.threeMonth),
    threeMonthFormatted: h.threeMonthFormatted,
    sixMonth: toNumber(h.sixMonth),
    sixMonthFormatted: h.sixMonthFormatted,
    basis: h.basis
  };
}

/** A cost of inaction from an already-computed recoverable amount. */
function coiFromAmount(amount, basis, horizonMonths = 3) {
  const d = new Decimal(amount || 0);
  if (d.isZero()) return null;
  return makeCostOfInaction({ amount: d, formatted: formatINR(d), basis, horizonMonths });
}

/** A cost of inaction from the prescriptive calculator's own result object. */
function coiFromResult(result) {
  if (!result || !result.isDeclining || !result.amount) return null;
  return makeCostOfInaction({
    amount: result.amount,
    formatted: result.amountFormatted,
    basis: result.basis,
    horizonMonths: result.horizonMonths
  });
}

/**
 * One row per axis member, block status = the worst row.
 *
 * `offenders` should contain only RED members. AMBER is a watch signal, and the
 * workbook's "N of M" sentences count only the sustained cases — reporting
 * every AMBER as a red flag inflates the count and trains people to ignore it.
 */
function perEntityBlock(entry, {
  axis, columns, rows, evaluations, offenders = [],
  headline, narrative, note, costOfInaction = null, horizonSeries = null, provenance = {}
}) {
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
    costOfInaction,
    horizon: horizonOf(horizonSeries),
    provenance: { ...provenance, assessed: verdict.assessedCount, fired: verdict.firedCount }
  });
}

/**
 * One company-level metric, evaluated once, with a supporting table.
 *
 * @param {object} ev the result of triggerEvaluator.evaluate
 */
function singleMetricBlock(entry, {
  ev, headline, columns, rows, note, redFlag = null,
  narrative, costOfInaction = null, horizonSeries = null, provenance = {}
}) {
  return makeBlock(entry, {
    status: ev.status,
    severity: ev.severity,
    priority: ev.priority,
    trigger: { rule: ev.rule, evaluated: ev.evaluated, fired: ev.fired },
    redFlag: ev.fired ? redFlag : null,
    headline,
    table: columns && rows ? makeTable({ columns, rows, note }) : null,
    narrative,
    costOfInaction,
    horizon: horizonOf(horizonSeries),
    provenance
  });
}

/** Column shorthands, so builders read as a description of the table. */
const col = {
  text: (key, label) => ({ key, label, format: FORMAT.TEXT }),
  money: (key, label) => ({ key, label, format: FORMAT.CURRENCY }),
  pct: (key, label) => ({ key, label, format: FORMAT.PERCENT }),
  pp: (key, label) => ({ key, label, format: FORMAT.PP }),
  num: (key, label) => ({ key, label, format: FORMAT.NUMBER }),
  ratio: (key, label) => ({ key, label, format: FORMAT.RATIO }),
  month: (key, label) => ({ key, label, format: FORMAT.MONTH }),
  status: (key, label) => ({ key, label, format: FORMAT.STATUS })
};

module.exports = {
  idleBlock,
  prepare,
  perEntityBlock,
  singleMetricBlock,
  horizonOf,
  coiFromAmount,
  coiFromResult,
  makeHeadline,
  makeTable,
  col,
  STATUS,
  FORMAT
};
