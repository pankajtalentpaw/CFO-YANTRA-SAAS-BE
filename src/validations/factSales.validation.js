const { z } = require("zod");
const { dateYyyymmdd } = require("./common.validation");

/**
 * Fact Sales query validation schema.
 */
const factSalesQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  fromDate: dateYyyymmdd.optional(),
  toDate: dateYyyymmdd.optional(),
  includeRows: z.enum(["true", "false"]).optional()
});

module.exports = {
  factSalesQuerySchema
};
