/**
 * FACT_SALES reconciliation.
 *
 * Compares SUM(FACT_SALES.SalesAmount) against the Tally sales ledger control
 * total. This is a sanity check on the generated dataset — the Trial Balance is
 * never a source for individual FACT_SALES rows.
 */

const { toDecimal, toDecimalString } = require("../../../utils/financialDecimal");

const RECONCILIATION_STATUS = Object.freeze({
  RECONCILED: "RECONCILED",
  WITHIN_TOLERANCE: "WITHIN_TOLERANCE",
  MATERIAL_DIFFERENCE: "MATERIAL_DIFFERENCE",
  CONTROL_TOTAL_UNAVAILABLE: "CONTROL_TOTAL_UNAVAILABLE"
});

/** Ledgers classified as income/sales are the control total for sales. */
function isSalesLedger(ledger) {
  if (!ledger) return false;
  if (ledger.classification === "INCOME") return true;
  return /\bsales\b/i.test(String(ledger.parent || "")) || /\bsales\b/i.test(String(ledger.name || ""));
}

/**
 * Sum the closing balances of the sales ledgers for one company.
 * Returns null when no sales ledger carries a usable balance — an absent
 * control total must not be reported as a zero control total.
 *
 * @param {Array} ledgers Canonical Ledger records
 * @param {string} companyId
 * @returns {string|null} Decimal string, or null when unavailable
 */
function deriveSalesControlTotal(ledgers = [], companyId) {
  let total = toDecimal(0);
  let found = false;

  for (const ledger of ledgers) {
    if (!ledger || ledger.sourceCompanyId !== companyId) continue;
    if (!isSalesLedger(ledger)) continue;
    // Only an explicitly extracted closing balance counts. Falling back to an
    // opening balance (or an implicit zero) would manufacture a control total
    // and let an empty dataset report itself as reconciled.
    if (!ledger.closingBalance || ledger.closingBalance.amount === undefined || ledger.closingBalance.amount === null) continue;
    total = total.plus(toDecimal(ledger.closingBalance.amount).abs());
    found = true;
  }

  return found ? toDecimalString(total) : null;
}

/**
 * Reconcile generated FACT_SALES rows against a Tally control total.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {Array} params.rows FACT_SALES rows
 * @param {string|number|null} params.controlTotal Tally sales total, null if unavailable
 * @param {number} [params.tolerance=0.01] Absolute tolerance for rounding noise
 * @returns {{companyId, expected, actual, difference, status, reconciled, tolerance}}
 */
function reconcileFactSales({ companyId, rows = [], controlTotal, tolerance = 0.01 }) {
  const actual = rows.reduce((sum, row) => sum.plus(toDecimal(row.SalesAmount || 0)), toDecimal(0));

  if (controlTotal === null || controlTotal === undefined || controlTotal === "") {
    return {
      companyId,
      expected: null,
      actual: toDecimalString(actual),
      difference: null,
      status: RECONCILIATION_STATUS.CONTROL_TOTAL_UNAVAILABLE,
      // Absent evidence is not evidence of correctness.
      reconciled: false,
      tolerance
    };
  }

  const expected = toDecimal(controlTotal).abs();
  const difference = actual.minus(expected);
  const absDifference = difference.abs();

  let status;
  if (absDifference.isZero()) status = RECONCILIATION_STATUS.RECONCILED;
  else if (absDifference.lessThanOrEqualTo(toDecimal(tolerance))) status = RECONCILIATION_STATUS.WITHIN_TOLERANCE;
  else status = RECONCILIATION_STATUS.MATERIAL_DIFFERENCE;

  return {
    companyId,
    expected: toDecimalString(expected),
    actual: toDecimalString(actual),
    difference: toDecimalString(difference),
    status,
    reconciled: status === RECONCILIATION_STATUS.RECONCILED || status === RECONCILIATION_STATUS.WITHIN_TOLERANCE,
    tolerance
  };
}

/**
 * Summarize how complete the generated dataset is, per FACT_SALES field.
 * Used for a data-readiness view; it never alters the rows themselves.
 */
function buildDataReadiness(rows = []) {
  const fields = ["Month", "Customer", "SalesAmount", "Category", "SubCategory", "Salesman", "City", "State", "Tier", "CustomerType"];
  const coverage = {};

  for (const field of fields) {
    const populated = rows.filter((row) => row[field] !== null && row[field] !== undefined && row[field] !== "").length;
    coverage[field] = {
      populated,
      total: rows.length,
      percent: rows.length === 0 ? 0 : Math.round((populated / rows.length) * 1000) / 10
    };
  }

  const reasonCounts = {};
  for (const row of rows) {
    for (const reason of (row._meta && row._meta.dataQuality) || []) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }

  return { rowCount: rows.length, coverage, dataQualityReasons: reasonCounts };
}

module.exports = {
  RECONCILIATION_STATUS,
  reconcileFactSales,
  deriveSalesControlTotal,
  buildDataReadiness,
  isSalesLedger
};
