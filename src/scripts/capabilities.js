const { detectCapabilities } = require("../integrations/tally/tally.capabilities");

async function main() {
  console.log("CFO Yantra - Tally Capabilities");
  console.log("--------------------------------");

  const caps = await detectCapabilities();

  console.log(`Tally Reachable: ${caps.tallyReachable ? "YES" : "NO"}`);
  console.log(`Tally Version: ${caps.tallyVersion || "N/A"}`);
  console.log(`Port: ${caps.port}`);
  console.log("");
  console.log(`XML: ${caps.formats.xml ? "SUPPORTED" : "NOT SUPPORTED"}`);
  console.log(`JSON: ${caps.formats.json ? "SUPPORTED" : "NOT SUPPORTED"}`);
  console.log(`JSONEx: ${caps.formats.jsonEx ? "SUPPORTED" : "NOT SUPPORTED"}`);
  console.log("");
  console.log(`Selected Transport: ${caps.selectedFormat}`);

  if (caps.fallbackReason) {
    console.log(`\nNote: ${caps.fallbackReason}`);
  }

  process.exit(caps.tallyReachable ? 0 : 1);
}

main();
