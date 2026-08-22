const fs = require("fs");
const path = require("path");
const { verifyTenantIsolation, enforceTenancyLineage } = require("../integrations/tally/canonical/tenancyEngine.canonical");

async function runExperiment09() {
  const expDir = path.resolve(__dirname, "../../experiments/EXP-09-multi-company-tenancy");
  if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });

  console.log("\n==================================================");
  console.log("CFO Yantra — Experiment 09: Multi-Company & Tenancy Isolation");
  console.log("==================================================\n");

  const sampleDatasets = {
    TENANT_A: [
      enforceTenancyLineage({ sourceObjectId: "rec_1", sourceCompanyId: "CMP_A" }, { tenantId: "TENANT_A" }),
      enforceTenancyLineage({ sourceObjectId: "rec_2", sourceCompanyId: "CMP_A" }, { tenantId: "TENANT_A" })
    ],
    TENANT_B: [
      enforceTenancyLineage({ sourceObjectId: "rec_3", sourceCompanyId: "CMP_B" }, { tenantId: "TENANT_B" })
    ]
  };

  const isolation = verifyTenantIsolation(sampleDatasets);
  const result = {
    experiment: "EXP-09",
    status: isolation.status === "PASS" ? "PASSED" : "FAILED",
    isolation,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(path.join(expDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`RESULT: EXP-09 = ${result.status}\n`);
}

runExperiment09().catch(console.error);
