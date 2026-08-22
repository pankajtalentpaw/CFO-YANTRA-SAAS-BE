const { sendXmlRequest } = require("./transports/xml.transport");
const { sendJsonRequest } = require("./transports/json.transport");
const { sendJsonExRequest } = require("./transports/jsonex.transport");
const { buildCompanyListRequest, buildProbeXml, buildCompanyProbeRequest } = require("./tally.requests");
const { checkHeartbeat, getTallyUrl } = require("./tally.client");
const env = require("../../config/env");
const { logger } = require("../../utils/logger");

/**
 * Select best format based on priority: JSONEx -> JSON -> XML
 * @param {object} formats - { xml: boolean, json: boolean, jsonEx: boolean }
 * @returns {string} Selected format name ("JSONEx" | "JSON" | "XML" | "NONE")
 */
function selectBestFormat(formats = {}) {
  if (formats.jsonEx) return "JSONEx";
  if (formats.json) return "JSON";
  if (formats.xml) return "XML";
  return "NONE";
}

/**
 * Comprehensive capability detection across all transports (XML, JSON, JSONEx)
 * @param {object} [options={}]
 * @returns {Promise<object>} Capabilities manifest
 */
async function detectCapabilities(options = {}) {
  const host = options.host || env.tally.host;
  const port = options.port || env.tally.port;
  const timeoutMs = options.timeoutMs || env.tally.timeoutMs || 5000;

  logger.debug({ host, port }, "Starting Tally multi-format capability detection");

  // 1. Check basic reachability
  const heartbeat = await checkHeartbeat({ host, port, timeoutMs });
  if (!heartbeat.alive) {
    return {
      tallyReachable: false,
      tallyVersion: null,
      port,
      formats: {
        xml: false,
        json: false,
        jsonEx: false
      },
      companies: [],
      selectedFormat: "NONE",
      error: heartbeat.error || "CONNECTION_REFUSED"
    };
  }

  const formats = {
    xml: false,
    json: false,
    jsonEx: false
  };

  const timing = {
    xmlMs: null,
    jsonMs: null,
    jsonExMs: null
  };

  let loadedCompanies = [];
  let tallyVersion = "TallyPrime (Live)";

  // 2. Test XML Transport (Baseline Compatibility)
  const probeXml = buildProbeXml();
  const xmlResult = await sendXmlRequest({ xml: probeXml, host, port, timeoutMs });
  if (xmlResult.success) {
    formats.xml = true;
    timing.xmlMs = xmlResult.responseTimeMs;

    // Check companies
    const col = xmlResult.parsedResponse ? xmlResult.parsedResponse.collection : [];
    loadedCompanies = col.map((c) => (c.NAME || c.Name || c["@_NAME"] || null)).filter(Boolean);
    if (xmlResult.parsedResponse && xmlResult.parsedResponse.envelope && xmlResult.parsedResponse.envelope.HEADER) {
      const v = xmlResult.parsedResponse.envelope.HEADER.VERSION;
      if (v) tallyVersion = `Version ${v}`;
    }
  }

  // 3. Test JSON Transport
  const jsonQueryXml = buildCompanyProbeRequest("JSON");

  const jsonResult = await sendJsonRequest({ request: jsonQueryXml, host, port, timeoutMs });
  if (jsonResult.success) {
    formats.json = true;
    timing.jsonMs = jsonResult.responseTimeMs;
  }

  // 4. Test JSONEx Transport
  const jsonExQueryXml = buildCompanyProbeRequest("JSONEx");

  const jsonExResult = await sendJsonExRequest({ request: jsonExQueryXml, host, port, timeoutMs });
  if (jsonExResult.success) {
    formats.jsonEx = true;
    timing.jsonExMs = jsonExResult.responseTimeMs;
  }

  const selectedFormat = selectBestFormat(formats);

  return {
    tallyReachable: true,
    tallyVersion,
    port,
    formats,
    timing,
    companies: loadedCompanies,
    companyCount: loadedCompanies.length,
    selectedFormat,
    fallbackReason: selectedFormat === "XML" && (!formats.json && !formats.jsonEx)
      ? "JSON/JSONEx formats not natively supported on this Tally instance. Automatic fallback to XML baseline."
      : null
  };
}

module.exports = {
  selectBestFormat,
  detectCapabilities
};
