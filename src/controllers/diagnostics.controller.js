const { checkHeartbeat } = require("../integrations/tally/tally.client");
const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const { sendJsonRequest } = require("../integrations/tally/transports/json.transport");
const { sendJsonExRequest } = require("../integrations/tally/transports/jsonex.transport");
const { buildProbeXml, buildCompanyProbeRequest } = require("../integrations/tally/tally.requests");
const { validateReadOnlyXml } = require("../integrations/tally/tally.readonly");

const inMemoryLogs = [
  {
    id: "log_init",
    timestamp: new Date().toLocaleTimeString(),
    type: "INFO",
    message: "CFO Yantra Backend REST API initialized",
    code: "BACKEND_INIT"
  }
];

function logBackendEvent(type, message, code = null) {
  const item = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toLocaleTimeString(),
    type,
    message,
    code
  };
  inMemoryLogs.unshift(item);
  if (inMemoryLogs.length > 100) inMemoryLogs.pop();
  return item;
}

async function getDiagnostics(req, res) {
  const probeXml = buildProbeXml();
  const timeoutMs = 3000;

  try {
    const hb = await checkHeartbeat({ timeoutMs });
    const xmlRes = await sendXmlRequest({ xml: probeXml, timeoutMs });
    
    const jsonQuery = buildCompanyProbeRequest("JSON");
    const jsonRes = await sendJsonRequest({ request: jsonQuery, timeoutMs });

    const jsonExQuery = buildCompanyProbeRequest("JSONEx");
    const jsonExRes = await sendJsonExRequest({ request: jsonExQuery, timeoutMs });

    const testSafe = validateReadOnlyXml(probeXml);
    const testUnsafe = validateReadOnlyXml("<ENVELOPE><HEADER><TALLYREQUEST>Import</TALLYREQUEST></HEADER><BODY><IMPORTDATA></IMPORTDATA></BODY></ENVELOPE>");
    const readOnlyPass = testSafe.allowed && !testUnsafe.allowed;

    logBackendEvent(hb.alive ? "SUCCESS" : "ERROR", `Heartbeat: ${hb.alive ? "PASS" : "FAIL"}`);

    return res.json({
      timestamp: new Date().toISOString(),
      reachability: hb.alive ? "PASS" : "FAIL",
      xmlTransport: xmlRes.success ? "PASS" : "FAIL",
      jsonTransport: jsonRes.success ? "PASS" : "UNSUPPORTED",
      jsonExTransport: jsonExRes.success ? "PASS" : "UNSUPPORTED",
      readOnlySecurity: readOnlyPass ? "PASS" : "FAIL",
      timing: {
        heartbeatMs: hb.responseTimeMs,
        xmlMs: xmlRes.responseTimeMs,
        jsonMs: jsonRes.responseTimeMs,
        jsonExMs: jsonExRes.responseTimeMs
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getLogs(req, res) {
  return res.json(inMemoryLogs);
}

module.exports = {
  getDiagnostics,
  getLogs,
  logBackendEvent
};
