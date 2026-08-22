const { probeTally } = require("../integrations/tally/tally.health");
const { formatCompanyList } = require("../integrations/tally/tally.parser");

/**
 * Experiment 1 probe: transport handshake + company discovery only.
 * No ledger, voucher or inventory extraction happens here.
 */
async function main() {
  console.log("CFO Yantra - Tally Transport Probe");
  console.log("-----------------------------------");

  const result = await probeTally();

  console.log(`Tally Status: ${result.success ? "CONNECTED" : "DISCONNECTED"}`);
  console.log(`HTTP Status: ${result.statusCode === null || result.statusCode === undefined ? "n/a" : result.statusCode}`);
  console.log(`Response Time: ${result.responseTimeMs}ms`);
  console.log(`Response Size: ${result.responseSize === undefined ? "n/a" : `${result.responseSize} bytes`}`);
  console.log("");

  if (result.success) {
    console.log(formatCompanyList(result.companies));
  } else {
    console.log(`Failure Code: ${result.failureCode || "UNKNOWN"}`);
    if (result.diagnosticHint) console.log(`Hint: ${result.diagnosticHint}`);
    if (result.userAction) console.log(`Action: ${result.userAction}`);
  }

  console.log("");
  console.log("--- raw probe result ---");
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.success ? 0 : 1);
}

main();
