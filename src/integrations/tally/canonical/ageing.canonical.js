const { Decimal, toDecimal, toDecimalString } = require("../../../utils/financialDecimal");
const { recordChecksum } = require("../../../utils/checksum");
const { deriveStableId, PARSER_VERSION, MAPPING_VERSION } = require("./company.canonical");

/**
 * Calculate Ageing Buckets (0-30, 31-60, 61-90, 90+ days) from bill date
 */
function calculateAgeingDays(billDateStr, asOfDate = new Date()) {
  if (!billDateStr) return 0;
  const bDate = new Date(billDateStr);
  if (isNaN(bDate.getTime())) return 0;
  const diffMs = asOfDate.getTime() - bDate.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function normalizeCanonicalBill(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  const sourceCompanyId = context.sourceCompanyId || "UNKNOWN_COMPANY";
  const extractionRunId = context.extractionRunId || `RUN_${Date.now()}`;
  const asOfDate = context.asOfDate ? new Date(context.asOfDate) : new Date();

  const name = (raw.NAME || raw.Name || "").trim();
  const partyLedgerName = (raw.PARTYLEDGERNAME || raw.PartyLedgerName || raw.Parent || "").trim();
  const billDate = raw.BILLDATE || raw.BillDate || null;
  const billDueDate = raw.BILLDUEDATE || raw.BillDueDate || billDate;
  const rawOpening = raw.OPENINGVALUE || raw.OpeningValue || 0;
  const rawClosing = raw.CLOSINGVALUE || raw.ClosingValue || rawOpening;

  const numOpening = typeof rawOpening === "number" ? rawOpening : parseFloat(String(rawOpening).replace(/[^0-9.-]/g, "")) || 0;
  const numClosing = typeof rawClosing === "number" ? rawClosing : parseFloat(String(rawClosing).replace(/[^0-9.-]/g, "")) || 0;

  const daysOld = calculateAgeingDays(billDate, asOfDate);

  let bucket = "0_30";
  if (daysOld > 90) bucket = "90_PLUS";
  else if (daysOld > 60) bucket = "61_90";
  else if (daysOld > 30) bucket = "31_60";

  const sourceObjectId = deriveStableId(null, null, `BILL_${partyLedgerName}_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    billName: name,
    partyLedgerName,
    billDate,
    billDueDate,
    daysOld,
    ageingBucket: bucket,
    openingAmount: toDecimalString(Math.abs(numOpening)),
    closingAmount: toDecimalString(Math.abs(numClosing)),
    isDebit: numClosing >= 0
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

/**
 * Reconcile Ageing Buckets with Party Control Ledger Totals
 */
function reconcileAgeingBuckets(bills, controlLedgerTotal) {
  let totalOutstanding = new Decimal(0);
  const buckets = {
    "0_30": new Decimal(0),
    "31_60": new Decimal(0),
    "61_90": new Decimal(0),
    "90_PLUS": new Decimal(0)
  };

  (bills || []).forEach((b) => {
    const amt = toDecimal(b.closingAmount);
    totalOutstanding = totalOutstanding.plus(amt);
    if (buckets[b.ageingBucket]) {
      buckets[b.ageingBucket] = buckets[b.ageingBucket].plus(amt);
    }
  });

  const sumOfBuckets = buckets["0_30"].plus(buckets["31_60"]).plus(buckets["61_90"]).plus(buckets["90_PLUS"]);
  const bucketVariance = totalOutstanding.minus(sumOfBuckets).abs();

  const controlDec = toDecimal(controlLedgerTotal || totalOutstanding);
  const controlVariance = totalOutstanding.minus(controlDec).abs();

  const status = bucketVariance.isZero() && (controlVariance.isZero() || controlVariance.lessThan(new Decimal("0.01"))) ? "PASS" : "FAIL";

  return {
    status,
    totalBills: bills ? bills.length : 0,
    totalOutstanding: toDecimalString(totalOutstanding),
    buckets: {
      "0_30": toDecimalString(buckets["0_30"]),
      "31_60": toDecimalString(buckets["31_60"]),
      "61_90": toDecimalString(buckets["61_90"]),
      "90_PLUS": toDecimalString(buckets["90_PLUS"])
    },
    controlLedgerTotal: toDecimalString(controlDec),
    variance: toDecimalString(controlVariance),
    reconciledAt: new Date().toISOString()
  };
}

module.exports = {
  calculateAgeingDays,
  normalizeCanonicalBill,
  reconcileAgeingBuckets
};
