const { sendXml, checkHeartbeat } = require("./tally.client");
const { buildProbeXml } = require("./tally.requests");
const { parseTallyResponse, parseCompanies } = require("./tally.parser");
const { classifyError, buildDiagnosticReport, isCollectionDescriptionError } = require("../../services/diagnostics.service");
const breaker = require("./tally.breaker");
const { FAILURE_CODES } = require("../../constants");
const env = require("../../config/env");

/**
 * Perform a comprehensive health probe against TallyPrime
 * @param {object} [options={}]
 * @returns {Promise<object>} Structured health report
 */
async function probeTally(options = {}) {
  const startedAt = Date.now();
  const companyName = options.companyName || env.tally.companyName;
  // A health check is not a data extraction. Capping it at the probe budget is
  // what keeps the status endpoint from out-waiting the caller that asked.
  const probeOptions = { timeoutMs: env.tally.probeTimeoutMs, ...options };

  try {
    const probeXml = buildProbeXml(companyName);
    const transportResult = await sendXml(probeXml, probeOptions);
    const rawXml = transportResult.body;
    const responseSize = Buffer.byteLength(rawXml || "", "utf8");

    // Parse and validate the response
    const parseResult = parseTallyResponse(rawXml);

    if (!parseResult.success) {
      const diagnostic = classifyError(
        new Error(parseResult.error || parseResult.lineError || "Tally XML validation failed"),
        {
          isInvalidCollection: isCollectionDescriptionError(parseResult.lineError || rawXml),
          hasLineError: parseResult.hasLineError,
          isMalformedXml: parseResult.isMalformedXml,
          isInvalidEnvelope: parseResult.isInvalidEnvelope,
          isEmptyResponse: parseResult.isEmpty
        }
      );

      return {
        success: false,
        statusCode: transportResult.statusCode,
        responseTimeMs: transportResult.responseTimeMs,
        responseSize,
        failureCode: diagnostic.failureCode,
        diagnosticHint: diagnostic.diagnosticHint,
        userAction: diagnostic.userAction,
        error: parseResult.error || parseResult.lineError,
        response: rawXml
      };
    }

    // Strongly typed company records — never raw XML nodes, so no caller can
    // stringify an object into "[object Object]".
    const companies = parseCompanies(parseResult);
    const companyNames = companies.map((c) => c.name);
    const companyAvailable = companies.length > 0 || !!companyName;

    return {
      success: transportResult.statusCode >= 200 && transportResult.statusCode < 300,
      status: "healthy",
      statusCode: transportResult.statusCode,
      responseTimeMs: transportResult.responseTimeMs,
      responseSize,
      companyAvailable,
      companyCount: companies.length,
      companies,
      companyNames,
      // Backward compatibility for callers that still expect a single company.
      company: companies.length > 0 ? companies[0] : null,
      headerStatus: parseResult.headerStatus,
      failureCode: null,
      tallyAvailability: breaker.snapshot(),
      response: rawXml
    };
  } catch (error) {
    const responseTimeMs = error.responseTimeMs || (Date.now() - startedAt);
    // Quick GET only: the POST that just failed is evidence enough, and a full
    // heartbeat here used to add six seconds to an already failing request.
    const heartbeat = await checkHeartbeat({ ...probeOptions, timeoutMs: 2000, quick: true });

    const isNonDefaultPort = (options.port && options.port !== 9000) || (env.tally.port !== 9000);
    const diagnostic = classifyError(error, {
      isNonDefaultPort,
      isReadOnlyViolation: error.isReadOnlyViolation
    });

    // If HTTP GET succeeded but POST failed/timed out
    if (heartbeat.alive && diagnostic.failureCode === FAILURE_CODES.CONNECTION_TIMEOUT) {
      diagnostic.diagnosticHint =
        "Tally server responded to GET on port, but XML POST requests timed out. Ensure target company is open and all modal dialogs are closed.";
    }

    let cachedCompanies = [];
    try {
      const { listCompanies } = require("../../services/companyScope.service");
      const fallback = await listCompanies({ allowStale: true });
      if (fallback && fallback.companies) cachedCompanies = fallback.companies;
    } catch (_) {}

    return {
      success: false,
      statusCode: null,
      failureCode: diagnostic.failureCode,
      errorMessage: diagnostic.errorMessage,
      diagnosticHint: diagnostic.diagnosticHint,
      userAction: diagnostic.userAction,
      retryable: diagnostic.retryable,
      responseTimeMs,
      serverStatus: heartbeat.alive ? "RUNNING_BUT_BLOCKED" : "UNREACHABLE",
      companyAvailable: cachedCompanies.length > 0,
      companyCount: cachedCompanies.length,
      companies: cachedCompanies,
      companyNames: cachedCompanies.map((c) => c.name),
      company: cachedCompanies[0] || null,
      tallyAvailability: breaker.snapshot()
    };
  }
}

module.exports = {
  probeTally
};
