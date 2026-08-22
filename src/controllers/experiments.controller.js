const fs = require("fs");
const path = require("path");

const EXPERIMENT_DIRS = {
  "01": "EXP-01-transport",
  "02": "EXP-02-company-masters",
  "03": "EXP-03-financial-controls",
  "04": "EXP-04-voucher-extraction",
  "05": "EXP-05-working-capital",
  "06": "EXP-06-inventory-dimensions",
  "07": "EXP-07-advanced-configuration",
  "08": "EXP-08-incremental-sync",
  "09": "EXP-09-multi-company-tenancy",
  "10": "EXP-10-production-rehearsal"
};

const EXPERIMENT_META = [
  { id: "01", name: "Transport & Handshake", description: "Tally HTTP/XML loopback transport, multi-format detection & read-only gate." },
  { id: "02", name: "Company & Masters", description: "Company identity, ledger hierarchy, voucher types, and capability manifest." },
  { id: "03", name: "Financial Controls", description: "Monthly Trial Balance, P&L, and exact decimal arithmetic reconciliation." },
  { id: "04", name: "Voucher Extraction", description: "Voucher headers, nested ledger lines, and bill-wise allocation entries." },
  { id: "05", name: "Receivables & Payables", description: "Bill settlement, historical outstanding balances, and ageing controls." },
  { id: "06", name: "Inventory & Dimensions", description: "Stock items, godowns, batches, and unit valuation reconciliations." },
  { id: "07", name: "Advanced Configuration", description: "GST, TDS, TCS, multi-currency, and statutory capability discovery." },
  { id: "08", name: "Incremental Sync", description: "Checkpoints, cursor management, retry backoff, and change detection." },
  { id: "09", name: "Multi Company & Tenancy", description: "Tenant isolation, multi-entity portfolio, and legal entity mapping." },
  { id: "10", name: "Production Rehearsal", description: "High-volume voucher load test (50k+ records) and performance latency SLA." }
];

function getExperimentData(id) {
  const dirName = EXPERIMENT_DIRS[id];
  if (!dirName) return null;
  const expDir = path.resolve(__dirname, `../../experiments/${dirName}`);
  const resultFile = path.join(expDir, "result.json");
  const manifestFile = path.join(expDir, "run-manifest.json");

  const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8")) : null;
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : null;

  return { result, manifest, expDir };
}

async function getExperiments(req, res) {
  const list = EXPERIMENT_META.map((item) => {
    const data = getExperimentData(item.id);
    let status = "PENDING";
    if (data && data.result) {
      status = data.result.status || "PASSED";
    }
    return {
      ...item,
      status
    };
  });
  return res.json(list);
}

function createExperimentHandler(id) {
  return async function (req, res) {
    try {
      const data = getExperimentData(id);
      const meta = EXPERIMENT_META.find((m) => m.id === id);
      return res.json({
        experimentId: `EXP-${id}`,
        name: meta ? meta.name : `Experiment ${id}`,
        status: data && data.result ? data.result.status : "READY",
        result: data ? data.result : null,
        manifest: data ? data.manifest : null
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}

module.exports = {
  getExperiments,
  getExperiment01: createExperimentHandler("01"),
  getExperiment02: createExperimentHandler("02"),
  getExperiment03: createExperimentHandler("03"),
  getExperiment04: createExperimentHandler("04"),
  getExperiment05: createExperimentHandler("05"),
  getExperiment06: createExperimentHandler("06"),
  getExperiment07: createExperimentHandler("07"),
  getExperiment08: createExperimentHandler("08"),
  getExperiment09: createExperimentHandler("09"),
  getExperiment10: createExperimentHandler("10")
};
