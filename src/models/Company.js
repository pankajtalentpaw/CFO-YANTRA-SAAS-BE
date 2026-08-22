const mongoose = require("mongoose");

/**
 * A company as discovered in TallyPrime.
 *
 * `isOpen` tracks whether the company was still loaded in Tally at the last
 * discovery pass. It matters operationally: extracting against a company that
 * is no longer open is blocked upstream by a hard safety gate, because sending
 * SVCURRENTCOMPANY for a closed company crashes TallyPrime.
 */
const companySchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, unique: true },
    name: { type: String, default: null },
    guid: { type: String, default: null },

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

module.exports = mongoose.models.Company || mongoose.model("Company", companySchema);
