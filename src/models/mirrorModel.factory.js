const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

/**
 * Every canonical Tally record produced by the parsers shares one envelope:
 * it is scoped to a company, identified by a stable object id, and carries a
 * checksum. The mirror leans on all three - companyId to isolate tenants,
 * sourceObjectId as the upsert key, checksum to detect real change.
 *
 * Each object type carries a different body (a Ledger has openingBalance, a
 * StockItem has units). The schema stores top-level indexed envelope columns
 * alongside the verbatim canonical record in the `data` JSON column.
 */
function buildMirrorModel(modelName, objectType, tableName) {
  if (sequelize.models[modelName]) return sequelize.models[modelName];

  const Model = sequelize.define(
    modelName,
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      companyId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      sourceObjectId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      objectType: {
        type: DataTypes.STRING,
        defaultValue: objectType
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true
      },
      parent: {
        type: DataTypes.STRING,
        allowNull: true
      },
      checksum: {
        type: DataTypes.STRING,
        allowNull: true
      },
      contentHash: {
        type: DataTypes.STRING,
        allowNull: true
      },
      isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      deletedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      syncedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      lastRunId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      data: {
        type: DataTypes.JSON,
        allowNull: true
      }
    },
    {
      tableName,
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["companyId", "sourceObjectId"]
        },
        {
          fields: ["companyId", "isDeleted"]
        },
        {
          fields: ["companyId", "name"]
        }
      ]
    }
  );

  return Model;
}

const { attachCompat } = require("./sqlModelCompat");

module.exports = { buildMirrorModel: (modelName, objectType, tableName) => attachCompat(buildMirrorModel(modelName, objectType, tableName)) };
