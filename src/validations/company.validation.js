const { z } = require("zod");
const { paginationQuerySchema, filterStringOrArray, dateYyyymmdd } = require("./common.validation");

/**
 * Company query validation schemas.
 */

// Basic list query with pagination and search
const listQuerySchema = paginationQuerySchema;

// Voucher register query schema
const voucherQuerySchema = listQuerySchema.extend({
  type: filterStringOrArray,
  fromDate: dateYyyymmdd.optional(),
  toDate: dateYyyymmdd.optional()
});

// Sales analysis query schema with dimension filters
const salesAnalysisQuerySchema = voucherQuerySchema.extend({
  customer: filterStringOrArray,
  product: filterStringOrArray,
  country: filterStringOrArray,
  state: filterStringOrArray,
  city: filterStringOrArray
});

// Purchase analysis query schema with dimension filters
const purchaseAnalysisQuerySchema = voucherQuerySchema.extend({
  supplier: filterStringOrArray,
  product: filterStringOrArray,
  country: filterStringOrArray,
  state: filterStringOrArray,
  city: filterStringOrArray
});

// Dashboard overview query schema
const dashboardQuerySchema = z.object({
  fromDate: dateYyyymmdd.optional(),
  toDate: dateYyyymmdd.optional()
});

// Which revenue measure a report is computed in. Absent means product value
// alone — what every caller got before the choice existed.
const turnoverMeasure = z.enum(["withCharges", "withoutCharges"]).optional();

// MIS Report 5 query schema
const report5QuerySchema = z.object({
  fromDate: dateYyyymmdd.optional(),
  toDate: dateYyyymmdd.optional(),
  measure: turnoverMeasure,
  filterId: z.coerce.number().int().min(0).max(17).optional(),
  subCatA: z.string().max(200).optional(),
  subCatB: z.string().max(200).optional(),
  monthA: z.string().max(50).optional(),
  monthB: z.string().max(50).optional()
});

// Decision Intelligence Layer (160 Analyses) query schema
const report5AnalyticsQuerySchema = z.object({
  fromDate: dateYyyymmdd.optional(),
  toDate: dateYyyymmdd.optional(),
  measure: turnoverMeasure,
  lensId: z.coerce.number().int().min(1).max(16).optional(),
  analysisId: z.string().regex(/^L\d{2}\.A\d{2}$/).optional()
});

// Decision Intelligence Dashboards query schema
const report5DashboardsQuerySchema = z.object({
  fromDate: dateYyyymmdd.optional(),
  toDate: dateYyyymmdd.optional(),
  measure: turnoverMeasure
});

module.exports = {
  listQuerySchema,
  voucherQuerySchema,
  salesAnalysisQuerySchema,
  purchaseAnalysisQuerySchema,
  dashboardQuerySchema,
  report5QuerySchema,
  report5AnalyticsQuerySchema,
  report5DashboardsQuerySchema,
  filterStringOrArray
};
