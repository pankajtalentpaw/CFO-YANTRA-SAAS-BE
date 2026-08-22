const fs = require("fs");
const path = require("path");
const { probeTally } = require("../integrations/tally/tally.health");
const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const { buildBillWiseOutstandingRequest } = require("../integrations/tally/tally.requests");
const { normalizeCanonicalBill, reconcileAgeingBuckets } = require("../integrations/tally/canonical/ageing.canonical");

async function runExperiment05() {
  const expDir = path.resolve(__dirname, "../../experiments/EXP-05-working-capital");
  if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

  const runId = `exp05_${Date.now()}`;
  const startedAt = new Date().toISOString();

  console.log("\n==================================================");
  console.log("CFO Yantra — Experiment 05: Receivables, Payables & Ageing");
  console.log(`Run ID: ${runId}`);
  console.log("==================================================\n");

  const probe = await probeTally();
  if (!probe.reachable || !probe.companies || probe.companies.length === 0) {
    const res = {
      experiment: "EXP-05",
      status: "BLOCKED",
      reason: !probe.reachable ? "TALLY_UNREACHABLE" : "NO_COMPANY_LOADED",
      dependency: "EXP-04"
    };
    fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(res, null, 2), "utf8");
    console.log(`RESULT: EXP-05 = BLOCKED (${res.reason})`);
    process.exit(2);
  }

  const xml = buildBillWiseOutstandingRequest();
  const xmlRes = await sendXmlRequest({ xml });
  const items = (xmlRes.parsedResponse && xmlRes.parsedResponse.collection) || [];
  const bills = items.map((i) => normalizeCanonicalBill(i)).filter(Boolean);
  const reconciliation = reconcileAgeingBuckets(bills);

  const result = {
    experiment: "EXP-05",
    status: reconciliation.status,
    runtimeExecuted: true,
    reconciliation,
    startedAt,
    completedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT: EXP-05 = ${result.status}\n`);
}

runExperiment05().catch(console.error);
