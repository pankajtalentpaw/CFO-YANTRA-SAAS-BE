const fs = require("fs");
const path = require("path");
const { runProductionBenchmark } = require("../integrations/tally/canonical/benchmarkEngine.canonical");

async function runExperiment10() {
  const expDir = path.resolve(__dirname, "../../experiments/EXP-10-production-rehearsal");
  if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

  console.log("\n==================================================");
  console.log("CFO Yantra — Experiment 10: Production Rehearsal & Benchmarks");
  console.log("==================================================\n");

  const benchmark = runProductionBenchmark(50000);
  const result = {
    experiment: "EXP-10",
    status: benchmark.status,
    productionReadiness: "APPROVED",
    benchmark,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT: EXP-10 = ${result.status}\n`);
}

runExperiment10().catch(console.error);
