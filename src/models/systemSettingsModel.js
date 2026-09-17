const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const SystemSettings = sequelize.define(
  "SystemSettings",
  {
    key: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false
    },
    tallyHost: {
      type: DataTypes.STRING,
      defaultValue: "127.0.0.1"
    },
    tallyPort: {
      type: DataTypes.INTEGER,
      defaultValue: 9000
    },
    protocol: {
      type: DataTypes.STRING,
      defaultValue: "http"
    },
    connectionMode: {
      type: DataTypes.STRING,
      defaultValue: "DIRECT"
    },
    targetCompany: {
      type: DataTypes.STRING,
      defaultValue: ""
    },
    timeoutMs: {
      type: DataTypes.INTEGER,
      defaultValue: 120000
    },
    probeTimeoutMs: {
      type: DataTypes.INTEGER,
      defaultValue: 8000
    },
    autoSyncEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    syncIntervalMs: {
      type: DataTypes.INTEGER,
      defaultValue: 300000
    },
    lastKnownStatus: {
      type: DataTypes.STRING,
      defaultValue: "UNKNOWN"
    },
    lastConnectedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastResponseTimeMs: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    activeCompanies: {
      type: DataTypes.JSON,
      defaultValue: []
    }
  },
  {
    tableName: "system_settings",
    timestamps: true
  }
);

const { attachCompat } = require("./sqlModelCompat");

module.exports = attachCompat(SystemSettings);
