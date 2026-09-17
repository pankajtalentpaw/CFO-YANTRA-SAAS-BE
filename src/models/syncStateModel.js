const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const SyncState = sequelize.define(
  "SyncState",
  {
    companyId: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false
    },
    companyName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: "IDLE"
    },
    lastRunId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    lastStartedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastFinishedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastDurationMs: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    lastSuccessAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastError: {
      type: DataTypes.JSON,
      allowNull: true
    },
    totalRecords: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    changedRecords: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    runCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    domains: {
      type: DataTypes.JSON,
      defaultValue: {}
    }
  },
  {
    tableName: "sync_states",
    timestamps: true
  }
);

const { attachCompat } = require("./sqlModelCompat");

module.exports = attachCompat(SyncState);
