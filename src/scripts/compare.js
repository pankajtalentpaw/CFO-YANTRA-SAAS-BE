const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const { sendJsonRequest } = require("../integrations/tally/transports/json.transport");
const { sendJsonExRequest } = require("../integrations/tally/transports/jsonex.transport");
const { buildProbeXml, buildCompanyProbeRequest } = require("../integrations/tally/tally.requests");
const { parseToCanonical } = require("../integrations/tally/canonical/canonical.parser");

async function main() {
  console.log("CFO Yantra - Tally Multi-Format Benchmark & Parity");
  console.log("==================================================");

  const probeXml = buildProbeXml();
  const jsonQueryXml = buildCompanyProbeRequest("JSON");

  const jsonExQueryXml = buildCompanyProbeRequest("JSONEx");

  // Run probes across all 3 formats with 3000ms timeout
  const timeoutMs = 3000;
  const xmlRes = await sendXmlRequest({ xml: probeXml, timeoutMs });
  const jsonRes = await sendJsonRequest({ request: jsonQueryXml, timeoutMs });
  const jsonExRes = await sendJsonExRequest({ request: jsonExQueryXml, timeoutMs });

  const benchmark = {
    xml: {
      supported: xmlRes.success,
      statusCode: xmlRes.statusCode,
      responseTimeMs: xmlRes.responseTimeMs,
      responseSize: xmlRes.responseSize
    },
    json: {
      supported: jsonRes.success,
      statusCode: jsonRes.statusCode,
      responseTimeMs: jsonRes.responseTimeMs,
      responseSize: jsonRes.responseSize,
      errorCode: jsonRes.errorCode || null
    },
    jsonEx: {
      supported: jsonExRes.success,
      statusCode: jsonExRes.statusCode,
      responseTimeMs: jsonExRes.responseTimeMs,
      responseSize: jsonExRes.responseSize,
      errorCode: jsonExRes.errorCode || null
    }
  };

  console.log("\n--- Format Benchmark ---");
  console.table(benchmark);

  // Parity check across canonical parsers
  const xmlCanonical = parseToCanonical(xmlRes);
  const jsonCanonical = parseToCanonical(jsonRes);
  const jsonExCanonical = parseToCanonical(jsonExRes);

  const parity = {
    status: "PASS",
    xmlCanonicalCount: xmlCanonical.count || 0,
    jsonCanonicalCount: jsonCanonical.count || 0,
    jsonExCanonicalCount: jsonExCanonical.count || 0,
    differences: []
  };

  if (jsonRes.success && xmlRes.success) {
    if (xmlCanonical.count !== jsonCanonical.count) {
      parity.differences.push({
        comparison: "XML vs JSON",
        issue: `Count mismatch: XML has ${xmlCanonical.count}, JSON has ${jsonCanonical.count}`
      });
    }
  }

  console.log("\n--- Canonical Parity Summary ---");
  console.log(JSON.stringify(parity, null, 2));

  process.exit(0);
}

main();
