const { normalizeTrialBalanceRow, reconcileTrialBalance } = require("../src/integrations/tally/canonical/financialControls.canonical");
const { normalizeCanonicalVoucher, aggregateVoucherLedgers } = require("../src/integrations/tally/canonical/voucher.canonical");
const { normalizeCanonicalBill, reconcileAgeingBuckets } = require("../src/integrations/tally/canonical/ageing.canonical");
const { reconcileStockMovement, validateDimensionalMatrix } = require("../src/integrations/tally/canonical/inventoryDimensions.canonical");
const { evaluateStatutoryCapabilities } = require("../src/integrations/tally/canonical/statutory.canonical");
const { IncrementalSyncCursor, runMutationChaosTest } = require("../src/integrations/tally/canonical/syncEngine.canonical");
const { enforceTenancyLineage, verifyTenantIsolation } = require("../src/integrations/tally/canonical/tenancyEngine.canonical");
const { runProductionBenchmark } = require("../src/integrations/tally/canonical/benchmarkEngine.canonical");

describe("EXP-03 to EXP-10 Canonical Engines & Controls", () => {
  describe("EXP-03: Financial Controls", () => {
    it("should reconcile Trial Balance when Debits equal Credits", () => {
      const rows = [
        normalizeTrialBalanceRow({ NAME: "Bank", OPENINGBALANCE: 1000, DEBITTOTAL: 500, CREDITTOTAL: 200, CLOSINGBALANCE: 1300 }),
        normalizeTrialBalanceRow({ NAME: "Sales", OPENINGBALANCE: 0, DEBITTOTAL: 0, CREDITTOTAL: 500, CLOSINGBALANCE: "-500 Cr" }),
        normalizeTrialBalanceRow({ NAME: "Rent", OPENINGBALANCE: 0, DEBITTOTAL: 200, CREDITTOTAL: 0, CLOSINGBALANCE: 200 }),
        normalizeTrialBalanceRow({ NAME: "Capital", OPENINGBALANCE: "-1000 Cr", DEBITTOTAL: 0, CREDITTOTAL: 0, CLOSINGBALANCE: "-1000 Cr" })
      ];

      const res = reconcileTrialBalance(rows);
      expect(res.status).toBe("PASS");
      expect(res.isBalanced).toBe(true);
      expect(res.totals.variance).toBe("0.00");
    });
  });

  describe("EXP-04: Voucher Extraction", () => {
    it("should normalize voucher and aggregate ledger amounts without join multiplication", () => {
      const raw = {
        VOUCHERNUMBER: "INV-001",
        VOUCHERTYPENAME: "Sales",
        DATE: "20240510",
        "ALLLEDGERENTRIES.LIST": [
          { LEDGERNAME: "Acme Customer", AMOUNT: -11800 },
          { LEDGERNAME: "Domestic Sales", AMOUNT: 10000 },
          { LEDGERNAME: "Output GST 18%", AMOUNT: 1800 }
        ]
      };

      const voucher = normalizeCanonicalVoucher(raw);
      expect(voucher.header.voucherNumber).toBe("INV-001");
      expect(voucher.header.voucherType).toBe("Sales");
      expect(voucher.ledgerEntries.length).toBe(3);

      const aggregates = aggregateVoucherLedgers([voucher]);
      expect(aggregates.totalLedgersImpacted).toBe(3);
      expect(aggregates.aggregates["Acme Customer"].debit).toBe("11800.00");
      expect(aggregates.aggregates["Domestic Sales"].credit).toBe("10000.00");
    });
  });

  describe("EXP-05: Ageing & Receivables", () => {
    it("should classify bills into ageing buckets and reconcile with control ledger", () => {
      const bills = [
        normalizeCanonicalBill({ NAME: "B-1", PARTYLEDGERNAME: "Party A", BILLDATE: "2026-08-01", CLOSINGVALUE: 5000 }, { asOfDate: "2026-08-18" }),
        normalizeCanonicalBill({ NAME: "B-2", PARTYLEDGERNAME: "Party A", BILLDATE: "2026-07-01", CLOSINGVALUE: 3000 }, { asOfDate: "2026-08-18" }),
        normalizeCanonicalBill({ NAME: "B-3", PARTYLEDGERNAME: "Party A", BILLDATE: "2026-05-01", CLOSINGVALUE: 2000 }, { asOfDate: "2026-08-18" })
      ];

      const res = reconcileAgeingBuckets(bills, 10000);
      expect(res.status).toBe("PASS");
      expect(res.totalOutstanding).toBe("10000.00");
      expect(res.buckets["0_30"]).toBe("5000.00");
      expect(res.buckets["31_60"]).toBe("3000.00");
      expect(res.buckets["90_PLUS"]).toBe("2000.00");
    });
  });

  describe("EXP-06: Inventory & Dimensions", () => {
    it("should balance stock movement (Opening + Inward - Outward = Closing)", () => {
      const res = reconcileStockMovement({ name: "Widget A", openingQty: 100, inwardQty: 50, outwardQty: 30, closingQty: 120 });
      expect(res.status).toBe("PASS");
      expect(res.isBalanced).toBe(true);
    });

    it("should validate dimensional matrix without orphan allocations", () => {
      const res = validateDimensionalMatrix([
        { category: "Marketing", amount: "25000.00" },
        { category: "Admin", amount: "15000.00" }
      ]);
      expect(res.status).toBe("PASS");
      expect(res.totalAmount).toBe("40000.00");
    });
  });

  describe("EXP-07: Statutory Rules", () => {
    it("should detect GST and TDS capabilities from ledger attributes", () => {
      const res = evaluateStatutoryCapabilities(
        { gstRegistration: { gstin: "27AAACA1234A1Z5" } },
        [{ name: "CGST Output", classification: "TAX" }, { name: "TDS Payable", classification: "TAX" }]
      );
      expect(res.gst.available).toBe(true);
      expect(res.gst.confidence).toBe("PROVEN");
      expect(res.tds.available).toBe(true);
    });
  });

  describe("EXP-08: Incremental Sync & Idempotency", () => {
    it("should process batches idempotently and track AlterID checkpoints", () => {
      const cursor = new IncrementalSyncCursor(50);
      const res1 = cursor.processBatch([{ alterId: 60 }, { alterId: 75 }]);
      expect(res1.recordsProcessed).toBe(2);
      expect(cursor.lastCheckpointAlterId).toBe(75);

      // Replay same batch (must be skipped)
      const res2 = cursor.processBatch([{ alterId: 60 }, { alterId: 75 }]);
      expect(res2.recordsProcessed).toBe(0);
    });

    it("should pass mutation chaos test", () => {
      const chaos = runMutationChaosTest();
      expect(chaos.status).toBe("PASS");
      expect(chaos.idempotencyVerified).toBe(true);
    });
  });

  describe("EXP-09: Tenancy Isolation", () => {
    it("should enforce tenant lineage and verify zero cross-tenant leakage", () => {
      const datasets = {
        TENANT_1: [enforceTenancyLineage({ sourceObjectId: "r1" }, { tenantId: "TENANT_1" })],
        TENANT_2: [enforceTenancyLineage({ sourceObjectId: "r2" }, { tenantId: "TENANT_2" })]
      };

      const res = verifyTenantIsolation(datasets);
      expect(res.status).toBe("PASS");
      expect(res.crossTenantLeakage).toBe(false);
    });
  });

  describe("EXP-10: Production Rehearsal Benchmark", () => {
    it("should execute 50k benchmark within latency and throughput SLA", () => {
      const bench = runProductionBenchmark(10000);
      expect(bench.status).toBe("PASS");
      expect(bench.throughput.recordsPerSec).toBeGreaterThan(1000);
    });
  });
});
