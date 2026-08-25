/**
 * Canonical Sales Voucher + Inventory Entry models.
 *
 * The existing voucher canonical model carries ledger entries only. FACT_SALES
 * needs item-level grain, so this module additionally normalizes
 * ALLINVENTORYENTRIES.LIST and the cost centre allocations that carry Salesman.
 */

const crypto = require("crypto");
const { toDecimal, toDecimalString } = require("../../../utils/financialDecimal");
const { normalizeArray, extractValue } = require("../tally.parser");
const { deriveStableId, parseBooleanField, PARSER_VERSION, MAPPING_VERSION } = require("../canonical/company.canonical");
const { toIsoDate, parseTallyDate } = require("../../../utils/dates");

/** Read the first present alias as a trimmed string, flattening typed nodes. */
function field(raw, ...keys) {
  for (const key of keys) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const value = extractValue(raw[key]);
    if (value !== null && value !== "" && !value.startsWith("{")) return value;
  }
  return null;
}

/** Tally amounts arrive as "-1200.00", "1200 Cr" or numbers. Return a signed Decimal. */
function toSignedAmount(rawAmount) {
  if (rawAmount === null || rawAmount === undefined) return toDecimal(0);
  if (typeof rawAmount === "number") return toDecimal(rawAmount);
  // Tally sends amounts as typed nodes: { "#text": "-129800.00", "@_TYPE": "Amount" }.
  // String() on that yields "[object Object]" and parses to zero, so flatten first.
  const text = String(extractValue(rawAmount) ?? "").trim();
  const magnitude = Math.abs(parseFloat(text.replace(/[^0-9.-]/g, "")) || 0);
  const isCredit = /cr\s*$/i.test(text) || text.startsWith("-");
  return toDecimal(isCredit ? -magnitude : magnitude);
}

/**
 * Quantities look like "10 Nos" or "-2 Kg", and arrive from a live Tally as a
 * typed node: { "#text": "2 Nos", "@_TYPE": "Quantity" }. String() on that
 * yields "[object Object]" and parses to nothing, so flatten first.
 */
function toQuantity(rawQty) {
  if (typeof rawQty === "number") return rawQty;
  const text = extractValue(rawQty);
  if (!text || text.startsWith("{")) return null;
  const parsed = parseFloat(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Unit of measure for an inventory line. Tally appends it to the quantity
 * ("2 Nos") and to the rate ("14500.00/Nos"); the quantity is authoritative and
 * the rate is the fallback for lines Tally bills without a quantity.
 */
function toUnit(rawQty, rawRate) {
  const qtyText = extractValue(rawQty);
  if (qtyText && !qtyText.startsWith("{")) {
    const match = qtyText.match(/[\d.]\s*([A-Za-z%][\w%.\-\s]*)$/);
    if (match) return match[1].trim();
  }
  const rateText = extractValue(rawRate);
  if (rateText && !rateText.startsWith("{")) {
    const match = rateText.match(/\/\s*(.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

/** Tally dates are yyyymmdd; anything else passes through untouched. */
function toIso(rawDate) {
  const text = field({ d: rawDate }, "d");
  if (!text) return null;
  if (/^\d{8}$/.test(text)) {
    try { return toIsoDate(parseTallyDate(text)); } catch (e) { return text; }
  }
  return text;
}

/**
 * Normalize the cost centre allocations attached to a ledger entry.
 * Absence is normal — cost centres are optional in Tally.
 */
function normalizeCostCentreAllocations(entry) {
  return normalizeArray(entry["CATEGORYALLOCATIONS.LIST"] || entry.CATEGORYALLOCATIONS || [])
    .flatMap((category) => {
      const categoryName = field(category, "CATEGORY", "Category");
      return normalizeArray(category["COSTCENTREALLOCATIONS.LIST"] || category.COSTCENTREALLOCATIONS || [])
        .map((allocation) => ({
          costCategory: categoryName,
          costCentreName: field(allocation, "NAME", "Name"),
          amount: toDecimalString(toSignedAmount(allocation.AMOUNT || allocation.Amount).abs())
        }));
    })
    .concat(
      // Some Tally builds emit COSTCENTREALLOCATIONS.LIST directly on the entry.
      normalizeArray(
        entry["COSTCENTREALLOCATIONS.LIST"] || entry["COSTTRACKALLOCATIONS.LIST"] || []
      ).map((allocation) => ({
        costCategory: null,
        costCentreName: field(allocation, "NAME", "Name"),
        amount: toDecimalString(toSignedAmount(allocation.AMOUNT || allocation.Amount).abs())
      }))
    )
    .filter((allocation) => allocation.costCentreName);
}

/**
 * Normalize one ALLINVENTORYENTRIES.LIST node.
 * @returns {object|null} null when the entry names no stock item
 */
function normalizeInventoryEntry(raw, index, voucherId) {
  if (!raw || typeof raw !== "object") return null;

  const stockItemName = field(raw, "STOCKITEMNAME", "StockItemName", "NAME", "Name");
  if (!stockItemName) return null;

  const amount = toSignedAmount(raw.AMOUNT || raw.Amount);
  const rate = field(raw, "RATE", "Rate");
  // Billed quantity is what the invoice charges for; actual quantity is what
  // moved. They differ only on free/short supply, where billed is the truth.
  const rawQuantity = raw.BILLEDQTY || raw.BilledQty || raw.ACTUALQTY || raw.ActualQty;

  return {
    // Position is part of the identity: the same item can legitimately appear
    // twice on one invoice at different rates.
    lineIndex: index + 1,
    sourceInventoryEntryId: `${voucherId}#INV${index + 1}`,
    stockItemName,
    quantity: toQuantity(rawQuantity),
    unit: toUnit(rawQuantity, raw.RATE || raw.Rate),
    rate: rate || null,
    // Sales credits revenue, so Tally reports a negative amount. FACT_SALES
    // stores the positive sales value; the sign is preserved separately.
    amount: toDecimalString(amount.abs()),
    isCredit: amount.isNegative(),
    costCentreAllocations: normalizeCostCentreAllocations(raw)
  };
}

/**
 * Normalize a raw Tally sales voucher into the canonical SalesVoucher model.
 *
 * @param {object} raw Parsed VOUCHER node
 * @param {object} context
 * @param {string} context.companyId  Stable company identity (never a name alone)
 * @param {string} [context.companyGuid]
 * @param {string} [context.syncRunId]
 * @returns {object|null}
 */
function normalizeSalesVoucher(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  const companyId = context.companyId || "UNKNOWN_COMPANY";
  const syncRunId = context.syncRunId || `RUN_${Date.now()}`;

  const guid = field(raw, "GUID", "Guid");
  const masterId = field(raw, "MASTERID", "MasterId");
  const voucherNumber = field(raw, "VOUCHERNUMBER", "VoucherNumber");
  const voucherType = field(raw, "VOUCHERTYPENAME", "VoucherTypeName");
  const voucherDate = toIso(raw.DATE || raw.Date);
  const partyLedgerName = field(raw, "PARTYLEDGERNAME", "PartyLedgerName");

  const sourceVoucherId = deriveStableId(guid, masterId, `SALESVCH_${voucherType}_${voucherNumber}_${voucherDate}`);

  // Voucher-level total, taken from the direct AMOUNT child only. Nested entry
  // amounts live under ALLLEDGERENTRIES/ALLINVENTORYENTRIES and are not used here.
  const rawAmount = raw.AMOUNT !== undefined ? raw.AMOUNT : raw.Amount;
  const hasAmount = rawAmount !== undefined && rawAmount !== null && extractValue(rawAmount) !== "";
  const signedAmount = hasAmount ? toSignedAmount(rawAmount) : null;

  const ledgerEntries = normalizeArray(
    raw["ALLLEDGERENTRIES.LIST"] || raw.ALLLEDGERENTRIES ||
    raw["LEDGERENTRIES.LIST"] || raw.LEDGERENTRIES || []
  )
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const amount = toSignedAmount(entry.AMOUNT || entry.Amount);
      return {
        lineIndex: index + 1,
        ledgerName: field(entry, "LEDGERNAME", "LedgerName"),
        amount: toDecimalString(amount.abs()),
        isCredit: amount.isNegative(),
        costCentreAllocations: normalizeCostCentreAllocations(entry)
      };
    })
    .filter((entry) => entry && entry.ledgerName);

  const inventoryEntries = normalizeArray(
    raw["ALLINVENTORYENTRIES.LIST"] || raw.ALLINVENTORYENTRIES ||
    raw["INVENTORYENTRIES.LIST"] || raw.INVENTORYENTRIES || []
  )
    .map((entry, index) => normalizeInventoryEntry(entry, index, sourceVoucherId))
    .filter(Boolean);

  return {
    companyId,
    companyGuid: context.companyGuid || null,
    objectType: "SalesVoucher",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    syncRunId,
    sourceSystem: "tally",
    // The mirror upserts every canonical record on `sourceObjectId` and skips
    // any record that lacks one. Vouchers carried only `sourceVoucherId`, so
    // every voucher was silently dropped at the mirror boundary while the sync
    // still reported its read count as `total` — the register looked synced and
    // the collection stayed empty. Same stable id, under the name the envelope
    // requires.
    sourceObjectId: sourceVoucherId,
    sourceVoucherId,
    sourceVoucherNumber: voucherNumber,
    sourceFetchedAt: context.fetchedAt || new Date().toISOString(),
    voucherType,
    voucherDate,
    partyLedgerName,
    // Sales credit the party, so Tally reports a negative total. The magnitude
    // is stored and the direction kept separately; null when Tally sent none.
    amount: signedAmount === null ? null : toDecimalString(signedAmount.abs()),
    amountIsCredit: signedAmount === null ? null : signedAmount.isNegative(),
    isCancelled: parseBooleanField(raw.ISCANCELLED || raw.IsCancelled),
    isOptional: parseBooleanField(raw.ISOPTIONAL || raw.IsOptional),
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    ledgerEntries,
    inventoryEntries
  };
}

/**
 * Deterministic FACT_SALES RowID.
 * Generated inside CFO Yantra, never sourced from Tally, and stable across
 * re-syncs so repeated ingestion cannot create duplicate rows.
 */
function buildRowId(companyId, sourceVoucherId, sourceInventoryEntryId) {
  const key = `${companyId}|${sourceVoucherId}|${sourceInventoryEntryId}`;
  return crypto.createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32);
}

module.exports = {
  normalizeSalesVoucher,
  toQuantity,
  toUnit,
  normalizeInventoryEntry,
  normalizeCostCentreAllocations,
  buildRowId,
  toSignedAmount
};
