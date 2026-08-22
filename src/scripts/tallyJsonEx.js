const { buildCompanyProbeRequest } = require("../integrations/tally/tally.requests");
const { sendJsonExRequest } = require("../integrations/tally/transports/jsonex.transport");

async function main() {
  console.log("CFO Yantra - Tally JSONEx Transport Probe");
  console.log("------------------------------------------");

  const jsonExQueryXml = buildCompanyProbeRequest("JSONEx");

  const result = await sendJsonExRequest({ request: jsonExQueryXml });
  console.log(JSON.stringify(result, null, 2));

  process.exit(0);
}

main();
