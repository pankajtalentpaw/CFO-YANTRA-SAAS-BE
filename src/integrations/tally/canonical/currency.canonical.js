const { recordChecksum } = require("../../../utils/checksum");
const { deriveStableId, parseBooleanField, PARSER_VERSION, MAPPING_VERSION , flattenTextNodes } = require("./company.canonical");

/**
 * Normalize raw Currency into Canonical Currency
 */
function normalizeCanonicalCurrency(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  // Tally returns typed scalars as { "#text": ..., "@_TYPE": ... } nodes.
  raw = flattenTextNodes(raw);

  const sourceCompanyId = context.sourceCompanyId || "UNKNOWN_COMPANY";
  const extractionRunId = context.extractionRunId || `RUN_${Date.now()}`;
  const name = (raw.NAME || raw.Name || raw.name || raw["@_NAME"] || "").trim();
  const guid = (raw.GUID || raw.Guid || raw.guid || raw["@_GUID"] || "").trim();
  const masterId = raw.MASTERID || raw.MasterId || raw.masterId || raw["@_MASTERID"] || null;
  const alterId = raw.ALTERID || raw.AlterId || raw.alterId || null;
  const originalName = (raw.ORIGINALNAME || raw.OriginalName || name).trim();
  const symbol = (raw.EXPANDEDSYMBOL || raw.ExpandedSymbol || name).trim();
  const decimalSymbol = (raw.DECIMALSYMBOL || raw.DecimalSymbol || "Paise").trim();
  const decimalPlaces = raw.DECIMALPLACES || raw.DecimalPlaces ? Number(raw.DECIMALPLACES || raw.DecimalPlaces) : 2;

  const sourceObjectId = deriveStableId(guid, masterId, `CUR_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "Currency",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    symbol,
    originalName,
    decimalSymbol,
    decimalPlaces,
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

/**
 * Normalize raw Unit into Canonical Unit
 */
function normalizeCanonicalUnit(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  const sourceCompanyId = context.sourceCompanyId || "UNKNOWN_COMPANY";
  const extractionRunId = context.extractionRunId || `RUN_${Date.now()}`;
  const name = (raw.NAME || raw.Name || raw.name || raw["@_NAME"] || "").trim();
  const guid = (raw.GUID || raw.Guid || raw.guid || raw["@_GUID"] || "").trim();
  const masterId = raw.MASTERID || raw.MasterId || raw.masterId || raw["@_MASTERID"] || null;
  const alterId = raw.ALTERID || raw.AlterId || raw.alterId || null;
  const originalName = (raw.ORIGINALNAME || raw.OriginalName || name).trim();
  const isSimpleUnit = parseBooleanField(raw.ISSIMPLEUNIT || raw.IsSimpleUnit || true);
  const decimalPlaces = raw.DECIMALPLACES || raw.DecimalPlaces ? Number(raw.DECIMALPLACES || raw.DecimalPlaces) : 0;

  const sourceObjectId = deriveStableId(guid, masterId, `UNT_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "Unit",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    originalName,
    isSimpleUnit,
    decimalPlaces,
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

module.exports = {
  normalizeCanonicalCurrency,
  normalizeCanonicalUnit
};
