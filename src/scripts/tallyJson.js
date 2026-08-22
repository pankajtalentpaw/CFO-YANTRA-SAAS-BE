const { buildCompanyProbeRequest } = require("../integrations/tally/tally.requests");
const { sendJsonRequest } = require("../integrations/tally/transports/json.transport");

async function main() {
  console.log("CFO Yantra - Tally JSON Transport Probe");
  console.log("----------------------------------------");

  const jsonQueryXml = buildCompanyProbeRequest("JSON");

  const result = await sendJsonRequest({ request: jsonQueryXml });
  console.log(JSON.stringify(result, null, 2));

  // Exit with 0 so the user gets clean diagnostic info even if JSON is unsupported on this Tally build
  process.exit(0);
}

main();
