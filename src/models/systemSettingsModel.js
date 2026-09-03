const mongoose = require("mongoose");

/**
 * System Settings Model
 * Persists application-level and integration configurations such as dynamic Tally connection parameters.
 */
const systemSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "TALLY_CONFIG"
    },
    tallyHost: {
      type: String,
      trim: true,
      default: "127.0.0.1"
    },
    tallyPort: {
      type: Number,
      min: 1,
      max: 65535,
      default: 9000
    },
    protocol: {
      type: String,
      enum: ["http", "https"],
      default: "http"
    },
    connectionMode: {
      type: String,
      enum: ["DIRECT", "AGENT"],
      default: "DIRECT"
    },
    targetCompany: {
      type: String,
      trim: true,
      default: ""
    },
    timeoutMs: {
      type: Number,
      min: 1000,
      max: 300000,
      default: 120000
    },
    probeTimeoutMs: {
      type: Number,
      min: 1000,
      max: 60000,
      default: 8000
    },
    autoSyncEnabled: {
      type: Boolean,
      default: true
    },
    syncIntervalMs: {
      type: Number,
      min: 10000,
      max: 3600000,
      default: 300000
    },
    lastKnownStatus: {
      type: String,
      enum: ["ONLINE", "OFFLINE", "UNKNOWN"],
      default: "UNKNOWN"
    },
    lastConnectedAt: {
      type: Date,
      default: null
    },
    lastResponseTimeMs: {
      type: Number,
      default: null
    },
    activeCompanies: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true
  }
);

const SystemSettings = mongoose.models.SystemSettings || mongoose.model("SystemSettings", systemSettingsSchema);

module.exports = SystemSettings;
