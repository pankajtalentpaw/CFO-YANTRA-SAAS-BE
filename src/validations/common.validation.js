const { z } = require("zod");

/**
 * Reusable primitive and common schemas across the application.
 */

// YYYYMMDD date format expected by Tally queries (handles empty string as optional)
const dateYyyymmdd = z.preprocess(
  (val) => (val === "" || val === null ? undefined : val),
  z.string().regex(/^\d{8}$/, "Date must be in YYYYMMDD format (e.g. 20240401)").optional()
);

// Standard pagination and search query parameters
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  search: z.preprocess((val) => (val === "" || val === null ? undefined : val), z.string().max(200).optional())
});

// Generic string or array of strings filter (e.g. ?customer=Acme or ?customer=A&customer=B)
const filterStringOrArray = z.preprocess((val) => {
  if (val === "" || val === null || val === undefined) return undefined;
  return val;
}, z.union([z.string().max(2000), z.array(z.string().max(500))]).optional());

// Standard company ID route param
const companyParamsSchema = z.object({
  companyId: z.string().min(1, "companyId is required")
});

module.exports = {
  dateYyyymmdd,
  paginationQuerySchema,
  filterStringOrArray,
  companyParamsSchema
};
