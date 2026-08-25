const { recordChecksum } = require("../../../utils/checksum");
const { deriveStableId, parseBooleanField, PARSER_VERSION, MAPPING_VERSION , flattenTextNodes } = require("./company.canonical");

const { classifyVoucherType } = require("./accountingAnalysis.engine");

/**
 * Normalize raw VoucherType into Canonical VoucherType
 */
function normalizeCanonicalVoucherType(raw, context = {}) {
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
  const abbreviation = (raw.ABBREVIATION || raw.Abbreviation || raw.abbreviation || name.substring(0, 3)).trim();
  const numberingMethod = (raw.NUMBERINGMETHOD || raw.NumberingMethod || "Automatic").trim();

  const coreType = classifyVoucherType(name, parent);
  const isOptional = parseBooleanField(raw.ISOPTIONAL || raw.IsOptional);
  const isActive = raw.ISACTIVE !== undefined ? parseBooleanField(raw.ISACTIVE) : true;
  const isDeemedPositive = parseBooleanField(raw.ISDEEMEDPOSITIVE || raw.IsDeemedPositive);

  const sourceObjectId = deriveStableId(guid, masterId, `VCH_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "VoucherType",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent: parent || null,
    abbreviation,
    coreType,
    numberingMethod,
    isOptional,
    isActive,
    isDeemedPositive,
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

module.exports = {
  classifyVoucherType,
  normalizeCanonicalVoucherType
};
