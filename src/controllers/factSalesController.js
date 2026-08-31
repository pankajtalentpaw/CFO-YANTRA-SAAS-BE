const { runFactSalesIngestion } = require("../integrations/tally/sales/factSales.pipeline");
const { factSalesQuerySchema } = require("../validations");
const { HTTP_STATUS, APP_ERROR_CODES, sendError } = require("../constants/statusCodes");

/**
 * GET /api/factsales — run the read-only FACT_SALES ingestion pipeline.
 * Rows are omitted by default so a large dataset is never serialized by accident.
 */
async function getFactSales(req, res) {
  const parsedQuery = factSalesQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendError(
      res,
      HTTP_STATUS.BAD_REQUEST,
      "Invalid query parameters",
      APP_ERROR_CODES.INVALID_QUERY_PARAMS,
      parsedQuery.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }

  const { companyId, fromDate, toDate, includeRows } = parsedQuery.data;

  try {
    const result = await runFactSalesIngestion({
      companyId,
      range: { fromDate, toDate }
    });

    if (!result.success && result.error) {
      return res.status(HTTP_STATUS.BAD_GATEWAY).json({ success: false, ...result });
    }

    const summarized = result.results.map((companyResult) => ({
      ...companyResult,
      factSales: includeRows === "true" ? companyResult.factSales : undefined,
      factSalesRowCount: companyResult.factSales.length
    }));

    return res.json({ ...result, results: summarized });
  } catch (err) {
    return sendError(
      res,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      err.message,
      APP_ERROR_CODES.INTERNAL_SERVER_ERROR
    );
  }
}

module.exports = { getFactSales };
