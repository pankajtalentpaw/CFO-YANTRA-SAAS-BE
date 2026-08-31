/**
 * CFO Yantra - Universal API Versioning Engine & Error Planning
 *
 * Provides:
 *   1. Multi-strategy version extraction (URI path, X-API-Version, Accept-Version, query param)
 *   2. Version lifecycle management (Active, Deprecated with Sunset headers, Retired)
 *   3. Strict Version Error Planning Matrix (Unsupported, Retired, Invalid format)
 *   4. Custom ApiVersionError class extending standard ApiError
 *   5. Version stamping on all HTTP responses (X-API-Version, X-Supported-Versions)
 *   6. 100% backward-compatible unversioned fallback routing
 */

"use strict";

const { HTTP_STATUS, APP_ERROR_CODES, ApiError } = require("../constants/statusCodes");

/**
 * Versioning Configuration & Lifecycle
 */
const VERSION_CONFIG = Object.freeze({
  CURRENT: "v1",
  DEFAULT: "v1",
  SUPPORTED: Object.freeze(["v1"]),
  // Future versions can be added here with their sunset or deprecation dates
  DEPRECATED: Object.freeze({
    // e.g. "v0": { sunsetDate: "2026-12-31", alternative: "v1" }
  }),
  RETIRED: Object.freeze([
    // e.g. "v0.1"
  ]),
  HEADER_X_VERSION: "x-api-version",
  HEADER_ACCEPT_VERSION: "accept-version",
  QUERY_PARAM_VERSION: "api-version",
  QUERY_PARAM_SHORT: "v"
});

/**
 * API Versioning Error Codes
 */
const VERSION_ERROR_CODES = Object.freeze({
  UNSUPPORTED_VERSION: "API_VERSION_UNSUPPORTED",
  RETIRED_VERSION: "API_VERSION_RETIRED",
  INVALID_VERSION_FORMAT: "API_VERSION_INVALID_FORMAT",
  VERSION_MISMATCH: "API_VERSION_MISMATCH"
});

/**
 * API Versioning Error Planning & Recovery Matrix
 */
const VERSION_ERROR_PLAN = Object.freeze({
  [VERSION_ERROR_CODES.UNSUPPORTED_VERSION]: {
    httpStatus: HTTP_STATUS.NOT_FOUND,
    severity: "MEDIUM",
    retryable: false,
    diagnosticHint: `The requested API version is not supported by this server. Supported versions: [${VERSION_CONFIG.SUPPORTED.join(", ")}].`,
    actionPlan: `Check the URL path or headers. Switch to one of the active supported versions: ${VERSION_CONFIG.SUPPORTED.join(", ")}.`,
    userAction: `The requested API version does not exist. Please use version ${VERSION_CONFIG.CURRENT} (e.g. /api/${VERSION_CONFIG.CURRENT}/...).`
  },
  [VERSION_ERROR_CODES.RETIRED_VERSION]: {
    httpStatus: HTTP_STATUS.GONE, // 410 Gone
    severity: "HIGH",
    retryable: false,
    diagnosticHint: "This API version has reached end-of-life and is permanently shut down.",
    actionPlan: `Update client application or integration to target active version ${VERSION_CONFIG.CURRENT}.`,
    userAction: `This API version has been permanently retired. Please upgrade to ${VERSION_CONFIG.CURRENT}.`
  },
  [VERSION_ERROR_CODES.INVALID_VERSION_FORMAT]: {
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    severity: "LOW",
    retryable: false,
    diagnosticHint: "The supplied version identifier is malformed. Expected format: 'v1', 'v2' or numeric '1', '2'.",
    actionPlan: "Format version string with lowercase 'v' prefix followed by integer.",
    userAction: "Invalid API version format. Please specify a valid version (e.g. 'v1')."
  },
  [VERSION_ERROR_CODES.VERSION_MISMATCH]: {
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    severity: "LOW",
    retryable: false,
    diagnosticHint: "URI version path conflict with request header (X-API-Version).",
    actionPlan: "Ensure URL version matches the X-API-Version header value, or omit the header when using URL prefixing.",
    userAction: "The version in the URL path does not match the X-API-Version header. Please align both or omit the header."
  }
});

/**
 * Custom API Versioning Exception
 */
class ApiVersionError extends ApiError {
  constructor(errorCode, customMessage = null, requestedVersion = null) {
    const plan = VERSION_ERROR_PLAN[errorCode] || {
      httpStatus: HTTP_STATUS.BAD_REQUEST,
      diagnosticHint: "API versioning error",
      actionPlan: "Use supported version",
      userAction: "Invalid API version"
    };

    super(
      plan.httpStatus,
      customMessage || plan.userAction,
      errorCode,
      {
        requestedVersion,
        supportedVersions: VERSION_CONFIG.SUPPORTED,
        currentVersion: VERSION_CONFIG.CURRENT
      }
    );

    this.name = "ApiVersionError";
    this.diagnosticHint = plan.diagnosticHint;
    this.actionPlan = plan.actionPlan;
    this.userAction = plan.userAction;
  }
}

/**
 * Normalize any version string into standard "vN" format (e.g. "1" -> "v1", "V1" -> "v1", "v1.0" -> "v1")
 *
 * @param {string|number} rawVersion
 * @returns {string|null}
 */
function normalizeVersion(rawVersion) {
  if (!rawVersion) return null;
  const str = String(rawVersion).trim().toLowerCase();

  // If already starts with v (e.g. v1, v2)
  const vMatch = str.match(/^v(\d+)(?:\.\d+)*$/);
  if (vMatch) return `v${vMatch[1]}`;

  // If bare number (e.g. 1, 2, "1.0.0")
  const numMatch = str.match(/^(\d+)(?:\.\d+)*$/);
  if (numMatch) return `v${numMatch[1]}`;

  return null;
}

/**
 * Extract API version from request using multiple strategies:
 *   1. URL path (e.g. /api/v1/...)
 *   2. X-API-Version header
 *   3. Accept-Version header
 *   4. Query parameter (?api-version=1 or ?v=1)
 *
 * @param {import('express').Request} req
 * @returns {{ version: string, source: 'url'|'header'|'query'|'default', raw: string|null }}
 */
function extractVersion(req) {
  // Strategy 1: URL Path Regex (/api/v1/... or /v1/...)
  const pathMatch = req.originalUrl.match(/(?:\/api)?\/(v\d+)(?:\/|$)/i);
  if (pathMatch && pathMatch[1]) {
    const norm = normalizeVersion(pathMatch[1]);
    if (norm) return { version: norm, source: "url", raw: pathMatch[1] };
  }

  // Strategy 2: X-API-Version Header
  const headerVersion = req.headers[VERSION_CONFIG.HEADER_X_VERSION];
  if (headerVersion) {
    const norm = normalizeVersion(headerVersion);
    return { version: norm || headerVersion, source: "header", raw: headerVersion };
  }

  // Strategy 3: Accept-Version Header
  const acceptVersion = req.headers[VERSION_CONFIG.HEADER_ACCEPT_VERSION];
  if (acceptVersion) {
    const norm = normalizeVersion(acceptVersion);
    return { version: norm || acceptVersion, source: "header", raw: acceptVersion };
  }

  // Strategy 4: Query Parameters (?api-version=1 or ?v=1)
  const queryVersion = (req.query && (req.query[VERSION_CONFIG.QUERY_PARAM_VERSION] || req.query[VERSION_CONFIG.QUERY_PARAM_SHORT]));
  if (queryVersion) {
    const norm = normalizeVersion(queryVersion);
    return { version: norm || queryVersion, source: "query", raw: queryVersion };
  }

  // Strategy 5: Default Fallback
  return { version: VERSION_CONFIG.DEFAULT, source: "default", raw: null };
}

/**
 * Express Middleware for API Versioning
 *
 * Validates requested version, stamps response headers, handles deprecations & sunset warnings.
 */
function apiVersionMiddleware(options = {}) {
  const supported = options.supported || VERSION_CONFIG.SUPPORTED;
  const retired = options.retired || VERSION_CONFIG.RETIRED;
  const deprecated = options.deprecated || VERSION_CONFIG.DEPRECATED;

  return (req, res, next) => {
    const { version, source, raw } = extractVersion(req);

    // 1. Check if retired
    if (retired.includes(version)) {
      const error = new ApiVersionError(VERSION_ERROR_CODES.RETIRED_VERSION, null, version);
      return res.status(error.statusCode).json({
        success: false,
        statusCode: error.statusCode,
        errorCode: error.errorCode,
        error: error.message,
        details: error.details,
        userAction: error.userAction,
        timestamp: error.timestamp
      });
    }

    // 2. Check if valid format
    if (!version || !version.startsWith("v")) {
      const error = new ApiVersionError(VERSION_ERROR_CODES.INVALID_VERSION_FORMAT, null, raw);
      return res.status(error.statusCode).json({
        success: false,
        statusCode: error.statusCode,
        errorCode: error.errorCode,
        error: error.message,
        details: error.details,
        userAction: error.userAction,
        timestamp: error.timestamp
      });
    }

    // 3. Check if supported (only enforce strict rejection if explicitly requested via URL/header)
    if (source !== "default" && !supported.includes(version)) {
      const error = new ApiVersionError(VERSION_ERROR_CODES.UNSUPPORTED_VERSION, null, version);
      return res.status(error.statusCode).json({
        success: false,
        statusCode: error.statusCode,
        errorCode: error.errorCode,
        error: error.message,
        details: error.details,
        userAction: error.userAction,
        timestamp: error.timestamp
      });
    }

    // 4. Attach version metadata to req
    req.apiVersion = version;
    req.apiVersionSource = source;

    // 5. Stamp standard response headers
    res.setHeader("X-API-Version", version);
    res.setHeader("X-Supported-Versions", supported.join(", "));

    // 6. If version is deprecated, attach standard Sunset & Deprecation headers
    if (deprecated[version]) {
      res.setHeader("Deprecation", "true");
      if (deprecated[version].sunsetDate) {
        res.setHeader("Sunset", new Date(deprecated[version].sunsetDate).toUTCString());
      }
      if (deprecated[version].alternative) {
        res.setHeader("Link", `</api/${deprecated[version].alternative}>; rel="successor-version"`);
      }
    }

    next();
  };
}

module.exports = {
  VERSION_CONFIG,
  VERSION_ERROR_CODES,
  VERSION_ERROR_PLAN,
  ApiVersionError,
  normalizeVersion,
  extractVersion,
  apiVersionMiddleware
};
