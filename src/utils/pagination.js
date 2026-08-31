/**
 * CFO Yantra - Universal Pagination Engine & Error Planning
 *
 * Provides:
 *   1. Robust in-memory array pagination with nested field search & sorting
 *   2. Mongoose / MongoDB query pagination helper
 *   3. Strict validation & sanitization of pagination parameters
 *   4. Dedicated Pagination Error Planning & Diagnostics Matrix
 *   5. Comprehensive metadata calculations (totalPages, hasMore, hasPrev, offset)
 */

"use strict";

const { HTTP_STATUS, APP_ERROR_CODES, ApiError } = require("../constants/statusCodes");

/**
 * Pagination System Defaults & Boundaries
 */
const PAGINATION_DEFAULTS = Object.freeze({
  PAGE: 1,
  LIMIT: 50,
  MIN_PAGE: 1,
  MIN_LIMIT: 1,
  MAX_LIMIT: 500,
  DEFAULT_SEARCH_FIELDS: ["name"]
});

/**
 * Pagination Error Codes
 */
const PAGINATION_ERROR_CODES = Object.freeze({
  INVALID_PAGE: "PAGINATION_INVALID_PAGE",
  INVALID_LIMIT: "PAGINATION_INVALID_LIMIT",
  PAGE_OUT_OF_BOUNDS: "PAGINATION_PAGE_OUT_OF_BOUNDS",
  INVALID_DATA_SOURCE: "PAGINATION_INVALID_DATA_SOURCE",
  INVALID_SORT_FIELD: "PAGINATION_INVALID_SORT_FIELD"
});

/**
 * Pagination Error Planning & Recovery Matrix
 */
const PAGINATION_ERROR_PLAN = Object.freeze({
  [PAGINATION_ERROR_CODES.INVALID_PAGE]: {
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    severity: "LOW",
    retryable: false,
    diagnosticHint: "Query parameter 'page' must be a positive integer greater than or equal to 1.",
    actionPlan: "Ensure callers pass an integer >= 1. Use parsePaginationParams() for safe fallback.",
    userAction: "Page number must be 1 or greater. Please provide a valid page number."
  },
  [PAGINATION_ERROR_CODES.INVALID_LIMIT]: {
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    severity: "LOW",
    retryable: false,
    diagnosticHint: `Query parameter 'limit' must be between ${PAGINATION_DEFAULTS.MIN_LIMIT} and ${PAGINATION_DEFAULTS.MAX_LIMIT}.`,
    actionPlan: `Clamp limit values between ${PAGINATION_DEFAULTS.MIN_LIMIT} and ${PAGINATION_DEFAULTS.MAX_LIMIT} or return HTTP 400.`,
    userAction: `Page limit must be between ${PAGINATION_DEFAULTS.MIN_LIMIT} and ${PAGINATION_DEFAULTS.MAX_LIMIT} items per page.`
  },
  [PAGINATION_ERROR_CODES.PAGE_OUT_OF_BOUNDS]: {
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    severity: "LOW",
    retryable: true,
    diagnosticHint: "Requested page exceeds the maximum available pages for this dataset.",
    actionPlan: "Return empty items array with current pagination metadata or navigate user back to page 1.",
    userAction: "The requested page does not exist for this search. Navigate back to page 1."
  },
  [PAGINATION_ERROR_CODES.INVALID_DATA_SOURCE]: {
    httpStatus: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    severity: "MEDIUM",
    retryable: false,
    diagnosticHint: "paginate() expects the first argument to be an Array.",
    actionPlan: "Ensure data extractors return an array before invoking paginate(). Fallback to empty array [].",
    userAction: "A server data formatting error occurred. Please refresh or contact support."
  },
  [PAGINATION_ERROR_CODES.INVALID_SORT_FIELD]: {
    httpStatus: HTTP_STATUS.BAD_REQUEST,
    severity: "LOW",
    retryable: false,
    diagnosticHint: "Requested sortBy field does not exist on the target entity.",
    actionPlan: "Restrict sortBy to an allowed list of field names for the entity.",
    userAction: "Please choose a valid field to sort by."
  }
});

/**
 * Custom Pagination Exception Class
 */
class PaginationError extends ApiError {
  constructor(errorCode, customMessage = null, details = null) {
    const plan = PAGINATION_ERROR_PLAN[errorCode] || {
      httpStatus: HTTP_STATUS.BAD_REQUEST,
      userAction: "Invalid pagination request."
    };
    super(
      plan.httpStatus,
      customMessage || plan.userAction,
      errorCode,
      details
    );
    this.name = "PaginationError";
    this.diagnosticHint = plan.diagnosticHint;
    this.actionPlan = plan.actionPlan;
    this.userAction = plan.userAction;
  }
}

/**
 * Safely parse, sanitize, and clamp pagination query parameters.
 *
 * @param {object} query - Request query object (e.g. req.query)
 * @param {object} [options]
 * @param {number} [options.defaultLimit=50] - Default items per page
 * @param {number} [options.maxLimit=500] - Maximum allowable items per page
 * @returns {{ page: number, limit: number, search: string, offset: number, sortBy: string|null, sortOrder: 'asc'|'desc' }}
 */
function parsePaginationParams(query = {}, options = {}) {
  const defaultLimit = options.defaultLimit || PAGINATION_DEFAULTS.LIMIT;
  const maxLimit = options.maxLimit || PAGINATION_DEFAULTS.MAX_LIMIT;

  const rawPage = Number(query.page);
  const rawLimit = Number(query.limit);

  const page = (!isNaN(rawPage) && rawPage >= 1) ? Math.floor(rawPage) : PAGINATION_DEFAULTS.PAGE;
  const limit = (!isNaN(rawLimit) && rawLimit >= 1)
    ? Math.min(maxLimit, Math.floor(rawLimit))
    : defaultLimit;

  const search = typeof query.search === "string" ? query.search.trim().toLowerCase() : "";
  const offset = (page - 1) * limit;

  const sortBy = typeof query.sortBy === "string" ? query.sortBy.trim() : null;
  const sortOrder = query.sortOrder && String(query.sortOrder).toLowerCase() === "desc" ? "desc" : "asc";

  return {
    page,
    limit,
    search,
    offset,
    sortBy,
    sortOrder
  };
}

/**
 * Validate pagination parameters strictly (returning errors instead of silent clamping).
 *
 * @param {object} query
 * @param {object} [options]
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string, code: string }>, value: object }}
 */
function validatePaginationParams(query = {}, options = {}) {
  const errors = [];
  const maxLimit = options.maxLimit || PAGINATION_DEFAULTS.MAX_LIMIT;

  if (query.page !== undefined) {
    const p = Number(query.page);
    if (isNaN(p) || p < 1 || !Number.isInteger(p)) {
      errors.push({
        field: "page",
        message: PAGINATION_ERROR_PLAN[PAGINATION_ERROR_CODES.INVALID_PAGE].userAction,
        code: PAGINATION_ERROR_CODES.INVALID_PAGE
      });
    }
  }

  if (query.limit !== undefined) {
    const l = Number(query.limit);
    if (isNaN(l) || l < 1 || l > maxLimit || !Number.isInteger(l)) {
      errors.push({
        field: "limit",
        message: PAGINATION_ERROR_PLAN[PAGINATION_ERROR_CODES.INVALID_LIMIT].userAction,
        code: PAGINATION_ERROR_CODES.INVALID_LIMIT
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: parsePaginationParams(query, options)
  };
}

/**
 * Calculate complete pagination metadata.
 *
 * @param {number} totalRecords - Total count of records
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @returns {{ page: number, limit: number, total: number, totalPages: number, hasMore: boolean, hasPrev: boolean, nextPage: number|null, prevPage: number|null, offset: number }}
 */
function calculatePaginationMeta(totalRecords, page, limit) {
  const total = Math.max(0, Number(totalRecords) || 0);
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.ceil(total / safeLimit) || 0;
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * safeLimit;

  const hasMore = offset + safeLimit < total;
  const hasPrev = safePage > 1 && total > 0;

  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
    hasMore,
    hasPrev,
    nextPage: hasMore ? safePage + 1 : null,
    prevPage: hasPrev ? safePage - 1 : null,
    offset
  };
}

/**
 * Safely resolves nested property values by dot-notation (e.g. "address.stateName").
 */
function getNestedValue(obj, path) {
  if (!obj || typeof obj !== "object") return undefined;
  return path.split(".").reduce((acc, part) => (acc ? acc[part] : undefined), obj);
}

/**
 * Universal In-Memory Array Pagination Engine
 *
 * Fully backward-compatible with: paginate(records, query, searchFields)
 *
 * @param {Array} records - Full list of records
 * @param {object} [query={}] - Query parameters { page, limit, search, sortBy, sortOrder }
 * @param {string[]} [searchFields=["name"]] - Fields to match against the search term
 * @param {object} [options={}] - Additional options (e.g. strictMode, maxLimit)
 * @returns {{ items: Array, pagination: object }}
 */
function paginate(records = [], query = {}, searchFields = PAGINATION_DEFAULTS.DEFAULT_SEARCH_FIELDS, options = {}) {
  if (!Array.isArray(records)) {
    if (options.strictMode) {
      throw new PaginationError(PAGINATION_ERROR_CODES.INVALID_DATA_SOURCE);
    }
    records = [];
  }

  const { page, limit, search, offset, sortBy, sortOrder } = parsePaginationParams(query, options);

  // 1. Search Filtering
  let filtered = records;
  if (search && Array.isArray(searchFields) && searchFields.length > 0) {
    filtered = records.filter((record) =>
      searchFields.some((field) => {
        const val = getNestedValue(record, field);
        return val !== undefined && val !== null && String(val).toLowerCase().includes(search);
      })
    );
  }

  // 2. Sorting (Optional)
  if (sortBy) {
    filtered = [...filtered].sort((a, b) => {
      const valA = getNestedValue(a, sortBy);
      const valB = getNestedValue(b, sortBy);

      if (valA === valB) return 0;
      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      const comp = typeof valA === "string"
        ? String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: "base" })
        : (valA > valB ? 1 : -1);

      return sortOrder === "desc" ? -comp : comp;
    });
  }

  // 3. Metadata Calculation
  const total = filtered.length;
  const pagination = calculatePaginationMeta(total, page, limit);

  // 4. Page Slicing
  const items = filtered.slice(offset, offset + limit);

  return {
    items,
    pagination
  };
}

/**
 * Mongoose Query Pagination Helper
 *
 * @param {import('mongoose').Model} model - Mongoose Model
 * @param {object} [filter={}] - Mongo query filter
 * @param {object} [queryParams={}] - { page, limit, sortBy, sortOrder }
 * @param {object} [options={}] - { select, populate, lean }
 * @returns {Promise<{ items: Array, pagination: object }>}
 */
async function paginateMongoose(model, filter = {}, queryParams = {}, options = {}) {
  const { page, limit, offset, sortBy, sortOrder } = parsePaginationParams(queryParams, options);

  let query = model.find(filter);

  if (options.select) query = query.select(options.select);
  if (options.populate) query = query.populate(options.populate);

  if (sortBy) {
    query = query.sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 });
  }

  if (options.lean !== false) {
    query = query.lean();
  }

  const [items, total] = await Promise.all([
    query.skip(offset).limit(limit).exec(),
    model.countDocuments(filter).exec()
  ]);

  const pagination = calculatePaginationMeta(total, page, limit);

  return {
    items,
    pagination
  };
}

module.exports = {
  PAGINATION_DEFAULTS,
  PAGINATION_ERROR_CODES,
  PAGINATION_ERROR_PLAN,
  PaginationError,
  parsePaginationParams,
  validatePaginationParams,
  calculatePaginationMeta,
  paginate,
  paginateMongoose
};
