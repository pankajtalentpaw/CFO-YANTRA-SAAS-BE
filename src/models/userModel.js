const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    mobile: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    fullName: {
      type: DataTypes.STRING,
      defaultValue: ""
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true
    },
    role: {
      type: DataTypes.STRING,
      defaultValue: "admin"
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: "users",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["mobile"]
      }
    ]
  }
);

// Compatibility getter so user._id continues to work
Object.defineProperty(User.prototype, "_id", {
  get() {
    return this.id;
  }
});

const { attachCompat } = require("./sqlModelCompat");

module.exports = attachCompat(User);
