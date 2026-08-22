/**
 * Capability Manifest Builder
 * Generates a machine-readable capability manifest based on actual source evidence.
 */

const MANIFEST_VERSION = "1.0";

/**
 * Build versioned Capability Manifest from Company features and Master counts
 * @param {object} company - Canonical Company
 * @param {object} masterCounts - Master counts object
 * @returns {object} Machine-readable capability manifest
 */
function buildCapabilityManifest(company, masterCounts = {}) {
  const companyFeatures = company ? (company.features || {}) : {};
  const gstDetails = company ? (company.gstRegistration || {}) : {};

  const manifest = {
    capabilityManifestVersion: MANIFEST_VERSION,
    experiment: "EXP-02",
    company: {
      sourceCompanyId: company ? company.sourceCompanyId : "UNKNOWN",
      displayName: company ? company.displayName : "Unknown",
      legalName: company ? company.legalName : "Unknown",
      guid: company ? company.guid : null,
      financialYearBeginning: company ? company.financialYearBeginning : null,
      booksFrom: company ? company.booksFrom : null,
      baseCurrency: company ? company.baseCurrency : "INR"
    },
    capabilities: {
      billWise: {
        available: Boolean(companyFeatures.billWise || (masterCounts.ledgersWithBillWise && masterCounts.ledgersWithBillWise > 0)),
        confidence: companyFeatures.billWise ? "PROVEN" : (masterCounts.ledgersWithBillWise > 0 ? "PARTIAL" : "NOT_PRESENT"),
        evidence: companyFeatures.billWise ? "Flagged active in company properties" : "Inferred from ledger bill-wise flags"
      },
      inventory: {
        available: Boolean(companyFeatures.inventory || (masterCounts.stockItems && masterCounts.stockItems > 0)),
        confidence: (masterCounts.stockItems && masterCounts.stockItems > 0) ? "PROVEN" : (companyFeatures.inventory ? "PARTIAL" : "NOT_PRESENT"),
        evidence: `Stock Items detected: ${masterCounts.stockItems || 0}, Company Inventory flag: ${Boolean(companyFeatures.inventory)}`
      },
      costCentres: {
        available: Boolean(companyFeatures.costCentres || (masterCounts.costCentres && masterCounts.costCentres > 0)),
        confidence: (masterCounts.costCentres && masterCounts.costCentres > 0) ? "PROVEN" : (companyFeatures.costCentres ? "PARTIAL" : "NOT_PRESENT"),
        evidence: `Cost Centres detected: ${masterCounts.costCentres || 0}`
      },
      gst: {
        available: Boolean(companyFeatures.gstApplicable || gstDetails.gstin),
        confidence: gstDetails.gstin ? "PROVEN" : (companyFeatures.gstApplicable ? "PARTIAL" : "NOT_PRESENT"),
        evidence: gstDetails.gstin ? `GSTIN: ${gstDetails.gstin}` : "GST enabled without verified GSTIN"
      },
      tds: {
        available: Boolean(companyFeatures.tdsApplicable),
        confidence: companyFeatures.tdsApplicable ? "PROVEN" : "NOT_PRESENT",
        evidence: `TDS flag: ${Boolean(companyFeatures.tdsApplicable)}`
      },
      tcs: {
        available: Boolean(companyFeatures.tcsApplicable),
        confidence: companyFeatures.tcsApplicable ? "PROVEN" : "NOT_PRESENT",
        evidence: `TCS flag: ${Boolean(companyFeatures.tcsApplicable)}`
      },
      multiCurrency: {
        available: Boolean(companyFeatures.multiCurrency || (masterCounts.currencies && masterCounts.currencies > 1)),
        confidence: (masterCounts.currencies && masterCounts.currencies > 1) ? "PROVEN" : (companyFeatures.multiCurrency ? "PARTIAL" : "NOT_PRESENT"),
        evidence: `Currencies detected: ${masterCounts.currencies || 1}`
      },
      payroll: {
        available: Boolean(companyFeatures.payroll),
        confidence: companyFeatures.payroll ? "PROVEN" : "NOT_PRESENT",
        evidence: `Payroll flag: ${Boolean(companyFeatures.payroll)}`
      },
      batches: {
        available: Boolean(companyFeatures.batchEnabled),
        confidence: companyFeatures.batchEnabled ? "PROVEN" : "NOT_PRESENT",
        evidence: `Batch flag: ${Boolean(companyFeatures.batchEnabled)}`
      },
      godowns: {
        available: Boolean(companyFeatures.godownEnabled || (masterCounts.godowns && masterCounts.godowns > 1)),
        confidence: (masterCounts.godowns && masterCounts.godowns > 1) ? "PROVEN" : (companyFeatures.godownEnabled ? "PARTIAL" : "NOT_PRESENT"),
        evidence: `Godowns detected: ${masterCounts.godowns || 0}`
      },
      bom: {
        available: Boolean(companyFeatures.bomEnabled),
        confidence: companyFeatures.bomEnabled ? "PROVEN" : "NOT_PRESENT",
        evidence: `BOM flag: ${Boolean(companyFeatures.bomEnabled)}`
      },
      editLog: {
        available: false,
        confidence: "UNSUPPORTED",
        evidence: "TallyPrime Edit Log TDL collection not probed in EXP-02"
      },
      customTdl: {
        available: false,
        confidence: "NOT_PRESENT",
        evidence: "Standard native methods only"
      }
    },
    generatedAt: new Date().toISOString()
  };

  return manifest;
}

module.exports = {
  MANIFEST_VERSION,
  buildCapabilityManifest
};
