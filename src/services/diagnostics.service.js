const { FAILURE_CODES, FAILURE_METADATA } = require("../constants/failureCodes");

/**
 * Detect Tally's "Could not find description!" TDL resolution failure.
 * Tally reports it in a LINEERROR or a modal, never as a transport error.
 * @param {string} text
 * @returns {boolean}
 */
function isCollectionDescriptionError(text) {
  if (!text || typeof text !== "string") return false;
  return /could not find description/i.test(text) ||
    (/error in tdl/i.test(text) && /collection\s*:/i.test(text));
}

/**
 * Classify raw network or runtime errors into standardized failure diagnostics
 * @param {Error|object} error
 * @param {object} [context={}]
 * @returns {object} Structured diagnostic payload
 */
function classifyError(error, context = {}) {
  let code = FAILURE_CODES.UNKNOWN_ERROR;
  const message = error ? (error.message || String(error)) : "Unknown error";
  const errCode = error ? (error.code || "") : "";

  if (context.isReadOnlyViolation) {
    code = FAILURE_CODES.READ_ONLY_VIOLATION;
  } else if (context.isInvalidCollection || isCollectionDescriptionError(message)) {
    // A TDL resolution failure is a request-definition bug, never a network fault.
    code = FAILURE_CODES.TALLY_INVALID_COLLECTION;
  } else if (errCode === "ETALLYBUSY") {
    code = FAILURE_CODES.TALLY_BUSY;
  } else if (errCode === "ETALLYUNAVAILABLE") {
    // Not a fresh timeout — the breaker refused before dialling, on purpose.
    code = FAILURE_CODES.TALLY_PAUSED;
  } else if (errCode === "ECONNREFUSED") {
    // If connection was refused on default or configured port
    code = context.isNonDefaultPort ? FAILURE_CODES.WRONG_PORT : FAILURE_CODES.TALLY_STOPPED;
  } else if (errCode === "ETIMEDOUT" || errCode === "ECONNABORTED" || message.includes("timeout")) {
    code = FAILURE_CODES.CONNECTION_TIMEOUT;
  } else if (errCode === "ENOTFOUND" || errCode === "EHOSTUNREACH") {
    code = FAILURE_CODES.CONNECTION_REFUSED;
  } else if (context.isMalformedXml) {
    code = FAILURE_CODES.MALFORMED_XML;
  } else if (context.hasLineError) {
    code = FAILURE_CODES.LINE_ERROR;
  } else if (context.isInvalidEnvelope) {
    code = FAILURE_CODES.INVALID_ENVELOPE;
  } else if (context.isEmptyResponse) {
    code = FAILURE_CODES.EMPTY_RESPONSE;
  } else if (context.noCompany) {
    code = FAILURE_CODES.NO_COMPANY;
  }

  const meta = FAILURE_METADATA[code] || FAILURE_METADATA[FAILURE_CODES.UNKNOWN_ERROR];

  return {
    success: false,
    failureCode: code,
    retryable: meta.retryable,
    severity: meta.severity,
    diagnosticHint: meta.diagnosticHint,
    userAction: meta.userAction,
    errorMessage: message,
    rawErrorCode: errCode || undefined,
    timestamp: new Date().toISOString()
  };
}

/**
 * Build a structured diagnostic response for known conditions
 * @param {string} failureCode
 * @param {object} [extraDetails={}]
 * @returns {object}
 */
function buildDiagnosticReport(failureCode, extraDetails = {}) {
  const meta = FAILURE_METADATA[failureCode] || FAILURE_METADATA[FAILURE_CODES.UNKNOWN_ERROR];
  return {
    success: false,
    failureCode: failureCode in FAILURE_METADATA ? failureCode : FAILURE_CODES.UNKNOWN_ERROR,
    retryable: meta.retryable,
    severity: meta.severity,
    diagnosticHint: meta.diagnosticHint,
    userAction: meta.userAction,
    timestamp: new Date().toISOString(),
    ...extraDetails
  };
}

module.exports = {
  classifyError,
  buildDiagnosticReport,
  isCollectionDescriptionError
};
