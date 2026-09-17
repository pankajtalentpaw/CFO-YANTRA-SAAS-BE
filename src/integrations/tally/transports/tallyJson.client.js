const axios = require("axios");
const env = require("../../../config/env");
const { logger } = require("../../../utils/logger");

/**
 * Execute a native JSON request to TallyPrime adhering to the Tally API Explorer specification.
 *
 * @param {object} params
 * @param {object} [params.headers] - HTTP headers (version, tallyrequest, type, id)
 * @param {object} params.body - Request payload (stat_vars_list, tdlmessage)
 * @param {string} [params.host]
 * @param {number} [params.port]
 * @param {number} [params.timeoutMs]
 * @returns {Promise<object>}
 */
async function sendTallyJson({
  headers = {},
  body = {},
  host = env.tally.host,
  port = env.tally.port,
  timeoutMs = env.tally.timeoutMs
}) {
  const url = `http://${host}:${port}`;
  const startedAt = Date.now();

  const reqHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    version: "1",
    tallyrequest: "Export",
    ...headers
  };

  try {
    const response = await axios.post(url, body, {
      headers: reqHeaders,
      timeout: timeoutMs,
      validateStatus: () => true
    });

    const responseTimeMs = Date.now() - startedAt;
    const rawData = response.data;

    // Check if Tally returned JSON object
    if (typeof rawData === "object" && rawData !== null) {
      if (rawData.status === "1") {
        return {
          success: true,
          format: "JSON",
          statusCode: response.status,
          responseTimeMs,
          data: rawData.data,
          metadata: rawData.data?.metadata || {},
          collection: rawData.data?.collection || null
        };
      }

      // Explicit Tally error
      const errorMsg =
        (Array.isArray(rawData.error_list) && rawData.error_list.join("; ")) ||
        rawData.error ||
        "Tally reported failure status (status: 0)";

      return {
        success: false,
        format: "JSON",
        statusCode: response.status,
        responseTimeMs,
        errorCode: "TALLY_JSON_ERROR",
        errorMessage: errorMsg,
        rawResponse: rawData
      };
    }

    // If response was not JSON (e.g. XML returned from older Tally)
    const textData = String(rawData || "").trim();
    if (textData.startsWith("<ENVELOPE")) {
      return {
        success: false,
        format: "XML_RETURNED",
        statusCode: response.status,
        responseTimeMs,
        errorCode: "TALLY_JSON_UNSUPPORTED",
        errorMessage: "Tally returned XML instead of requested JSON format.",
        rawResponse: textData
      };
    }

    return {
      success: false,
      format: "UNKNOWN",
      statusCode: response.status,
      responseTimeMs,
      errorCode: "INVALID_TALLY_RESPONSE",
      errorMessage: "Received unparseable response from Tally",
      rawResponse: textData
    };
  } catch (err) {
    const responseTimeMs = Date.now() - startedAt;
    logger.debug({ error: err.message, code: err.code, url }, "Tally JSON request failed");

    return {
      success: false,
      format: "JSON",
      statusCode: null,
      responseTimeMs,
      errorCode: err.code || "NETWORK_ERROR",
      errorMessage: err.message
    };
  }
}

module.exports = {
  sendTallyJson
};
