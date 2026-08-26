const { z } = require("zod");
const { runFactSalesIngestion } = require("../integrations/tally/sales/factSales.pipeline");

/**
 * Query validation at the external boundary. Dates stay strings because Tally
 * expects its own yyyymmdd form, not a JS Date.
 */
const factSalesQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  fromDate: z.string().regex(/^\d{8}$/, "fromDate must be yyyymmdd").optional(),
  toDate: z.string().regex(/^\d{8}$/, "toDate must be yyyymmdd").optional(),
  includeRows: z.enum(["true", "false"]).optional()
});

/**
 * GET /api/factsales — run the read-only FACT_SALES ingestion pipeline.
 * Rows are omitted by default so a large dataset is never serialized by accident.
 */
async function getFactSales(req, res) {
  const parsedQuery = factSalesQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid query parameters",
      issues: parsedQuery.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    });
  }

  const { companyId, fromDate, toDate, includeRows } = parsedQuery.data;

  try {
    const result = await runFactSalesIngestion({
      companyId,
      range: { fromDate, toDate }
    });

    if (!result.success && result.error) {
      return res.status(502).json({ success: false, ...result });
    }

    const summarized = result.results.map((companyResult) => ({
      ...companyResult,
      factSales: includeRows === "true" ? companyResult.factSales : undefined,
      factSalesRowCount: companyResult.factSales.length
    }));

    return res.json({ ...result, results: summarized });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { getFactSales };
