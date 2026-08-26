const mongoose = require("mongoose");

/**
 * A company as discovered and mirrored from TallyPrime.
 *
 * Stores comprehensive legal, statutory, contact, financial period,
 * and feature configuration metadata for complete 360° company profiles.
 */
const companySchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, unique: true },
    name: { type: String, default: null },
    legalName: { type: String, default: null },
    formalName: { type: String, default: null },
    guid: { type: String, default: null },
    masterId: { type: Number, default: null },
    alterId: { type: Number, default: null },

    // Financial periods
    startingFrom: { type: String, default: null },
    startingAt: { type: String, default: null },
    booksFrom: { type: String, default: null },
    financialYearBeginning: { type: String, default: null },

    // Currency & Jurisdiction
    baseCurrency: { type: String, default: "INR" },
    country: { type: String, default: "India" },
    countryName: { type: String, default: "India" },
    state: { type: String, default: null },
    stateName: { type: String, default: null },
    pinCode: { type: String, default: null },
    address: { type: mongoose.Schema.Types.Mixed, default: null },

    // Statutory & Tax Registrations
    gstin: { type: String, default: null },
    gstRegNo: { type: String, default: null },
    pan: { type: String, default: null },
    panCardNo: { type: String, default: null },
    cin: { type: String, default: null },
    cinNo: { type: String, default: null },

    // Contact details
    email: { type: String, default: null },
    phone: { type: String, default: null },
    phoneNumber: { type: String, default: null },
    mobile: { type: String, default: null },
    mobileNo: { type: String, default: null },

    // Tally Module & Feature Matrix
    features: {
      billWise: { type: Boolean, default: false },
      costCentres: { type: Boolean, default: false },
      inventory: { type: Boolean, default: true },
      multiCurrency: { type: Boolean, default: false },
      payroll: { type: Boolean, default: false },
      gstApplicable: { type: Boolean, default: false },
      tdsApplicable: { type: Boolean, default: false },
      tcsApplicable: { type: Boolean, default: false },
      batchEnabled: { type: Boolean, default: false },
      godownEnabled: { type: Boolean, default: false },
      bomEnabled: { type: Boolean, default: false }
    },

    // Operational state & synchronization
    isOpen: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
    checksum: { type: String, default: null },
    syncedAt: { type: Date, default: Date.now },
    lastRunId: { type: String, default: null }
  },
  { strict: false, timestamps: true, collection: "companies", minimize: false }
);

companySchema.index({ isOpen: 1 });
companySchema.index({ gstin: 1 });
companySchema.index({ pan: 1 });

const Company = mongoose.models.Company || mongoose.model("Company", companySchema);

module.exports = Company;
