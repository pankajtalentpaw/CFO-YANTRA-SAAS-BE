/**
 * Express middleware generator for Zod schemas.
 *
 * Usage:
 *   router.get("/sales", validateQuery(salesAnalysisQuerySchema), controller.getSalesAnalysis);
 *   router.post("/chat", validateBody(chatRequestSchema), controller.chat);
 */

function formatZodIssues(issues = []) {
  return issues.map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : i.path,
    message: i.message
  }));
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid query parameters",
        issues: formatZodIssues(result.error.issues)
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request payload",
        issues: formatZodIssues(result.error.issues)
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid route parameters",
        issues: formatZodIssues(result.error.issues)
      });
    }
    req.validatedParams = result.data;
    next();
  };
}

module.exports = {
  validateQuery,
  validateBody,
  validateParams,
  formatZodIssues
};
