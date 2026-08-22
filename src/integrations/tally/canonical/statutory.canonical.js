/**
 * EXP-07: Advanced Configuration, Statutory Tax Rules & Multi-Currency Engine
 */

function evaluateStatutoryCapabilities(company, ledgers = [], vouchers = []) {
  const gstDetails = (company && company.gstRegistration) || {};
  const hasGstin = Boolean(gstDetails.gstin);
  const gstLedgers = ledgers.filter((l) => l.classification === "TAX" && (l.name.includes("GST") || l.name.includes("CGST") || l.name.includes("SGST") || l.name.includes("IGST")));
  const tdsLedgers = ledgers.filter((l) => l.name.includes("TDS") || l.name.includes("Tax Deducted"));
  const multiCurrencies = ledgers.filter((l) => l.currency && l.currency !== "INR");

  return {
    gst: {
      available: hasGstin || gstLedgers.length > 0,
      confidence: hasGstin ? "PROVEN" : (gstLedgers.length > 0 ? "PARTIAL" : "NOT_PRESENT"),
      gstin: gstDetails.gstin || null,
      taxLedgersCount: gstLedgers.length
    },
    tds: {
      available: tdsLedgers.length > 0,
      confidence: tdsLedgers.length > 0 ? "PROVEN" : "NOT_PRESENT",
      tdsLedgersCount: tdsLedgers.length
    },
    multiCurrency: {
      available: multiCurrencies.length > 0,
      confidence: multiCurrencies.length > 0 ? "PROVEN" : "NOT_PRESENT",
      foreignCurrenciesDetected: multiCurrencies.length
    },
    payroll: {
      available: Boolean(company && company.features && company.features.payroll),
      confidence: (company && company.features && company.features.payroll) ? "PROVEN" : "NOT_PRESENT"
    },
    evaluationTimestamp: new Date().toISOString()
  };
}

module.exports = {
  evaluateStatutoryCapabilities
};
