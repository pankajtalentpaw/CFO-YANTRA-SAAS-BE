const { Decimal, toDecimal, add, subtract, equals, toDecimalString } = require("../../../utils/financialDecimal");
const { recordChecksum } = require("../../../utils/checksum");
const { deriveStableId, PARSER_VERSION, MAPPING_VERSION } = require("./company.canonical");

/**
 * Normalize raw Trial Balance ledger record
 */
function normalizeTrialBalanceRow(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  const sourceCompanyId = context.sourceCompanyId || "UNKNOWN_COMPANY";
  const extractionRunId = context.extractionRunId || `RUN_${Date.now()}`;
  const name = (raw.NAME || raw.Name || raw.name || raw["@_NAME"] || "").trim();
  const parent = (raw.PARENT || raw.Parent || raw.parent || "Primary").trim();

  const openingRaw = raw.OPENINGBALANCE || raw.OpeningBalance || 0;
  const closingRaw = raw.CLOSINGBALANCE || raw.ClosingBalance || 0;
  const debitTotalRaw = raw.DEBITTOTAL || raw.DebitTotal || 0;
  const creditTotalRaw = raw.CREDITTOTAL || raw.CreditTotal || 0;

  function parseAmount(val) {
    if (typeof val === "number") return { amount: toDecimal(Math.abs(val)), isDebit: val >= 0 };
    const str = String(val || "").trim();
    const isCr = str.endsWith("Cr") || str.endsWith("CR") || str.startsWith("-");
    const num = parseFloat(str.replace(/[^0-9.-]/g, "")) || 0;
    return { amount: toDecimal(Math.abs(num)), isDebit: !isCr };
  }

  const op = parseAmount(openingRaw);
  const cl = parseAmount(closingRaw);
  const dr = typeof debitTotalRaw === "number" ? toDecimal(Math.abs(debitTotalRaw)) : toDecimal(parseFloat(String(debitTotalRaw).replace(/[^0-9.-]/g, "")) || 0);
  const cr = typeof creditTotalRaw === "number" ? toDecimal(Math.abs(creditTotalRaw)) : toDecimal(parseFloat(String(creditTotalRaw).replace(/[^0-9.-]/g, "")) || 0);

  const sourceObjectId = deriveStableId(null, null, `TB_${parent}_${name}`);

  const row = {
    sourceCompanyId,
    sourceObjectId,
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent,
    opening: {
      amount: toDecimalString(op.amount),
      isDebit: op.isDebit,
      raw: op.amount
    },
    debit: {
      amount: toDecimalString(dr),
      raw: dr
    },
    credit: {
      amount: toDecimalString(cr),
      raw: cr
    },
    closing: {
      amount: toDecimalString(cl.amount),
      isDebit: cl.isDebit,
      raw: cl.amount
    }
  };

  row.checksum = recordChecksum(row);
  return row;
}

/**
 * Reconcile Trial Balance (Strict Debit == Credit equality check using decimal.js)
 */
function reconcileTrialBalance(rows, context = {}) {
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  let totalOpeningDr = new Decimal(0);
  let totalOpeningCr = new Decimal(0);
  let totalClosingDr = new Decimal(0);
  let totalClosingCr = new Decimal(0);

  (rows || []).forEach((r) => {
    totalDebit = totalDebit.plus(r.debit.raw);
    totalCredit = totalCredit.plus(r.credit.raw);

    if (r.opening.isDebit) {
      totalOpeningDr = totalOpeningDr.plus(r.opening.raw);
    } else {
      totalOpeningCr = totalOpeningCr.plus(r.opening.raw);
    }

    if (r.closing.isDebit) {
      totalClosingDr = totalClosingDr.plus(r.closing.raw);
    } else {
      totalClosingCr = totalClosingCr.plus(r.closing.raw);
    }
  });

  const transactionVariance = totalDebit.minus(totalCredit).abs();
  const openingVariance = totalOpeningDr.minus(totalOpeningCr).abs();
  const closingVariance = totalClosingDr.minus(totalClosingCr).abs();

  const isDebitCreditBalanced = transactionVariance.isZero() || transactionVariance.lessThan(new Decimal("0.01"));
  const isOpeningBalanced = openingVariance.isZero() || openingVariance.lessThan(new Decimal("0.01"));

  const status = isDebitCreditBalanced ? "PASS" : "FAIL";

  return {
    status,
    period: context.period || "FY",
    totalRows: rows ? rows.length : 0,
    totals: {
      debit: toDecimalString(totalDebit),
      credit: toDecimalString(totalCredit),
      variance: toDecimalString(transactionVariance)
    },
    openingTotals: {
      debit: toDecimalString(totalOpeningDr),
      credit: toDecimalString(totalOpeningCr),
      variance: toDecimalString(openingVariance)
    },
    closingTotals: {
      debit: toDecimalString(totalClosingDr),
      credit: toDecimalString(totalClosingCr),
      variance: toDecimalString(closingVariance)
    },
    isBalanced: isDebitCreditBalanced,
    reconciledAt: new Date().toISOString()
  };
}

module.exports = {
  normalizeTrialBalanceRow,
  reconcileTrialBalance
};
