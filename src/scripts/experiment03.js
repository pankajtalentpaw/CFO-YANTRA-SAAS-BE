const fs = require("fs");
const path = require("path");
const { probeTally } = require("../integrations/tally/tally.health");
const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const { buildTrialBalanceRequest } = require("../integrations/tally/tally.requests");
const { normalizeTrialBalanceRow, reconcileTrialBalance } = require("../integrations/tally/canonical/financialControls.canonical");
const { FAILURE_METADATA } = require("../constants/failureCodes");

async function runExperiment03() {
  const expDir = path.resolve(__dirname, "../../experiments/EXP-03-financial-controls");
  if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

  const runId = `exp03_${Date.now()}`;
  const startedAt = new Date().toISOString();

  console.log("\n==================================================");
  console.log("CFO Yantra — Experiment 03: Financial Controls (TB, P&L, BS)");
  console.log(`Run ID: ${runId}`);
  console.log("==================================================\n");

  const probe = await probeTally();
  if (!probe.reachable) {
    console.error("❌ TallyPrime is UNREACHABLE at port 9000.");
    const res = { experiment: "EXP-03", status: "BLOCKED", reason: "TALLY_UNREACHABLE" };
    fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(res, null, 2), "utf8");
    process.exit(1);
  }

  // Check EXP-02 dependency: if no company loaded -> BLOCKED
  if (!probe.companies || probe.companies.length === 0) {
    console.log("⚠️ No company loaded in TallyPrime. Marking EXP-03 as BLOCKED (Dependency EXP-02).");
    const res = {
      experiment: "EXP-03",
      status: "BLOCKED",
      reason: "NO_COMPANY_LOADED",
      dependency: "EXP-02",
      message: "Open a test company in TallyPrime to execute live financial reconciliation."
    };
    fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(res, null, 2), "utf8");
    process.exit(2);
  }

  const xml = buildTrialBalanceRequest();
  const xmlRes = await sendXmlRequest({ xml });
  const items = (xmlRes.parsedResponse && xmlRes.parsedResponse.collection) || [];
  const rows = items.map((i) => normalizeTrialBalanceRow(i)).filter(Boolean);
  const reconciliation = reconcileTrialBalance(rows);

  const result = {
    experiment: "EXP-03",
    status: reconciliation.status,
    runtimeExecuted: true,
    tallyReachable: true,
    companyLoaded: true,
    startedAt,
    completedAt: new Date().toISOString(),
    reconciliation
  };

  fs.writeFileSync(path.join(expDir, "reconciliation.json"), JSON.stringify(reconciliation, null, 2), "utf8");
  fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT: EXP-03 = ${result.status}\n`);
}

runExperiment03().catch(console.error);
