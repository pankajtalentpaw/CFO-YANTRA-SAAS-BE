const { normalizeCanonicalCompany, PARSER_VERSION } = require("./company.canonical");
const { normalizeArray } = require("../tally.parser");

/**
 * Universal Canonical Parser for Tally Transport Results
 * @param {object} transportResult - Result from sendXmlRequest / sendJsonRequest / sendJsonExRequest
 * @returns {object} Normalized canonical dataset
 */
function parseToCanonical(transportResult) {
  if (!transportResult || !transportResult.success) {
    return {
      success: false,
      sourceFormat: transportResult ? transportResult.format : "UNKNOWN",
      error: transportResult ? (transportResult.errorMessage || transportResult.errorCode) : "Empty transport result",
      companies: []
    };
  }

  const format = transportResult.format || "XML";
  let rawItems = [];

  if (format === "XML") {
    const parsed = transportResult.parsedResponse;
    if (parsed && parsed.collection) {
      rawItems = parsed.collection;
    }
  } else if (format === "JSON" || format === "JSONEx") {
    const data = transportResult.parsedResponse;
    if (Array.isArray(data)) {
      rawItems = data;
    } else if (data && typeof data === "object") {
      // Find collection or array property in JSON
      const candidates = data.collection || data.COLLECTION || data.data || data.DATA || data.companies || data.COMPANIES;
      if (candidates) {
        rawItems = normalizeArray(candidates);
      } else {
        // Find first array property
        const arrayProp = Object.values(data).find((v) => Array.isArray(v));
        if (arrayProp) {
          rawItems = arrayProp;
        } else {
          rawItems = [data];
        }
      }
    }
  }

  const companies = rawItems
    .map((item) => normalizeCanonicalCompany(item, format))
    .filter(Boolean);

  return {
    success: true,
    sourceFormat: format,
    parserVersion: PARSER_VERSION,
    count: companies.length,
    companies
  };
}

module.exports = {
  parseToCanonical
};
