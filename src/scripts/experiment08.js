const fs = require("fs");
const path = require("path");
const { probeTally } = require("../integrations/tally/tally.health");
const { runMutationChaosTest } = require("../integrations/tally/canonical/syncEngine.canonical");

async function runExperiment08() {
  const expDir = path.resolve(__dirname, "../../experiments/EXP-08-incremental-sync");
  if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

  console.log("\n==================================================");
  console.log("CFO Yantra — Experiment 08: Incremental Sync & Change Capture");
  console.log("==================================================\n");

  const probe = await probeTally();
  if (!probe.reachable || !probe.companies || probe.companies.length === 0) {
    const res = { experiment: "EXP-08", status: "BLOCKED", reason: !probe.reachable ? "TALLY_UNREACHABLE" : "NO_COMPANY_LOADED", dependency: "EXP-04" };
    fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(res, null, 2), "utf8");
    console.log(`RESULT: EXP-08 = BLOCKED (${res.reason})`);
    process.exit(2);
  }

  const chaosTest = runMutationChaosTest();
  const result = {
    experiment: "EXP-08",
    status: chaosTest.status === "PASS" ? "PASSED" : "FAILED",
    syncProtocol: "ALTERID_INCREMENTAL_CHECKPOINT_V1",
    chaosTest,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT: EXP-08 = ${result.status}\n`);
}

runExperiment08().catch(console.error);
