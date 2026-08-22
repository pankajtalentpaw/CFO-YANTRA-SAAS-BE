const axios = require("axios");
const env = require("../../../config/env");
const { logger } = require("../../../utils/logger");

/**
 * Send a read-only JSON request to TallyPrime
 * @param {object} params
 * @param {string|object} params.request
 * @param {string} [params.host]
 * @param {number} [params.port]
 * @param {number} [params.timeoutMs]
 * @returns {Promise<object>}
 */
async function sendJsonRequest({ request, host = env.tally.host, port = env.tally.port, timeoutMs = env.tally.timeoutMs }) {
  const url = `http://${host}:${port}`;
  const startedAt = Date.now();

  // If request is an XML envelope with SVEXPORTFORMAT JSON
  const isXmlEnvelope = typeof request === "string" && request.trim().startsWith("<ENVELOPE");
  const payload = isXmlEnvelope ? request : (typeof request === "string" ? request : JSON.stringify(request));
  const contentType = isXmlEnvelope ? "text/xml; charset=utf-8" : "application/json; charset=utf-8";

  try {
    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": contentType
      },
      timeout: timeoutMs,
      responseType: "text",
      validateStatus: () => true
    });

    const responseTimeMs = Date.now() - startedAt;
    const rawResponse = response.data || "";
    const responseSize = Buffer.byteLength(typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse), "utf8");

    // Evaluate JSON validity
    let parsedJson = null;
    let isJson = false;

    if (typeof rawResponse === "object" && rawResponse !== null) {
      parsedJson = rawResponse;
      isJson = true;
    } else if (typeof rawResponse === "string") {
      const trimmed = rawResponse.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          parsedJson = JSON.parse(trimmed);
          isJson = true;
        } catch (e) {
          isJson = false;
        }
      }
    }

    // Check if Tally returned an explicit JSON error (e.g. status "0", error_list, etc.)
    const hasTallyError = parsedJson && (
      parsedJson.status === "0" ||
      (Array.isArray(parsedJson.error_list) && parsedJson.error_list.length > 0) ||
      parsedJson.error
    );

    if (!isJson || hasTallyError) {
      const errMsg = hasTallyError
        ? (Array.isArray(parsedJson.error_list) ? parsedJson.error_list.join("; ") : (parsedJson.error || "Tally returned JSON error"))
        : "Tally environment returned non-JSON data when JSON export was requested.";

      return {
        success: false,
        format: "JSON",
        statusCode: response.status,
        responseTimeMs,
        responseSize,
        rawResponse,
        parsedResponse: parsedJson,
        errorCode: "TALLY_JSON_UNSUPPORTED",
        errorMessage: errMsg
      };
    }

    return {
      success: true,
      format: "JSON",
      statusCode: response.status,
      responseTimeMs,
      responseSize,
      rawResponse,
      parsedResponse: parsedJson,
      errorCode: null
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    logger.debug({ url, error: error.message, code: error.code }, "JSON transport error");

    return {
      success: false,
      format: "JSON",
      statusCode: null,
      responseTimeMs,
      responseSize: 0,
      rawResponse: null,
      parsedResponse: null,
      errorCode: error.code || "TALLY_CONNECTION_FAILED",
      errorMessage: error.message
    };
  }
}

module.exports = {
  sendJsonRequest
};
