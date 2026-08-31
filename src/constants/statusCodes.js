/**
 * HTTP Status Codes, Application Error Codes, and Error Resolution Planning
 * CFO Yantra - Tally Integration Engine & REST API
 */

"use strict";

/**
 * Standard HTTP Status Codes
 */
const HTTP_STATUS = Object.freeze({
  // 2xx Success
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  // 3xx Redirection
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  NOT_MODIFIED: 304,

  // 4xx Client Errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
});

/**
 * Standard Application Error Codes
 */
const APP_ERROR_CODES = Object.freeze({
  // Client / Request Errors
  INVALID_QUERY_PARAMS: "INVALID_QUERY_PARAMS",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  COMPANY_NOT_FOUND: "COMPANY_NOT_FOUND",
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  API_VERSION_UNSUPPORTED: "API_VERSION_UNSUPPORTED",
  API_VERSION_RETIRED: "API_VERSION_RETIRED",
  API_VERSION_INVALID_FORMAT: "API_VERSION_INVALID_FORMAT",

  // TallyPrime Integration Errors
  TALLY_CONNECTION_FAILED: "TALLY_CONNECTION_FAILED",
  TALLY_TIMEOUT: "TALLY_TIMEOUT",
  TALLY_BUSY: "TALLY_BUSY",
  TALLY_PAUSED: "TALLY_PAUSED",
  TALLY_NO_COMPANY_LOADED: "TALLY_NO_COMPANY_LOADED",
  TALLY_INVALID_TDL: "TALLY_INVALID_TDL",
  TALLY_PARSE_ERROR: "TALLY_PARSE_ERROR",

  // Database / MongoDB Mirror Errors
  DB_CONNECTION_FAILED: "DB_CONNECTION_FAILED",
  DB_QUERY_FAILED: "DB_QUERY_FAILED",
  DB_SYNC_FAILED: "DB_SYNC_FAILED",
  DB_MIRROR_UNAVAILABLE: "DB_MIRROR_UNAVAILABLE",

  // External / AI Engine Errors
  AI_SERVICE_UNAVAILABLE: "AI_SERVICE_UNAVAILABLE",
  AI_API_KEY_INVALID: "AI_API_KEY_INVALID",
  AI_RATE_LIMIT: "AI_RATE_LIMIT",

  // Internal System Errors
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  UNHANDLED_EXCEPTION: "UNHANDLED_EXCEPTION"
});

/**
 * Comprehensive Error Planning & Diagnostic Matrix
 * Maps each error scenario to its severity, retry capability, action plan, and recovery steps.
 */
const ERROR_PLAN = Object.freeze({
  [APP_ERROR_CODES.INVALID_QUERY_PARAMS]: {
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    severity: "LOW",
    retryable: false,
    diagnosticHint: "Request URL contains invalid, missing, or malformed query string parameters.",
    actionPlan: "Validate parameters against Zod schema. Inspect caller query string for syntax issues.",
    userAction: "Check your search or filter inputs (e.g. fromDate/toDate should be in YYYYMMDD format) and retry."
  },
  [APP_ERROR_CODES.INVALID_PAYLOAD]: {
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    severity: "LOW",
    retryable: false,
    diagnosticHint: "POST/PUT JSON request body failed validation against the schema contract.",
    actionPlan: "Review request payload against API contract. Return field-level validation errors.",
    userAction: "Correct the required fields in the request and resubmit."
  },
  [APP_ERROR_CODES.RESOURCE_NOT_FOUND]: {
    httpStatus: HTTP_STATUS.NOT_FOUND,
    severity: "LOW",
    retryable: false,
    diagnosticHint: "Requested entity ID (voucher, ledger, item, etc.) does not exist in Tally or MongoDB mirror.",
    actionPlan: "Confirm entity exists in Tally and verify company ID context.",
    userAction: "Verify that the requested record ID exists and is part of the selected company."
  },
  [APP_ERROR_CODES.COMPANY_NOT_FOUND]: {
    httpStatus: HTTP_STATUS.NOT_FOUND,
    severity: "MEDIUM",
    retryable: true,
    diagnosticHint: "Requested companyId or company name is not currently open in TallyPrime.",
    actionPlan: "Check /api/v1/tally/companies to see currently open companies. Ensure company scope matches.",
    userAction: "Open the company in TallyPrime, then refresh the dashboard."
  },
  [APP_ERROR_CODES.ROUTE_NOT_FOUND]: {
    httpStatus: HTTP_STATUS.NOT_FOUND,
    severity: "LOW",
    retryable: false,
    diagnosticHint: "Requested API endpoint URL or HTTP method does not match any registered route.",
    actionPlan: "Inspect API route registration in src/routes.",
    userAction: "Check endpoint URL and method in the API documentation (/api/v1/health)."
  },
  [APP_ERROR_CODES.TALLY_CONNECTION_FAILED]: {
    httpStatus: HTTP_STATUS.BAD_GATEWAY,
    severity: "CRITICAL",
    retryable: true,
    diagnosticHint: "TCP connection to TallyPrime refused (host/port unreachable).",
    actionPlan: "1. Check if TallyPrime is running.\n2. Confirm port in Tally F1 > Settings > Connectivity matches TALLY_PORT in .env.\n3. Test with npm run probe.",
    userAction: "Ensure TallyPrime is running on the system with ODBC/HTTP connectivity enabled on the configured port."
  },
  [APP_ERROR_CODES.TALLY_TIMEOUT]: {
    httpStatus: HTTP_STATUS.GATEWAY_TIMEOUT,
    severity: "HIGH",
    retryable: true,
    diagnosticHint: "Tally took longer than TALLY_TIMEOUT_MS to answer the extraction request.",
    actionPlan: "1. Increase TALLY_TIMEOUT_MS for large companies.\n2. Narrow query date range.\n3. Check if modal dialog is open in Tally.",
    userAction: "Close any modal popups open in TallyPrime. Try selecting a shorter date range."
  },
  [APP_ERROR_CODES.TALLY_BUSY]: {
    httpStatus: HTTP_STATUS.SERVICE_UNAVAILABLE,
    severity: "LOW",
    retryable: true,
    diagnosticHint: "TallyPrime is currently executing another heavy extraction job.",
    actionPlan: "Queue request or return 503 with retry-after header. Concurrency with Tally is serial.",
    userAction: "TallyPrime is currently busy with another report. Please wait a few seconds and retry."
  },
  [APP_ERROR_CODES.TALLY_PAUSED]: {
    httpStatus: HTTP_STATUS.SERVICE_UNAVAILABLE,
    severity: "HIGH",
    retryable: true,
    diagnosticHint: "Tally accepted connection but never returned data; requests paused to avoid queue stacking.",
    actionPlan: "Inspect Task Manager for zombie tally.exe instances holding the port. Automatic reconnect will resume.",
    userAction: "Close any open dialog in TallyPrime. If stuck, close and reopen TallyPrime."
  },
  [APP_ERROR_CODES.DB_CONNECTION_FAILED]: {
    httpStatus: HTTP_STATUS.SERVICE_UNAVAILABLE,
    severity: "HIGH",
    retryable: true,
    diagnosticHint: "MongoDB Atlas or local instance connection failed or timed out.",
    actionPlan: "1. Verify MONGODB_URI format.\n2. Check network whitelist in MongoDB Atlas.\n3. Verify DNS resolution for SRV records.",
    userAction: "System has fallen back to live Tally reads. Check MongoDB Atlas connectivity & IP access list."
  },
  [APP_ERROR_CODES.DB_SYNC_FAILED]: {
    httpStatus: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    severity: "MEDIUM",
    retryable: true,
    diagnosticHint: "An error occurred while writing mirrored company records to MongoDB collections.",
    actionPlan: "Inspect sync log details in /api/sync/status. Check MongoDB schema and collection write locks.",
    userAction: "Trigger manual sync from Settings > Sync or wait for the next scheduled auto-sync tick."
  },
  [APP_ERROR_CODES.AI_SERVICE_UNAVAILABLE]: {
    httpStatus: HTTP_STATUS.SERVICE_UNAVAILABLE,
    severity: "MEDIUM",
    retryable: true,
    diagnosticHint: "OpenAI API request failed, API key is missing, or network timed out.",
    actionPlan: "Verify OPENAI_API_KEY in .env. Engine falls back to local deterministic rule-based analysis.",
    userAction: "AI features will use offline rule-based financial models until OpenAI connectivity is restored."
  },
  [APP_ERROR_CODES.INTERNAL_SERVER_ERROR]: {
    httpStatus: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    severity: "HIGH",
    retryable: false,
    diagnosticHint: "Unhandled exception thrown within backend service logic.",
    actionPlan: "Inspect stack trace in backend logs. Check recent code changes or unhandled edge cases.",
    userAction: "An unexpected error occurred. Please contact the administrator or inspect server logs."
  }
});

/**
 * Standard Custom Application Error Class
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code (from HTTP_STATUS)
   * @param {string} message - Human-readable error message
   * @param {string} [errorCode] - Application error code (from APP_ERROR_CODES)
   * @param {any} [details] - Detailed error context or validation issues
   */
  constructor(statusCode, message, errorCode = null, details = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
    this.errorCode = errorCode || (this.statusCode >= 500 ? APP_ERROR_CODES.INTERNAL_SERVER_ERROR : APP_ERROR_CODES.VALIDATION_FAILED);
    this.details = details || null;
    this.timestamp = new Date().toISOString();

    // Look up recovery plan if available
    const plan = ERROR_PLAN[this.errorCode];
    this.actionPlan = plan ? plan.actionPlan : null;
    this.userAction = plan ? plan.userAction : null;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  // Factory methods for clean error throwing
  static badRequest(message, errorCode = APP_ERROR_CODES.INVALID_QUERY_PARAMS, details = null) {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, message, errorCode, details);
  }

  static notFound(message, errorCode = APP_ERROR_CODES.RESOURCE_NOT_FOUND, details = null) {
    return new ApiError(HTTP_STATUS.NOT_FOUND, message, errorCode, details);
  }

  static badGateway(message, errorCode = APP_ERROR_CODES.TALLY_CONNECTION_FAILED, details = null) {
    return new ApiError(HTTP_STATUS.BAD_GATEWAY, message, errorCode, details);
  }

  static serviceUnavailable(message, errorCode = APP_ERROR_CODES.TALLY_BUSY, details = null) {
    return new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, message, errorCode, details);
  }

  static internal(message, errorCode = APP_ERROR_CODES.INTERNAL_SERVER_ERROR, details = null) {
    return new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, message, errorCode, details);
  }
}

/**
 * Helper to build consistent JSON error payloads across all endpoints
 */
function createErrorPayload(statusCode, message, errorCode = null, details = null) {
  const plan = errorCode && ERROR_PLAN[errorCode] ? ERROR_PLAN[errorCode] : null;
  return {
    success: false,
    statusCode,
    errorCode: errorCode || (statusCode >= 500 ? APP_ERROR_CODES.INTERNAL_SERVER_ERROR : APP_ERROR_CODES.VALIDATION_FAILED),
    error: message,
    details: details || undefined,
    userAction: plan ? plan.userAction : undefined,
    timestamp: new Date().toISOString()
  };
}

/**
 * Express helper to send standardized error responses
 */
function sendError(res, statusCode, message, errorCode = null, details = null) {
  const payload = createErrorPayload(statusCode, message, errorCode, details);
  return res.status(statusCode).json(payload);
}

module.exports = {
  HTTP_STATUS,
  APP_ERROR_CODES,
  ERROR_PLAN,
  ApiError,
  createErrorPayload,
  sendError
};
