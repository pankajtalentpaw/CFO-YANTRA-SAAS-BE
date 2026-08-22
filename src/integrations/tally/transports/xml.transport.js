const { sendXml } = require("../tally.client");
const { parseTallyResponse } = require("../tally.parser");
const env = require("../../../config/env");
const { logger } = require("../../../utils/logger");

/**
 * Send a read-only XML request to TallyPrime
 * @param {object} params
 * @param {string} params.xml
 * @param {string} [params.host]
 * @param {number} [params.port]
 * @param {number} [params.timeoutMs]
 * @param {boolean} [params.force] Bypass the availability cooldown (user-initiated retry only)
 * @returns {Promise<object>} Normalized XML transport result
 */
async function sendXmlRequest({ xml, host = env.tally.host, port = env.tally.port, timeoutMs = env.tally.timeoutMs, force = false }) {
  try {
    const res = await sendXml(xml, { host, port, timeoutMs, force });
    const rawResponse = res.body || "";
    const responseSize = Buffer.byteLength(typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse), "utf8");

    const parsed = parseTallyResponse(typeof rawResponse === "string" ? rawResponse : "");
    const isSuccess = res.statusCode >= 200 && res.statusCode < 300 && parsed.success;

    return {
      success: isSuccess,
      format: "XML",
      statusCode: res.statusCode,
      responseTimeMs: res.responseTimeMs,
      responseSize,
      rawResponse,
      parsedResponse: parsed,
      lineError: parsed.lineError || null,
      errorCode: !isSuccess ? (parsed.lineError ? "LINE_ERROR" : "INVALID_RESPONSE") : null
    };
  } catch (error) {
    return {
      success: false,
      format: "XML",
      statusCode: null,
      responseTimeMs: error.responseTimeMs || 0,
      responseSize: 0,
      rawResponse: null,
      parsedResponse: null,
      errorCode: error.code || "CONNECTION_FAILED",
      errorMessage: error.message
    };
  }
}

module.exports = {
  sendXmlRequest
};
