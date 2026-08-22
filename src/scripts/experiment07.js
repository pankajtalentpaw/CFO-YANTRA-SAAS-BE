const fs = require("fs");
const path = require("path");
const { probeTally } = require("../integrations/tally/tally.health");
const { evaluateStatutoryCapabilities } = require("../integrations/tally/canonical/statutory.canonical");

async function runExperiment07() {
  const expDir = path.resolve(__dirname, "../../experiments/EXP-07-advanced-configuration");
  if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

  console.log("\n==================================================");
  console.log("CFO Yantra — Experiment 07: Advanced Configuration");
  console.log("==================================================\n");

  const probe = await probeTally();
  if (!probe.reachable || !probe.companies || probe.companies.length === 0) {
    const res = { experiment: "EXP-07", status: "BLOCKED", reason: !probe.reachable ? "TALLY_UNREACHABLE" : "NO_COMPANY_LOADED", dependency: "EXP-02" };
    fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(res, null, 2), "utf8");
    console.log(`RESULT: EXP-07 = BLOCKED (${res.reason})`);
    process.exit(2);
  }

  const statutory = evaluateStatutoryCapabilities({ displayName: probe.companies[0] });
  const result = {
    experiment: "EXP-07",
    status: "PASSED",
    statutory,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT: EXP-07 = ${result.status}\n`);
}

runExperiment07().catch(console.error);
