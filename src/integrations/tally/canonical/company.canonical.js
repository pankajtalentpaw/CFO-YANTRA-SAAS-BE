const crypto = require("crypto");
const { recordChecksum } = require("../../../utils/checksum");
const { toIsoDate, parseTallyDate } = require("../../../utils/dates");

const PARSER_VERSION = "2.0.0";
const MAPPING_VERSION = "1.0.0";

/**
 * Generate deterministic source object ID
 */
function deriveStableId(guid, masterId, fallbackKey) {
  if (guid && String(guid).trim() && String(guid).trim() !== "0") {
    return String(guid).trim();
  }
  if (masterId !== undefined && masterId !== null && String(masterId).trim() && String(masterId).trim() !== "0") {
    return `MID_${String(masterId).trim()}`;
  }
  if (fallbackKey && String(fallbackKey).trim()) {
    const hash = crypto.createHash("sha256").update(String(fallbackKey).trim(), "utf8").digest("hex").substring(0, 16);
    return `HASH_${hash}`;
  }
  return `GEN_${crypto.randomUUID()}`;
}

function parseBooleanField(val) {
  if (val === undefined || val === null) return false;
  // A live Tally sends logicals as typed nodes: { "#text": "Yes", "@_TYPE":
  // "Logical" }. String() on that yields "[object Object]", which read as false
  // for every voucher — a cancelled invoice counted as revenue.
  const raw = val && typeof val === "object" && val["#text"] !== undefined ? val["#text"] : val;
  const s = String(raw).trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "on";
}

function classifyField(value, isSupported = true) {
  if (!isSupported) return "UNSUPPORTED";
  if (value === undefined) return "ABSENT";
  if (value === null || value === "") return "NULL";
  return "PRESENT";
}

/**
 * Tally emits typed scalars as nodes like { "#text": "20230401", "@_TYPE": "Date" }.
 * Flatten those to their text value so downstream reads never yield "[object Object]".
 * Genuinely structural children are left untouched.
 * @param {object} raw
 * @returns {object}
 */
function flattenTextNodes(raw) {
  const flat = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === "object" && !Array.isArray(value) && value["#text"] !== undefined) {
      flat[key] = String(value["#text"]).trim();
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

/**
 * Normalize raw company data into Canonical Company Model
 * Supports both context object { sourceFormat, extractionRunId } and legacy string sourceFormat
 * @param {object} raw
 * @param {object|string} [context]
 * @returns {object} Canonical Company
 */
function normalizeCanonicalCompany(raw, context = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  raw = flattenTextNodes(raw);

  const ctx = typeof context === "string" ? { sourceFormat: context } : (context || {});
  const sourceFormat = ctx.sourceFormat || "XML";
  const extractionRunId = ctx.extractionRunId || `RUN_${Date.now()}`;

  const str = (v) => (typeof v === "string" ? v : v === null || v === undefined || typeof v === "object" ? "" : String(v));
  const displayName = str(raw.NAME || raw.Name || raw.name || raw["@_NAME"]).trim();
  const formalName = (str(raw.FORMALNAME || raw.FormalName || raw.formalName) || displayName).trim();
  const guid = str(raw.GUID || raw.Guid || raw.guid || raw["@_GUID"]).trim();
  const masterId = raw.MASTERID || raw.MasterId || raw.masterId || raw["@_MASTERID"] || null;
  const alterId = raw.ALTERID || raw.AlterId || raw.alterId || null;

  let startingFrom = raw.STARTINGFROM || raw.StartingFrom || raw.startingFrom || raw.starting_from || null;
  let booksFrom = raw.BOOKSFROM || raw.BooksFrom || raw.booksFrom || raw.books_from || null;

  try {
    if (startingFrom && String(startingFrom).length === 8 && !String(startingFrom).includes("-")) {
      startingFrom = toIsoDate(parseTallyDate(String(startingFrom)));
    }
  } catch (e) {}

  try {
    if (booksFrom && String(booksFrom).length === 8 && !String(booksFrom).includes("-")) {
      booksFrom = toIsoDate(parseTallyDate(String(booksFrom)));
    }
  } catch (e) {}

  const baseCurrency = (raw.BASECURRENCY || raw.BaseCurrency || raw.baseCurrency || raw.CURRENCY || "INR").trim();
  const country = (raw.COUNTRYNAME || raw.CountryName || raw.country || "India").trim();
  const state = (raw.STATENAME || raw.StateName || raw.state || "").trim();
  const pinCode = (raw.PINCODE || raw.PinCode || raw.pincode || "").trim();
  const gstRegNo = (raw.GSTREGNO || raw.GstRegNo || raw.gstin || "").trim();
  const pan = (raw.PANCARDNO || raw.PanCardNo || raw.pan || "").trim();
  const cin = (raw.CINNO || raw.CinNo || raw.cin || "").trim();

  // Features
  const features = {
    billWise: parseBooleanField(raw.ISBILLWISEON || raw.IsBillWiseOn),
    costCentres: parseBooleanField(raw.ISCOSTCENTRESON || raw.IsCostCentresOn),
    inventory: parseBooleanField(raw.ISINVENTORYON || raw.IsInventoryOn),
    multiCurrency: parseBooleanField(raw.ISMULTICURRENCYON || raw.IsMultiCurrencyOn),
    payroll: parseBooleanField(raw.ISPAYROLLON || raw.IsPayrollOn),
    gstApplicable: parseBooleanField(raw.ISGSTAPPLICABLE || raw.IsGstApplicable || gstRegNo),
    tdsApplicable: parseBooleanField(raw.ISTDSAPPLICABLE || raw.IsTdsApplicable),
    tcsApplicable: parseBooleanField(raw.ISTCSAPPLICABLE || raw.IsTcsApplicable),
    batchEnabled: parseBooleanField(raw.ISBATCHON || raw.IsBatchOn),
    godownEnabled: parseBooleanField(raw.ISGODOWNON || raw.IsGodownOn),
    bomEnabled: parseBooleanField(raw.ISBOMON || raw.IsBOMOn)
  };

  const sourceCompanyId = deriveStableId(guid, masterId, displayName);

  const canonical = {
    sourceCompanyId,
    sourceObjectId: sourceCompanyId,
    objectType: "Company",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    sourceFormat,
    displayName: displayName || "Unnamed Company",
    companyName: displayName || "Unnamed Company", // Backward-compatibility
    legalName: formalName || displayName || "Unnamed Company",
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null,
    financialYearBeginning: startingFrom,
    financialYearStart: startingFrom, // Backward-compatibility
    booksFrom: booksFrom || startingFrom,
    baseCurrency,
    country,
    state,
    pinCode: pinCode || null,
    gstRegistration: {
      gstin: gstRegNo || null,
      state: state || null,
      isApplicable: features.gstApplicable
    },
    pan: pan || null,
    cin: cin || null,
    status: "ACTIVE",
    features,
    sourceLineage: {
      sourceInstanceId: ctx.sourceInstanceId || "LOCAL_TALLY",
      connectorVersion: "1.0.0",
      extractedAt: new Date().toISOString()
    }
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

module.exports = {
  flattenTextNodes,
  PARSER_VERSION,
  MAPPING_VERSION,
  deriveStableId,
  parseBooleanField,
  classifyField,
  normalizeCanonicalCompany
};
