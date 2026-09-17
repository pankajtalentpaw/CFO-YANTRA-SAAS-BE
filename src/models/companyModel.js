const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

/**
 * A company as discovered and mirrored from TallyPrime.
 * Stores comprehensive legal, statutory, contact, financial period,
 * and feature configuration metadata.
 */
const Company = sequelize.define(
  "Company",
  {
    companyId: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    legalName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    formalName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    guid: {
      type: DataTypes.STRING,
      allowNull: true
    },
    masterId: {
      type: DataTypes.BIGINT,
      allowNull: true
    },
    alterId: {
      type: DataTypes.BIGINT,
      allowNull: true
    },

    // Financial periods
    startingFrom: {
      type: DataTypes.STRING,
      allowNull: true
    },
    startingAt: {
      type: DataTypes.STRING,
      allowNull: true
    },
    booksFrom: {
      type: DataTypes.STRING,
      allowNull: true
    },
    financialYearBeginning: {
      type: DataTypes.STRING,
      allowNull: true
    },

    // Currency & Jurisdiction
    baseCurrency: {
      type: DataTypes.STRING,
      defaultValue: "INR"
    },
    country: {
      type: DataTypes.STRING,
      defaultValue: "India"
    },
    countryName: {
      type: DataTypes.STRING,
      defaultValue: "India"
    },
    state: {
      type: DataTypes.STRING,
      allowNull: true
    },
    stateName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pinCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    address: {
      type: DataTypes.JSON,
      allowNull: true
    },

    // Statutory & Tax Registrations
    gstin: {
      type: DataTypes.STRING,
      allowNull: true
    },
    gstRegNo: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pan: {
      type: DataTypes.STRING,
      allowNull: true
    },
    panCardNo: {
      type: DataTypes.STRING,
      allowNull: true
    },
    cin: {
      type: DataTypes.STRING,
      allowNull: true
    },
    cinNo: {
      type: DataTypes.STRING,
      allowNull: true
    },

    // Contact details
    email: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    mobile: {
      type: DataTypes.STRING,
      allowNull: true
    },
    mobileNo: {
      type: DataTypes.STRING,
      allowNull: true
    },

    // Feature matrix
    features: {
      type: DataTypes.JSON,
      defaultValue: {
        billWise: false,
        costCentres: false,
        inventory: true,
        multiCurrency: false,
        payroll: false,
        gstApplicable: false,
        tdsApplicable: false,
        tcsApplicable: false,
        batchEnabled: false,
        godownEnabled: false,
        bomEnabled: false
      }
    },

    // Operational state & synchronization
    isOpen: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    closedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    checksum: {
      type: DataTypes.STRING,
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
    metadata: {
      type: DataTypes.JSON,
      allowNull: true
    }
  },
  {
    tableName: "companies",
    timestamps: true,
    indexes: [
      {
        fields: ["isOpen"]
      },
      {
        fields: ["gstin"]
      },
      {
        fields: ["pan"]
      }
    ]
  }
);

const { attachCompat } = require("./sqlModelCompat");

module.exports = attachCompat(Company);
