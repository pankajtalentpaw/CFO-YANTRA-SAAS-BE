const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

/**
 * Vouchers are transactions rather than masters: same envelope, but queried by
 * date and voucher number, so they get their own model and dedicated indexes.
 */
const Voucher = sequelize.define(
  "Voucher",
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
      defaultValue: "Voucher"
    },
    voucherDate: {
      type: DataTypes.STRING,
      allowNull: true
    },
    sourceVoucherNumber: {
      type: DataTypes.STRING,
      allowNull: true
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
    header: {
      type: DataTypes.JSON,
      allowNull: true
    },
    entries: {
      type: DataTypes.JSON,
      allowNull: true
    },
    data: {
      type: DataTypes.JSON,
      allowNull: true
    }
  },
  {
    tableName: "vouchers",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["companyId", "sourceObjectId"]
      },
      {
        fields: ["companyId", "voucherDate"]
      },
      {
        fields: ["companyId", "sourceVoucherNumber"]
      },
      {
        fields: ["companyId", "isDeleted"]
      }
    ]
  }
);

const { attachCompat } = require("./sqlModelCompat");

module.exports = attachCompat(Voucher);
