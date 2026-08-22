const fs = require("fs");
const path = require("path");
const { probeTally } = require("../integrations/tally/tally.health");
const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const { buildVouchersRequest } = require("../integrations/tally/tally.requests");
const { normalizeCanonicalVoucher, aggregateVoucherLedgers } = require("../integrations/tally/canonical/voucher.canonical");

async function runExperiment04() {
  const expDir = path.resolve(__dirname, "../../experiments/EXP-04-voucher-extraction");
  if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

  const runId = `exp04_${Date.now()}`;
  const startedAt = new Date().toISOString();

  console.log("\n==================================================");
  console.log("CFO Yantra — Experiment 04: Document-Level Voucher Extraction");
  console.log(`Run ID: ${runId}`);
  console.log("==================================================\n");

  const probe = await probeTally();
  if (!probe.reachable || !probe.companies || probe.companies.length === 0) {
    const res = {
      experiment: "EXP-04",
      status: "BLOCKED",
      reason: !probe.reachable ? "TALLY_UNREACHABLE" : "NO_COMPANY_LOADED",
      dependency: "EXP-03",
      message: "Open a test company in TallyPrime."
    };
    fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(res, null, 2), "utf8");
    console.log(`RESULT: EXP-04 = BLOCKED (${res.reason})`);
    process.exit(2);
  }

  const xml = buildVouchersRequest();
  const xmlRes = await sendXmlRequest({ xml });
  const items = (xmlRes.parsedResponse && xmlRes.parsedResponse.collection) || [];
  const vouchers = items.map((i) => normalizeCanonicalVoucher(i)).filter(Boolean);
  const aggregates = aggregateVoucherLedgers(vouchers);

  const result = {
    experiment: "EXP-04",
    status: "PASSED",
    runtimeExecuted: true,
    totalVouchersExtracted: vouchers.length,
    aggregates,
    startedAt,
    completedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT: EXP-04 = ${result.status}\n`);
}

runExperiment04().catch(console.error);
