const { recordChecksum } = require("../../../utils/checksum");

/**
 * TallyPrime Native JSON Parser & Normalizer
 *
 * Normalizes Tally's typed JSON values into clean canonical JS models:
 *   { type: "String", value: "Capital Account" } -> "Capital Account"
 *   { type: "Amount", value: "12500.00" }        -> 12500
 *   { type: "Date", value: "20230401" }          -> "2023-04-01"
 *   { type: "Logical", value: "Yes" }            -> true
 */

"use strict";

/** Converts Tally compact YYYYMMDD or ISO YYYY-MM-DD to ISO YYYY-MM-DD */
function normalizeDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (/^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  }
  return str;
}

/** Parses Tally typed values into JS primitives */
function parseTypedValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== "object") return val;

  if (val.type && val.value !== undefined) {
    const type = String(val.type).toLowerCase();
    const rawVal = val.value;

    if (type === "amount" || type === "number" || type === "quantity") {
      const num = Number(rawVal);
      return isNaN(num) ? rawVal : num;
    }

    if (type === "logical" || type === "boolean") {
      return rawVal === "Yes" || rawVal === "True" || rawVal === true || rawVal === "1";
    }

    if (type === "date") {
      return normalizeDate(rawVal);
    }

    return typeof rawVal === "string" ? rawVal.trim() : rawVal;
  }

  if (Array.isArray(val)) {
    return val.map(parseTypedValue);
  }

  const out = {};
  for (const [k, v] of Object.entries(val)) {
    if (k === "metadata") continue;
    out[k] = parseTypedValue(v);
  }
  return out;
}

/** Derives a stable sourceObjectId for a master record */
function deriveStableId(guid, masterId, name) {
  if (guid && String(guid).trim()) return String(guid).trim();
  if (masterId !== null && masterId !== undefined) return `MID_${masterId}`;
  if (name && String(name).trim()) return `NAME_${String(name).trim()}`;
  return null;
}

/**
 * Normalizes a single collection record from Tally's JSON format.
 */
function normalizeCollectionItem(item, { companyId = null } = {}) {
  if (!item || typeof item !== "object") return null;

  const metadata = item.metadata || {};
  const objectType = metadata.type || "Master";
  const name = metadata.name || (typeof item.name === "object" ? item.name?.value : item.name) || "";

  const parsed = {};
  for (const [k, v] of Object.entries(item)) {
    if (k === "metadata") continue;
    parsed[k] = parseTypedValue(v);
  }

  const guid = parsed.guid || parsed.Guid || metadata.guid || null;
  const masterId = parsed.masterid || parsed.MasterId || metadata.masterId || null;
  const sourceObjectId = deriveStableId(guid, masterId, name);

  const out = {
    ...parsed,
    objectType,
    name: String(name).trim(),
    guid: guid ? String(guid).trim() : null,
    masterId: masterId ? Number(masterId) : null,
    sourceObjectId: sourceObjectId || `OBJ_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  };

  if (companyId) {
    out.companyId = companyId;
    out.sourceCompanyId = companyId;
  }

  out.checksum = recordChecksum(out);
  return out;
}

/**
 * Normalizes an entire Tally collection response into a canonical array.
 */
function parseJsonCollection(response, { companyId = null } = {}) {
  if (!response) return [];

  const collection =
    response.collection ||
    response.data?.collection ||
    (Array.isArray(response) ? response : null);

  if (!Array.isArray(collection)) return [];

  return collection
    .map((item) => normalizeCollectionItem(item, { companyId }))
    .filter(Boolean);
}

/**
 * Normalizes a Tally Balance Sheet response from native JSON.
 */
function parseJsonBalanceSheet(response) {
  const data = response.data || response;
  const bsbody = data.bsbody || data.report || {};
  const sources = bsbody.bsinfo?.bssources?.bsdetail || [];
  const applications = bsbody.bsinfo?.bsapplications?.bsdetail || [];

  const parseDetail = (item) => {
    const name = item.bsname?.dspaccname?.dspdispname || item.name || "Unknown";
    const amount = item.bsamt?.[0]?.bsmainamt ?? item.amount ?? 0;
    return { name, amount: Number(amount) || 0 };
  };

  return {
    report: "Balance Sheet",
    sources: Array.isArray(sources) ? sources.map(parseDetail) : [],
    applications: Array.isArray(applications) ? applications.map(parseDetail) : []
  };
}

/**
 * Normalizes a Tally Profit & Loss response from native JSON.
 */
function parseJsonProfitAndLoss(response) {
  const data = response.data || response;
  const plbody = data.plbody || data.report || {};

  return {
    report: "Profit and Loss",
    details: parseTypedValue(plbody)
  };
}

module.exports = {
  parseTypedValue,
  normalizeCollectionItem,
  parseJsonCollection,
  parseJsonBalanceSheet,
  parseJsonProfitAndLoss,
  deriveStableId
};
