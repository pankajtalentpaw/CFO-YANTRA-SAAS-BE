/**
 * Turns a measured value into a status, a severity and a priority.
 *
 * The whole layer relies on one normalisation, enforced in triggerThresholds.js:
 * every metric is expressed so that HIGHER IS WORSE, with bands ascending. So
 * evaluation is "find the highest band the value reaches" and nothing here has
 * to know which direction a particular metric runs in.
 *
 * A null metric means the data could not support a judgement — a series too
 * short for a 3-month window, a zero denominator, a product with no sales. That
 * is IDLE, deliberately distinct from GREEN. Reporting "all clear" for an
 * analysis that never ran is the one failure mode that would quietly erode
 * trust in all 160.
 */

const { STATUS, SEVERITY } = require("../models/analysisBlock");
const { THRESHOLDS } = require("./triggerThresholds");
const { toDecimal, formatPercent, formatINR, formatRatio, formatNumber, formatPP } = require("../compute/shared/money");

/** Rank statuses so callers can take the worst across many entities. */
const STATUS_RANK = { [STATUS.IDLE]: 0, [STATUS.GREEN]: 1, [STATUS.AMBER]: 2, [STATUS.RED]: 3 };
const SEVERITY_RANK = { [SEVERITY.LOW]: 0, [SEVERITY.MEDIUM]: 1, [SEVERITY.HIGH]: 2, [SEVERITY.CRITICAL]: 3 };

/**
 * Status + severity -> priority 1..5.
 *
 * The workbook's own priorities are inconsistent — it has both "P1 — CRITICAL"
 * and "P1 — IMMEDIATE" for the same numeric rank — so this derives priority
 * from the evaluated result instead of transcribing the label. Deterministic
 * and sortable, which the dashboards need.
 */
function derivePriority(status, severity) {
  if (status === STATUS.IDLE) return 5;
  if (status === STATUS.RED) return severity === SEVERITY.CRITICAL ? 1 : 2;
  if (status === STATUS.AMBER) return 3;
  return 4;
}

/** Render a metric the way its threshold declares it should read. */
function formatMetric(value, format) {
  if (value === null || value === undefined) return null;
  switch (format) {
    case "percent": return formatPercent(value);
    case "pp": return formatPP(value);
    case "currency": return formatINR(value);
    case "ratio": return formatRatio(value);
    case "number": return formatNumber(value, { decimals: Number.isInteger(Number(value.toString())) ? 0 : 2 });
    default: return String(value);
  }
}

/**
 * Evaluate one normalised metric against a named threshold.
 *
 * @param {Decimal|number|null} metricValue higher is worse; null means unknown
 * @param {string|object} threshold         a THRESHOLDS key, or an inline spec
 * @param {object} [options]
 * @param {string} [options.subject]        entity name, for the trigger sentence
 * @returns {{status, severity, priority, fired, rule, metric, metricFormatted, evaluated}}
 */
function evaluate(metricValue, threshold, options = {}) {
  const spec = typeof threshold === "string" ? THRESHOLDS[threshold] : threshold;
  if (!spec) throw new Error(`Unknown threshold "${threshold}"`);

  if (metricValue === null || metricValue === undefined) {
    return {
      status: STATUS.IDLE,
      severity: SEVERITY.LOW,
      priority: 5,
      fired: false,
      rule: spec.rule,
      metric: null,
      metricFormatted: null,
      evaluated: "NOT ASSESSED: not enough data to evaluate this measure"
    };
  }

  const value = toDecimal(metricValue);
  let hit = null;
  for (const b of spec.bands) {
    if (value.greaterThanOrEqualTo(b.at)) hit = b;
  }

  const status = hit ? hit.status : STATUS.GREEN;
  const severity = hit ? hit.severity : SEVERITY.LOW;
  const metricFormatted = formatMetric(value, spec.format);
  const subject = options.subject ? `${options.subject}: ` : "";

  return {
    status,
    severity,
    priority: derivePriority(status, severity),
    fired: Boolean(hit),
    rule: spec.rule,
    metric: value,
    metricFormatted,
    evaluated: hit
      ? `TRIGGERED — ${subject}${spec.metric} at ${metricFormatted}`
      : `NOT TRIGGERED — ${subject}${spec.metric} at ${metricFormatted} is within tolerance`
  };
}

/**
 * Roll many per-entity evaluations into one block-level verdict.
 *
 * The block takes the worst status any entity reached, because a card that says
 * GREEN while one of its rows is RED is worse than useless. `fired` counts how
 * many entities tripped, which is what the red-flag sentence reports.
 */
function worstOf(evaluations, options = {}) {
  const list = (evaluations || []).filter(Boolean);
  if (!list.length) {
    return {
      status: STATUS.IDLE,
      severity: SEVERITY.LOW,
      priority: 5,
      fired: false,
      firedCount: 0,
      assessedCount: 0,
      rule: options.rule || null,
      evaluated: "NOT ASSESSED: no entities had enough data to evaluate"
    };
  }

  let worst = list[0];
  for (const e of list) {
    const better = STATUS_RANK[e.status] > STATUS_RANK[worst.status]
      || (STATUS_RANK[e.status] === STATUS_RANK[worst.status] && SEVERITY_RANK[e.severity] > SEVERITY_RANK[worst.severity]);
    if (better) worst = e;
  }

  const firedCount = list.filter((e) => e.fired).length;
  const assessedCount = list.filter((e) => e.status !== STATUS.IDLE).length;

  // All-IDLE stays IDLE: nothing was actually assessed.
  const status = assessedCount === 0 ? STATUS.IDLE : worst.status;
  const severity = assessedCount === 0 ? SEVERITY.LOW : worst.severity;

  return {
    status,
    severity,
    priority: derivePriority(status, severity),
    fired: firedCount > 0,
    firedCount,
    assessedCount,
    rule: options.rule || worst.rule,
    evaluated: firedCount > 0
      ? `TRIGGERED — ${firedCount} of ${assessedCount} ${options.noun || "entities"} breached the threshold`
      : assessedCount === 0
        ? "NOT ASSESSED: no entities had enough data to evaluate"
        : `NOT TRIGGERED — all ${assessedCount} ${options.noun || "entities"} within tolerance`
  };
}

/**
 * The red-flag sentence. Names the offenders rather than saying "see the table
 * above", which is what the workbook does in a dozen places and which tells a
 * reader nothing when the card is read on its own.
 */
function redFlagText(offenders, { noun = "entities", metricLabel = "", limit = 3 } = {}) {
  if (!offenders || !offenders.length) return null;

  const named = offenders.slice(0, limit).map((o) => {
    const name = o.name || o.label || o.key || "Unknown";
    return o.metricFormatted ? `${name} (${o.metricFormatted})` : name;
  });
  const rest = offenders.length - named.length;
  const tail = rest > 0 ? `, and ${rest} more` : "";
  const label = metricLabel ? ` on ${metricLabel}` : "";

  return offenders.length === 1
    ? `RED FLAG — ${named[0]}${label}`
    : `RED FLAG — ${offenders.length} ${noun}${label}: ${named.join(", ")}${tail}`;
}

module.exports = {
  evaluate,
  worstOf,
  derivePriority,
  redFlagText,
  formatMetric,
  STATUS_RANK,
  SEVERITY_RANK
};
