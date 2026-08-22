const { recordChecksum } = require("../../../utils/checksum");
const { deriveStableId, parseBooleanField, PARSER_VERSION, MAPPING_VERSION , flattenTextNodes } = require("./company.canonical");

/**
 * Normalize raw CostCategory into Canonical CostCategory
 */
function normalizeCanonicalCostCategory(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  // Tally returns typed scalars as { "#text": ..., "@_TYPE": ... } nodes.
  raw = flattenTextNodes(raw);

  const sourceCompanyId = context.sourceCompanyId || "UNKNOWN_COMPANY";
  const extractionRunId = context.extractionRunId || `RUN_${Date.now()}`;
  const name = (raw.NAME || raw.Name || raw.name || raw["@_NAME"] || "").trim();
  const guid = (raw.GUID || raw.Guid || raw.guid || raw["@_GUID"] || "").trim();
  const masterId = raw.MASTERID || raw.MasterId || raw.masterId || raw["@_MASTERID"] || null;
  const alterId = raw.ALTERID || raw.AlterId || raw.alterId || null;

  const sourceObjectId = deriveStableId(guid, masterId, `CCAT_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "CostCategory",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    allocateRevenue: parseBooleanField(raw.ALLOCATEREVENUE || raw.AllocateRevenue || true),
    allocateNonRevenue: parseBooleanField(raw.ALLOCATENONREVENUE || raw.AllocateNonRevenue),
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

/**
 * Normalize raw CostCentre into Canonical CostCentre
 */
function normalizeCanonicalCostCentre(raw, context = {}) {
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
  const category = (raw.CATEGORY || raw.Category || raw.category || "Primary Cost Category").trim();

  const sourceObjectId = deriveStableId(guid, masterId, `CC_${category}_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "CostCentre",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent: parent || null,
    category,
    isPrimary: !parent || parent === "Primary",
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

module.exports = {
  normalizeCanonicalCostCategory,
  normalizeCanonicalCostCentre
};
