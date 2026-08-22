const { reconcileMasters, evaluateDeterminism } = require("../src/integrations/tally/canonical/reconciliation.engine");
const { buildCapabilityManifest } = require("../src/integrations/tally/canonical/manifest.canonical");
const { calculateFieldCoverage } = require("../src/integrations/tally/canonical/fieldCoverage");

describe("Capability Manifest, Reconciliation & Determinism Engines", () => {
  it("should build structured capability manifest with confidence levels", () => {
    const company = {
      sourceCompanyId: "CMP_1",
      displayName: "Apex Industries",
      features: {
        billWise: true,
        inventory: true,
        costCentres: true,
        gstApplicable: true
      },
      gstRegistration: {
        gstin: "27AABCA1234A1Z5"
      }
    };

    const counts = {
      stockItems: 25,
      costCentres: 4,
      currencies: 2,
      godowns: 3
    };

    const manifest = buildCapabilityManifest(company, counts);
    expect(manifest.capabilityManifestVersion).toBe("1.0");
    expect(manifest.capabilities.billWise.available).toBe(true);
    expect(manifest.capabilities.billWise.confidence).toBe("PROVEN");
    expect(manifest.capabilities.inventory.confidence).toBe("PROVEN");
    expect(manifest.capabilities.gst.confidence).toBe("PROVEN");
    expect(manifest.capabilities.multiCurrency.confidence).toBe("PROVEN");
  });

  it("should reconcile matching master counts and valid hierarchy", () => {
    const rawCounts = {
      groups: 2,
      ledgers: 2
    };

    const canonicalMasters = {
      groups: [
        { name: "Current Assets", parent: "Primary", sourceObjectId: "g1" },
        { name: "Bank Accounts", parent: "Current Assets", sourceObjectId: "g2" }
      ],
      ledgers: [
        { name: "HDFC Bank", parent: "Bank Accounts", sourceObjectId: "l1" },
        { name: "Cash", parent: "Current Assets", sourceObjectId: "l2" }
      ]
    };

    const reconciliation = reconcileMasters(rawCounts, canonicalMasters);
    expect(reconciliation.status).toBe("PASS");
    expect(reconciliation.hierarchy.status).toBe("PASS");
    expect(reconciliation.identityUniqueness.status).toBe("PASS");
  });

  it("should detect hierarchy warning when parent group is missing", () => {
    const rawCounts = { groups: 1, ledgers: 1 };
    const canonicalMasters = {
      groups: [{ name: "Current Assets", parent: "Primary", sourceObjectId: "g1" }],
      ledgers: [{ name: "HDFC Bank", parent: "Unknown Parent Group", sourceObjectId: "l1" }]
    };

    const reconciliation = reconcileMasters(rawCounts, canonicalMasters);
    expect(reconciliation.hierarchy.status).toBe("WARNING");
    expect(reconciliation.hierarchy.missingLedgerParents.length).toBe(1);
  });

  it("should verify determinism across 3 runs", () => {
    const runs = [
      { checksum: "abc12345", counts: { ledgers: 10 } },
      { checksum: "abc12345", counts: { ledgers: 10 } },
      { checksum: "abc12345", counts: { ledgers: 10 } }
    ];

    const result = evaluateDeterminism(runs);
    expect(result.status).toBe("PASS");
    expect(result.deterministic).toBe(true);
  });

  it("should detect variance when checksums differ across runs", () => {
    const runs = [
      { checksum: "abc12345", counts: { ledgers: 10 } },
      { checksum: "diff9999", counts: { ledgers: 10 } }
    ];

    const result = evaluateDeterminism(runs);
    expect(result.status).toBe("FAIL");
    expect(result.varianceDetected).toBe(true);
  });

  it("should calculate field coverage accurately", () => {
    const masters = {
      company: {
        displayName: "Apex Co",
        legalName: "Apex Co",
        guid: "g-1",
        baseCurrency: "INR"
      },
      groups: [
        { name: "Assets", sourceObjectId: "g-1", parent: "Primary", isAddable: true }
      ],
      ledgers: [
        { name: "Bank", sourceObjectId: "l-1", parent: "Assets", classification: "BANK", isActive: true }
      ]
    };

    const coverage = calculateFieldCoverage(masters);
    expect(coverage.totalFieldsEvaluated).toBeGreaterThan(5);
    expect(coverage.fields["Company.displayName"].populated).toBe(1);
    expect(coverage.fields["Group.name"].populated).toBe(1);
    expect(coverage.fields["Ledger.name"].populated).toBe(1);
  });
});
