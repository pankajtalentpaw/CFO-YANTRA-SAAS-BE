/**
 * Deterministic error codes for the FACT_SALES ingestion pipeline.
 * Every error identifies company, source, stage and retryability.
 */

const INGESTION_ERROR_CODES = Object.freeze({
  TALLY_CONNECTION_FAILED: "TALLY_CONNECTION_FAILED",
  TALLY_TIMEOUT: "TALLY_TIMEOUT",
  TALLY_PAUSED: "TALLY_PAUSED",
  TALLY_BUSY: "TALLY_BUSY",
  TALLY_INVALID_RESPONSE: "TALLY_INVALID_RESPONSE",
  TALLY_XML_PARSE_ERROR: "TALLY_XML_PARSE_ERROR",
  TALLY_NO_COMPANY: "TALLY_NO_COMPANY",
  TALLY_COMPANY_NOT_FOUND: "TALLY_COMPANY_NOT_FOUND",
  TALLY_MASTER_EXTRACTION_FAILED: "TALLY_MASTER_EXTRACTION_FAILED",
  TALLY_SALES_EXTRACTION_FAILED: "TALLY_SALES_EXTRACTION_FAILED",
  TALLY_UNSUPPORTED_FEATURE: "TALLY_UNSUPPORTED_FEATURE",
  TALLY_TDL_ERROR: "TALLY_TDL_ERROR"
});

/** Codes worth retrying — transport faults, not data or definition faults. */
const RETRYABLE = new Set([
  INGESTION_ERROR_CODES.TALLY_CONNECTION_FAILED,
  INGESTION_ERROR_CODES.TALLY_TIMEOUT,
  INGESTION_ERROR_CODES.TALLY_PAUSED,
  INGESTION_ERROR_CODES.TALLY_BUSY,
  INGESTION_ERROR_CODES.TALLY_MASTER_EXTRACTION_FAILED,
  INGESTION_ERROR_CODES.TALLY_SALES_EXTRACTION_FAILED
]);

/** Reasons a FACT_SALES field is null. Never used to fabricate a value. */
const DATA_QUALITY_REASONS = Object.freeze({
  SALESMAN_UNAVAILABLE: "SALESMAN_UNAVAILABLE",
  CITY_NOT_PARSEABLE: "CITY_NOT_PARSEABLE",
  ADDRESS_EMPTY: "ADDRESS_EMPTY",
  STATE_NOT_AVAILABLE: "STATE_NOT_AVAILABLE",
  TIER_NOT_CONFIGURED: "TIER_NOT_CONFIGURED",
  CUSTOMER_TYPE_NOT_CONFIGURED: "CUSTOMER_TYPE_NOT_CONFIGURED",
  STOCK_ITEM_NOT_FOUND: "STOCK_ITEM_NOT_FOUND",
  STOCK_GROUP_NOT_FOUND: "STOCK_GROUP_NOT_FOUND",
  LEDGER_NOT_FOUND: "LEDGER_NOT_FOUND",
  CUSTOMER_MISSING: "CUSTOMER_MISSING"
});

/**
 * Build a structured ingestion error.
 * @param {string} code One of INGESTION_ERROR_CODES
 * @param {object} details
 * @param {string} details.companyId
 * @param {string} details.source  e.g. "ledgerMaster", "salesVoucher"
 * @param {string} details.stage   e.g. "extract", "parse", "join", "validate"
 * @param {string} details.message
 */
function ingestionError(code, { companyId, source, stage, message } = {}) {
  const failureCode = INGESTION_ERROR_CODES[code] ? code : INGESTION_ERROR_CODES.TALLY_INVALID_RESPONSE;
  return {
    success: false,
    failureCode,
    companyId: companyId || null,
    source: source || null,
    stage: stage || null,
    message: message || failureCode,
    retryable: RETRYABLE.has(failureCode),
    timestamp: new Date().toISOString()
  };
}

/**
 * Detect a TallyPrime TDL fault in an error message or a response body.
 * Tally surfaces these as LINEERROR text or an "Error in TDL" modal.
 * @param {string} text
 * @returns {boolean}
 */
function isTdlError(text) {
  if (!text || typeof text !== "string") return false;
  return /error in tdl/i.test(text) ||
    /could not find description/i.test(text) ||
    /could not (?:set|find) (?:the )?(?:value|object|method)/i.test(text) ||
    /unknown (?:method|object|collection)/i.test(text);
}

/**
 * Map a transport-layer failure onto an ingestion error code.
 * @param {object} transportResult
 * @returns {string} ingestion error code
 */
function classifyTransportFailure(transportResult = {}) {
  const message = String(transportResult.errorMessage || transportResult.error || "");
  const body = String(transportResult.rawResponse || "");

  // A TDL fault is a request-definition bug and must never be reported as a
  // network timeout, even though a TDL modal also makes Tally stop responding.
  if (isTdlError(message) || isTdlError(body)) return INGESTION_ERROR_CODES.TALLY_TDL_ERROR;
  // Checked before the timeout rule: the breaker refuses without dialling, and
  // reporting that as a timeout would tell the user to wait for nothing.
  if (transportResult.errorCode === "ETALLYBUSY") return INGESTION_ERROR_CODES.TALLY_BUSY;
  if (transportResult.errorCode === "ETALLYUNAVAILABLE") return INGESTION_ERROR_CODES.TALLY_PAUSED;
  if (/timeout/i.test(message)) return INGESTION_ERROR_CODES.TALLY_TIMEOUT;
  if (/ECONNREFUSED|not reachable|unreachable/i.test(message)) return INGESTION_ERROR_CODES.TALLY_CONNECTION_FAILED;
  if (/xml|parse|malformed/i.test(message)) return INGESTION_ERROR_CODES.TALLY_XML_PARSE_ERROR;
  return INGESTION_ERROR_CODES.TALLY_INVALID_RESPONSE;
}

module.exports = {
  isTdlError,
  INGESTION_ERROR_CODES,
  DATA_QUALITY_REASONS,
  ingestionError,
  classifyTransportFailure
};
