const { recordChecksum } = require("../../../utils/checksum");
const { toDecimalString } = require("../../../utils/financialDecimal");
const { deriveStableId, parseBooleanField, PARSER_VERSION, MAPPING_VERSION , flattenTextNodes } = require("./company.canonical");

/**
 * Normalize raw StockGroup into Canonical StockGroup
 */
function normalizeCanonicalStockGroup(raw, context = {}) {
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

  const sourceObjectId = deriveStableId(guid, masterId, `SGRP_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "StockGroup",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent: parent || null,
    isPrimary: !parent || parent === "Primary",
    isAddable: parseBooleanField(raw.ISADDABLE || raw.IsAddable || true),
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

/**
 * Normalize raw StockCategory into Canonical StockCategory
 */
function normalizeCanonicalStockCategory(raw, context = {}) {
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

  const sourceObjectId = deriveStableId(guid, masterId, `SCAT_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "StockCategory",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent: parent || null,
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

/**
 * Normalize raw StockItem into Canonical StockItem
 */
function normalizeCanonicalStockItem(raw, context = {}) {
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
  const category = (raw.CATEGORY || raw.Category || "").trim() || null;
  const baseUnits = (raw.BASEUNITS || raw.BaseUnits || "").trim() || null;

  const openingBalance = raw.OPENINGBALANCE || raw.OpeningBalance || 0;
  const openingValue = raw.OPENINGVALUE || raw.OpeningValue || 0;
  const openingRate = raw.OPENINGRATE || raw.OpeningRate || 0;

  const costingMethod = (raw.COSTINGMETHOD || raw.CostingMethod || "Default").trim();
  const valuationMethod = (raw.VALUATIONMETHOD || raw.ValuationMethod || "Default").trim();
  const gstTypeOfSupply = (raw.GSTTYPEOFSUPPLY || raw.GstTypeofSupply || "Goods").trim();
  const hsnCode = (raw.HSNCODE || raw.HsnCode || "").trim() || null;

  const sourceObjectId = deriveStableId(guid, masterId, `SITM_${parent}_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "StockItem",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent: parent || "Primary",
    category,
    baseUnits,
    openingBalance: {
      quantity: typeof openingBalance === "number" ? openingBalance : parseFloat(String(openingBalance).replace(/[^0-9.-]/g, "")) || 0,
      value: toDecimalString(typeof openingValue === "number" ? Math.abs(openingValue) : parseFloat(String(openingValue).replace(/[^0-9.-]/g, "")) || 0),
      rate: typeof openingRate === "number" ? openingRate : parseFloat(String(openingRate).replace(/[^0-9.-]/g, "")) || 0
    },
    costingMethod,
    valuationMethod,
    gst: {
      typeOfSupply: gstTypeOfSupply,
      hsnCode
    },
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

/**
 * Normalize raw Godown into Canonical Godown
 */
function normalizeCanonicalGodown(raw, context = {}) {
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
  const address = (raw.ADDRESS || raw.Address || "").trim() || null;
  const pinCode = (raw.PINCODE || raw.PinCode || "").trim() || null;

  const sourceObjectId = deriveStableId(guid, masterId, `GDN_${name}`);

  const canonical = {
    sourceCompanyId,
    sourceObjectId,
    objectType: "Godown",
    mappingVersion: MAPPING_VERSION,
    parserVersion: PARSER_VERSION,
    extractionRunId,
    name,
    parent: parent || null,
    isPrimary: !parent || parent === "Primary" || parent === "Main Location",
    address,
    pinCode,
    guid: guid || null,
    masterId: masterId ? Number(masterId) : null,
    alterId: alterId ? Number(alterId) : null
  };

  canonical.checksum = recordChecksum(canonical);
  return canonical;
}

module.exports = {
  normalizeCanonicalStockGroup,
  normalizeCanonicalStockCategory,
  normalizeCanonicalStockItem,
  normalizeCanonicalGodown
};
