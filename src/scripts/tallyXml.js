const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const { buildProbeXml } = require("../integrations/tally/tally.requests");

async function main() {
  console.log("CFO Yantra - Tally XML Transport Probe");
  console.log("---------------------------------------");

  const xml = buildProbeXml();
  const result = await sendXmlRequest({ xml });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main();
