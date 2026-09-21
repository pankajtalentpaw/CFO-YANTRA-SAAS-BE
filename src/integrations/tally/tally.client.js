const http = require("http");
const axios = require("axios");
const env = require("../../config/env");
const { assertReadOnlyXml } = require("./tally.readonly");
const { buildProbeXml } = require("./tally.requests");
const breaker = require("./tally.breaker");
const { logger } = require("../../utils/logger");

// Dedicated single-socket Agent with keep-alive to keep TallyPrime from leaking
// descriptors or stacking orphaned connections in CloseWait/FinWait2.
const tallyHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 1,
  maxFreeSockets: 1,
  timeout: 60000
});

function getEffectiveConfig() {
  try {
    const tallyConfigService = require("../../services/tallyConfig.service");
    return tallyConfigService.getActiveConfig();
  } catch (_) {
    return {
      tallyHost: env.tally.host,
      tallyPort: env.tally.port,
      protocol: "http",
      timeoutMs: env.tally.timeoutMs,
      probeTimeoutMs: env.tally.probeTimeoutMs
    };
  }
}

function getTallyUrl(host, port, protocol) {
  const cfg = getEffectiveConfig();
  const effectiveHost = host || cfg.tallyHost || env.tally.host;
  const effectivePort = port || cfg.tallyPort || env.tally.port;
  const effectiveProto = protocol || cfg.protocol || "http";
  return `${effectiveProto}://${effectiveHost}:${effectivePort}`;
}

/**
 * Perform a lightweight HTTP heartbeat against Tally
 * @param {object} [options={}]
 * @returns {Promise<{ alive: boolean, statusCode?: number, responseTimeMs: number, error?: string }>}
 */
async function checkHeartbeat(options = {}) {
  const cfg = getEffectiveConfig();
  const host = options.host || cfg.tallyHost || env.tally.host;
  const port = options.port || cfg.tallyPort || env.tally.port;
  const protocol = options.protocol || cfg.protocol || "http";
  const url = getTallyUrl(host, port, protocol);
  const timeoutMs = options.timeoutMs || 3000;
  // `quick` skips the POST fallback. The caller already knows a POST just timed
  // out, so repeating one only doubles the wait it is trying to report.
  const quick = options.quick === true;
  const startedAt = Date.now();

  // Try GET first
  try {
    const response = await axios.get(url, {
      timeout: timeoutMs,
      httpAgent: tallyHttpAgent,
      validateStatus: () => true
    });
    if (response.status === 200 || response.status === 400 || response.status === 405) {
      // A live gateway is proof enough to let queued work through again.
      breaker.recordSuccess();
      return {
        alive: true,
        statusCode: response.status,
        responseTimeMs: Date.now() - startedAt
      };
    }
  } catch (err) {
    // If GET failed or timed out, attempt lightweight POST fallback with probe XML
    if (quick) {
      breaker.recordFailure(err);
      return {
        alive: false,
        responseTimeMs: Date.now() - startedAt,
        error: err.code || err.message
      };
    }
  }

  if (quick) {
    return { alive: false, responseTimeMs: Date.now() - startedAt, error: "NO_RESPONSE" };
  }

  try {
    // Must define the collection it asks for. A bare <ID>CompanyCollection</ID>
    // raises a TDL modal in Tally that blocks the gateway until someone clicks
    // OK — the heartbeat would then be the thing causing the outage it reports.
    const probeXml = buildProbeXml();
    const postRes = await axios.post(url, probeXml, {
      headers: { "Content-Type": "text/xml" },
      timeout: timeoutMs,
      httpAgent: tallyHttpAgent,
      validateStatus: () => true
    });

    if (postRes.status === 200) breaker.recordSuccess();
    return {
      alive: postRes.status === 200,
      statusCode: postRes.status,
      responseTimeMs: Date.now() - startedAt
    };
  } catch (postErr) {
    breaker.recordFailure(postErr);
    return {
      alive: false,
      responseTimeMs: Date.now() - startedAt,
      error: postErr.code || postErr.message
    };
  }
}

/**
 * Send an XML request with read-only validation (backward compatible helper)
 */
async function sendXml(xml, options = {}) {
  const cfg = getEffectiveConfig();
  const host = options.host || cfg.tallyHost || env.tally.host;
  const port = options.port || cfg.tallyPort || env.tally.port;
  const protocol = options.protocol || cfg.protocol || "http";
  const timeoutMs = options.timeoutMs || cfg.timeoutMs || env.tally.timeoutMs;
  const url = getTallyUrl(host, port, protocol);

  assertReadOnlyXml(xml);

  // A person who just pressed a button is willing to wait, so an explicit retry
  // is allowed past the cooldown. Everything automatic honours it.
  const force = options.force === true;

  // Refuse before queueing: a caller waiting behind the queue for a Tally that
  // is already known to be down would be waiting for nothing.
  if (!force) breaker.assertAvailable();

  // One request at a time. Tally is single-threaded; overlapping queries are
  // what wedge it, and a queued caller pays no timeout of its own.
  return breaker.runExclusive(async () => {
    if (!force) breaker.assertAvailable();
    const startedAt = Date.now();

    try {
      const response = await axios.post(url, xml, {
        headers: {
          "Content-Type": "text/xml"
        },
        timeout: timeoutMs,
        httpAgent: tallyHttpAgent,
        responseType: "text",
        validateStatus: () => true
      });

      const responseTimeMs = Date.now() - startedAt;
      breaker.recordSuccess();

      return {
        statusCode: response.status,
        body: response.data,
        responseTimeMs,
        url
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startedAt;
      logger.debug({ url, error: error.message, code: error.code, responseTimeMs }, "Tally HTTP transport error");
      error.responseTimeMs = responseTimeMs;
      error.url = url;
      breaker.recordFailure(error);
      throw error;
    }
  });
}

/**
 * Test Tally connectivity on host and port
 */
async function testConnection(options = {}) {
  const heartbeat = await checkHeartbeat(options);
  return {
    success: heartbeat.alive,
    statusCode: heartbeat.statusCode || null,
    responseTimeMs: heartbeat.responseTimeMs,
    error: heartbeat.error || null
  };
}

/**
 * Automatic fallback transport selector
 */
async function getBestAvailableTransport(options = {}) {
  const { detectCapabilities } = require("./tally.capabilities");
  const { sendXmlRequest } = require("./transports/xml.transport");
  const { sendJsonRequest } = require("./transports/json.transport");
  const { sendJsonExRequest } = require("./transports/jsonex.transport");

  const capabilities = await detectCapabilities(options);

  if (capabilities.selectedFormat === "JSONEx") {
    return { transport: "JSONEx", handler: sendJsonExRequest, capabilities };
  }
  if (capabilities.selectedFormat === "JSON") {
    return { transport: "JSON", handler: sendJsonRequest, capabilities };
  }
  if (capabilities.selectedFormat === "XML") {
    return { transport: "XML", handler: sendXmlRequest, capabilities };
  }

  throw new Error(`Tally is unreachable or no supported transport formats found on ${getTallyUrl(options.host, options.port)}`);
}

const { sendTallyJson } = require("./transports/tallyJson.client");

module.exports = {
  getTallyUrl,
  breaker,
  checkHeartbeat,
  sendXml,
  testConnection,
  getBestAvailableTransport,
  sendTallyJson
};

