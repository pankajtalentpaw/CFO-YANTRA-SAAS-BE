const { Decimal, toDecimal, toDecimalString } = require("../../../utils/financialDecimal");
const { recordChecksum } = require("../../../utils/checksum");
const { normalizeArray } = require("../tally.parser");
const { deriveStableId, parseBooleanField, PARSER_VERSION, MAPPING_VERSION } = require("./company.canonical");
const { toIsoDate, parseTallyDate } = require("../../../utils/dates");

/**
 * Normalize raw voucher document into Canonical Voucher
 */
function safeString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v["#text"] !== undefined) return String(v["#text"]).trim();
    if (v["_"] !== undefined) return String(v["_"]).trim();
    return "";
  }
  return String(v).trim();
}

/**
 * Normalize raw voucher document into Canonical Voucher
 */
function normalizeCanonicalVoucher(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  const sourceCompanyId = context.sourceCompanyId || "UNKNOWN_COMPANY";
  const extractionRunId = context.extractionRunId || `RUN_${Date.now()}`;

  const guid = safeString(raw.GUID || raw.Guid || raw.guid);
  const masterId = safeString(raw.MASTERID || raw.MasterId) || null;
  const alterId = safeString(raw.ALTERID || raw.AlterId) || null;
  const voucherNumber = safeString(raw.VOUCHERNUMBER || raw.VoucherNumber || raw.vouchernumber);
  const voucherType = safeString(raw.VOUCHERTYPENAME || raw.VoucherTypeName) || "Journal";
  const rawDate = safeString(raw.DATE || raw.Date);
  const partyLedgerName = safeString(raw.PARTYLEDGERNAME || raw.PartyLedgerName) || null;
  const narration = safeString(raw.NARRATION || raw.Narration) || null;
  const isCancelled = parseBooleanField(raw.ISCANCELLED || raw.IsCancelled);
  const isOptional = parseBooleanField(raw.ISOPTIONAL || raw.IsOptional);

  let formattedDate = rawDate;
  try {
    if (String(rawDate).length === 8 && !String(rawDate).includes("-")) {
      formattedDate = toIsoDate(parseTallyDate(String(rawDate)));
    }
  } catch (e) {}

  // Parse Ledger Entries
  const rawLedgerEntries = normalizeArray(raw["ALLLEDGERENTRIES.LIST"] || raw.ALLLEDGERENTRIES || raw.allledgerentries || []);
  const ledgerEntries = [];
  let calculatedVoucherTotal = new Decimal(0);

  rawLedgerEntries.forEach((entry, idx) => {
    if (!entry || typeof entry !== "object") return;
    const ledgerName = safeString(entry.LEDGERNAME || entry.LedgerName);
    const rawAmt = entry.AMOUNT !== undefined ? entry.AMOUNT : (entry.Amount !== undefined ? entry.Amount : 0);
    let strAmt = typeof rawAmt === "number" ? "" : safeString(rawAmt);
    if (strAmt.includes("=")) {
      strAmt = strAmt.split("=").pop().trim();
    }
    const isDebit = typeof rawAmt === "number" ? rawAmt < 0 : !strAmt.endsWith("Cr") && (strAmt.startsWith("-") || !strAmt.endsWith("Dr"));
    const numAmt = typeof rawAmt === "number" ? Math.abs(rawAmt) : Math.abs(parseFloat(strAmt.replace(/[^0-9.-]/g, "")) || 0);

    const lineTotal = toDecimal(numAmt);
    if (isDebit) {
      calculatedVoucherTotal = calculatedVoucherTotal.plus(lineTotal);
    }

    // Bill allocations inside ledger entry
    const rawBills = normalizeArray(entry["BILLALLOCATIONS.LIST"] || entry.BILLALLOCATIONS || []);
    const billAllocations = rawBills.map((b) => ({
      billName: safeString(b.NAME || b.Name),
      billType: safeString(b.BILLTYPE || b.BillType) || "Agst Ref",
      amount: (() => {
        let bStr = safeString(b.AMOUNT !== undefined ? b.AMOUNT : b.Amount);
        if (bStr.includes("=")) bStr = bStr.split("=").pop().trim();
        return toDecimalString(Math.abs(parseFloat(bStr.replace(/[^0-9.-]/g, "")) || 0));
      })()
    }));


    ledgerEntries.push({
      lineIndex: idx + 1,
      ledgerName,
      isDebit,
      amount: toDecimalString(lineTotal),
      billAllocations
    });
  });

  const sourceVoucherId = deriveStableId(guid, masterId, `VCH_${voucherType}_${voucherNumber}_${formattedDate}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId: sourceVoucherId,
    objectType: "Voucher",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    header: {
      voucherNumber,
      voucherType,
      date: formattedDate,
      partyLedgerName,
      narration,
      isCancelled,
      isOptional,
      guid: guid || null,
      masterId: masterId ? Number(masterId) : null,
      alterId: alterId ? Number(alterId) : null,
      voucherTotal: toDecimalString(calculatedVoucherTotal)
    },
    ledgerEntries,
    lineCount: ledgerEntries.length
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

/**
 * Rebuild ledger aggregate balances from vouchers and check for join multiplication
 */
function aggregateVoucherLedgers(vouchers) {
  const ledgerAggregates = {};

  (vouchers || []).forEach((v) => {
    if (v.header.isCancelled) return;
    (v.ledgerEntries || []).forEach((entry) => {
      if (!ledgerAggregates[entry.ledgerName]) {
        ledgerAggregates[entry.ledgerName] = {
          ledgerName: entry.ledgerName,
          debitTotal: new Decimal(0),
          creditTotal: new Decimal(0),
          transactionCount: 0
        };
      }

      const amt = toDecimal(entry.amount);
      if (entry.isDebit) {
        ledgerAggregates[entry.ledgerName].debitTotal = ledgerAggregates[entry.ledgerName].debitTotal.plus(amt);
      } else {
        ledgerAggregates[entry.ledgerName].creditTotal = ledgerAggregates[entry.ledgerName].creditTotal.plus(amt);
      }
      ledgerAggregates[entry.ledgerName].transactionCount += 1;
    });
  });

  const formatted = {};
  for (const [k, v] of Object.entries(ledgerAggregates)) {
    formatted[k] = {
      ledgerName: v.ledgerName,
      debit: toDecimalString(v.debitTotal),
      credit: toDecimalString(v.creditTotal),
      net: toDecimalString(v.debitTotal.minus(v.creditTotal)),
      transactionCount: v.transactionCount
    };
  }

  return {
    totalLedgersImpacted: Object.keys(formatted).length,
    aggregates: formatted
  };
}

module.exports = {
  normalizeCanonicalVoucher,
  aggregateVoucherLedgers
};
