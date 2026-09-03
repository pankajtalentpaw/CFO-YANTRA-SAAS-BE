const { recordChecksum } = require("../../../utils/checksum");
const { toDecimalString } = require("../../../utils/financialDecimal");
const { deriveStableId, parseBooleanField, PARSER_VERSION, MAPPING_VERSION , flattenTextNodes } = require("./company.canonical");
const { normalizeArray, extractValue } = require("../tally.parser");

/**
 * Classify ledger based on parent group and ledger attributes
 */
function classifyLedger(parent, name, raw) {
  const p = (parent || "").toLowerCase();
  const n = (name || "").toLowerCase();

  if (p.includes("bank") || n.includes("bank account") || n.includes("current account")) {
    return "BANK";
  }
  if (p.includes("cash") || n === "cash" || n.includes("petty cash")) {
    return "CASH";
  }
  if (p.includes("sundry debtor") || p.includes("debtors") || p.includes("receivable") || p.includes("customers")) {
    return "SUNDRY_DEBTOR";
  }
  if (p.includes("sundry creditor") || p.includes("creditors") || p.includes("payable") || p.includes("vendors") || p.includes("suppliers")) {
    return "SUNDRY_CREDITOR";
  }
  if (p.includes("duties") || p.includes("taxes") || p.includes("tax") || p.includes("gst") || p.includes("tds") || p.includes("vat")) {
    return "TAX";
  }
  if (p.includes("direct expense") || p.includes("indirect expense") || p.includes("expenses")) {
    return "EXPENSE";
  }
  if (p.includes("sales") || p.includes("direct income") || p.includes("indirect income") || p.includes("revenue")) {
    return "INCOME";
  }
  if (p.includes("fixed asset") || p.includes("current asset") || p.includes("investments") || p.includes("loans & advances (asset)")) {
    return "ASSET";
  }
  if (p.includes("capital") || p.includes("reserves") || p.includes("loans (liability)") || p.includes("current liabilit")) {
    return "LIABILITY";
  }
  return "GENERAL";
}

/**
 * Normalize raw Tally Group into Canonical Group
 */
function normalizeCanonicalGroup(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  // Tally returns typed scalars as { "#text": ..., "@_TYPE": ... } nodes.
  raw = flattenTextNodes(raw);

  const sourceCompanyId = context.sourceCompanyId || "UNKNOWN_COMPANY";
  const extractionRunId = context.extractionRunId || `RUN_${Date.now()}`;
  const name = (raw.NAME || raw.Name || raw.name || raw["@_NAME"] || "").trim();
  const guid = (raw.GUID || raw.Guid || raw.guid || raw["@_GUID"] || "").trim();
  const masterId = raw.MASTERID || raw.MasterId || raw.masterId || raw["@_MASTERID"] || null;
  const alterId = raw.ALTERID || raw.AlterId || raw.alterId || null;
  const parent = (raw.PARENT || raw.Parent || raw.parent || "").trim();

  const sourceObjectId = deriveStableId(guid, masterId, `GRP_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "Group",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent: parent || null,
    isPrimary: !parent || parent === "" || parent === "Primary",
    isAddable: parseBooleanField(raw.ISADDABLE || raw.IsAddable || true),
    isRevenue: parseBooleanField(raw.ISREVENUE || raw.IsRevenue),
    isDeemedPositive: parseBooleanField(raw.ISDEEMEDPOSITIVE || raw.IsDeemedPositive),
    affectsGrossProfit: parseBooleanField(raw.AFFECTSGROSSPROFIT || raw.AffectsGrossProfit),
    sortPosition: raw.SORTPOSITION || raw.SortPosition ? Number(raw.SORTPOSITION || raw.SortPosition) : null,
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

/**
 * Normalize raw Tally Ledger into Canonical Ledger
 */
function normalizeCanonicalLedger(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  // Tally returns typed scalars as { "#text": ..., "@_TYPE": ... } nodes.
  raw = flattenTextNodes(raw);

  const sourceCompanyId = context.sourceCompanyId || "UNKNOWN_COMPANY";
  const extractionRunId = context.extractionRunId || `RUN_${Date.now()}`;
  const name = (raw.NAME || raw.Name || raw.name || raw["@_NAME"] || "").trim();
  const guid = (raw.GUID || raw.Guid || raw.guid || raw["@_GUID"] || "").trim();
  const masterId = raw.MASTERID || raw.MasterId || raw.masterId || raw["@_MASTERID"] || null;
  const alterId = raw.ALTERID || raw.AlterId || raw.alterId || null;
  const parent = (raw.PARENT || raw.Parent || raw.parent || "").trim();

  // Financial opening balance parsing
  const rawOpening = raw.OPENINGBALANCE || raw.OpeningBalance || raw.openingBalance || 0;
  let openingBalance = "0.00";
  let isDebit = true;

  if (typeof rawOpening === "number") {
    openingBalance = toDecimalString(Math.abs(rawOpening));
    isDebit = rawOpening >= 0;
  } else if (typeof rawOpening === "string") {
    const trimmed = rawOpening.trim();
    if (trimmed.endsWith("Cr") || trimmed.endsWith("CR") || trimmed.startsWith("-")) {
      isDebit = false;
      const numStr = trimmed.replace(/[^0-9.-]/g, "");
      openingBalance = toDecimalString(Math.abs(parseFloat(numStr) || 0));
    } else {
      isDebit = true;
      const numStr = trimmed.replace(/[^0-9.-]/g, "");
      openingBalance = toDecimalString(Math.abs(parseFloat(numStr) || 0));
    }
  }

  // ClosingBalance is only present when explicitly fetched. It stays undefined
  // otherwise so reconciliation can tell "absent" from "zero".
  const rawClosing = raw.CLOSINGBALANCE !== undefined ? raw.CLOSINGBALANCE
    : raw.ClosingBalance !== undefined ? raw.ClosingBalance : undefined;
  let closingBalance = null;
  if (rawClosing !== undefined && rawClosing !== null && String(rawClosing).trim() !== "") {
    let text = String(rawClosing).trim();
    if (text.includes("=")) text = text.split("=").pop().trim();
    const magnitude = Math.abs(parseFloat(text.replace(/[^0-9.-]/g, "")) || 0);
    closingBalance = {
      amount: toDecimalString(magnitude),
      isDebit: !(/cr\s*$/i.test(text) || text.startsWith("-"))
    };
  }

  const classification = classifyLedger(parent, name, raw);
  const isBillWiseOn = parseBooleanField(raw.ISBILLWISEON || raw.IsBillWiseOn);
  const isCostCentresOn = parseBooleanField(raw.ISCOSTCENTRESON || raw.IsCostCentresOn);
  const isActive = raw.ISACTIVE !== undefined ? parseBooleanField(raw.ISACTIVE) : true;
  const taxType = (raw.TAXTYPE || raw.TaxType || "").trim() || null;
  const gstType = (raw.GSTTYPE || raw.GstType || "").trim() || null;
  const partyGstin = (raw.PARTYGSTIN || raw.PartyGSTIN || raw.partyGstin || "").trim() || null;
  const mailingName = (raw.MAILINGNAME || raw.MailingName || name).trim();
  const country = (raw.COUNTRYNAME || raw.CountryName || "").trim() || null;

  // ADDRESS.LIST is free text and may arrive as one line or many. The raw lines
  // are preserved verbatim; City is parsed downstream, never here.
  const addressLines = normalizeArray(raw["ADDRESS.LIST"] || raw.ADDRESS || raw.Address)
    .flatMap((node) => normalizeArray(node && typeof node === "object" ? node.ADDRESS || node["#text"] : node))
    // Each <ADDRESS TYPE="String"> line is itself a typed node, so flatten again.
    .map((line) => extractValue(line))
    .map((line) => (line === null ? "" : line.trim()))
    .filter((line) => line && !line.startsWith("{"));

  // LEDSTATENAME is Tally's discrete state field; preferred over parsing the address.
  const stateName = (raw.LEDSTATENAME || raw.LedStateName || raw.STATENAME || raw.StateName || "").trim() || null;
  const pinCode = (raw.PINCODE || raw.PinCode || "").trim() || null;

  // Stable ID derivation: GUID -> MasterID -> HASH(parent + name) to guarantee distinction across duplicate names in different parents
  const sourceObjectId = deriveStableId(guid, masterId, `LED_${parent}_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "Ledger",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent: parent || "Primary",
    classification,
    openingBalance: {
      amount: openingBalance,
      isDebit,
      formatted: `${openingBalance} ${isDebit ? "Dr" : "Cr"}`
    },
    closingBalance,
    billWise: {
      enabled: isBillWiseOn
    },
    costCentres: {
      enabled: isCostCentresOn
    },
    taxation: {
      taxType,
      gstType,
      partyGstin
    },
    mailingName,
    country,
    address: {
      lines: addressLines,
      raw: addressLines.join(", ") || null,
      stateName,
      pinCode
    },
    isActive,
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

module.exports = {
  classifyLedger,
  normalizeCanonicalGroup,
  normalizeCanonicalLedger
};
