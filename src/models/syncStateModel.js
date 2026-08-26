const mongoose = require("mongoose");

/**
 * Per-company record of what the last sync run did.
 *
 * This is what /api/sync/status reports, and what tells an operator whether the
 * mirror can be trusted for a given company: which domains succeeded, which
 * failed and why, and how stale the data is.
 */
const domainResultSchema = new mongoose.Schema(
  {
    status: { type: String, default: "PENDING" }, // PENDING | SUCCESS | FAILED | SKIPPED
    total: { type: Number, default: 0 },
    inserted: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    unchanged: { type: Number, default: 0 },
    tombstoned: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
    syncedAt: { type: Date, default: null }
  },
  { _id: false }
);

const syncStateSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, unique: true },
    companyName: { type: String, default: null },

    // IDLE | RUNNING | SUCCESS | PARTIAL | FAILED
    status: { type: String, default: "IDLE" },
    lastRunId: { type: String, default: null },
    lastStartedAt: { type: Date, default: null },
    lastFinishedAt: { type: Date, default: null },
    lastDurationMs: { type: Number, default: 0 },
    lastSuccessAt: { type: Date, default: null },
    lastError: { type: mongoose.Schema.Types.Mixed, default: null },

    domains: { type: Map, of: domainResultSchema, default: {} },
    totalRecords: { type: Number, default: 0 },
    changedRecords: { type: Number, default: 0 },
    runCount: { type: Number, default: 0 }
  },
  { timestamps: true, collection: "syncstates", minimize: false }
);

const SyncState = mongoose.models.SyncState || mongoose.model("SyncState", syncStateSchema);

module.exports = SyncState;
