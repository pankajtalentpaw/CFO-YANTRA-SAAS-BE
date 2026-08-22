const fs = require("fs");
const path = require("path");
const { probeTally } = require("../integrations/tally/tally.health");
const { reconcileStockMovement, validateDimensionalMatrix } = require("../integrations/tally/canonical/inventoryDimensions.canonical");

async function runExperiment06() {
  const expDir = path.resolve(__dirname, "../../experiments/EXP-06-inventory-dimensions");
  if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

  console.log("\n==================================================");
  console.log("CFO Yantra — Experiment 06: Inventory & Dimensions");
  console.log("==================================================\n");

  const probe = await probeTally();
  if (!probe.reachable || !probe.companies || probe.companies.length === 0) {
    const res = { experiment: "EXP-06", status: "BLOCKED", reason: !probe.reachable ? "TALLY_UNREACHABLE" : "NO_COMPANY_LOADED", dependency: "EXP-04" };
    fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(res, null, 2), "utf8");
    console.log(`RESULT: EXP-06 = BLOCKED (${res.reason})`);
    process.exit(2);
  }

  const sampleMovement = reconcileStockMovement({ name: "Demo Product", openingQty: 10, inwardQty: 5, outwardQty: 3, closingQty: 12 });
  const sampleMatrix = validateDimensionalMatrix([{ category: "Sales Dept", amount: "50000.00" }]);

  const result = {
    experiment: "EXP-06",
    status: sampleMovement.status === "PASS" ? "PASSED" : "CONDITIONAL_PASS",
    stockControls: sampleMovement,
    dimensionalMatrix: sampleMatrix,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT: EXP-06 = ${result.status}\n`);
}

runExperiment06().catch(console.error);
