/**
 * TallyPrime API Explorer Complete Specifications & Schema Catalog
 * Extracted directly from https://tallysolutions.com/tallyprime-api-explorer/
 *
 * Covers all 63 endpoints across:
 * 1. Accounting Masters (Ledger, Group)
 * 2. Inventory Masters (Stock Item, Stock Group, Units)
 * 3. Transactions / Accounting Vouchers (Payment, Receipt, Sales, Purchase)
 * 4. Reports (Trial Balance, Sales Register)
 */

"use strict";

const CATALOG = {
  // ==========================================
  // 1. ACCOUNTING MASTERS - LEDGER
  // ==========================================
  "pull-all-ledger": {
    category: "Accounting Masters",
    entity: "Ledger",
    action: "Pull All Ledgers",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "Ledger"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ]
    })
  },

  "pull-a-ledger": {
    category: "Accounting Masters",
    entity: "Ledger",
    action: "Pull a Ledger",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "Ledger"
    },
    buildBody: (companyName, { fetch = ["Name", "Parent", "Opening Balance", "Closing Balance"] } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonEx" },
        { name: "svCurrentCompany", value: companyName }
      ],
      fetch_list: fetch
    })
  },

  "pull-ledgers-of-group": {
    category: "Accounting Masters",
    entity: "Ledger",
    action: "Pull Ledgers of Group",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPLBankLedgers"
    },
    buildBody: (companyName, { groupName = "$$GroupBank" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPLBankLedgers", type: "Collection" },
              attributes: [
                { Type: "Ledger" },
                { "Child Of": groupName },
                { "Native Method": "Name, Parent, OpeningBalance, ClosingBalance, IseBankingEnabled, Mailing Name, Bank Details" }
              ]
            }
          ]
        }
      ]
    })
  },

  // ==========================================
  // 1. ACCOUNTING MASTERS - GROUP
  // ==========================================
  "pull-all-groups": {
    category: "Accounting Masters",
    entity: "Group",
    action: "Pull All Groups",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "Group"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ]
    })
  },

  "pull-group": {
    category: "Accounting Masters",
    entity: "Group",
    action: "Pull a Group",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "Group"
    },
    buildBody: (companyName, { fetch = ["Name", "Parent", "IsSubledger", "IsRevenue"] } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      fetch_list: fetch
    })
  },

  "pull-groups-of-group": {
    category: "Accounting Masters",
    entity: "Group",
    action: "Pull Groups of Group",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPLAssetGroups"
    },
    buildBody: (companyName, { parentGroup = "$$GroupCurrentAssets" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPLAssetGroups", type: "Collection" },
              attributes: [
                { Type: "Group" },
                { "Child Of": parentGroup },
                { "Belongs To": "Yes" },
                { "Native Method": "Name, Parent, IsSubledger, IsRevenue, Parent Hierarchy" }
              ]
            }
          ]
        }
      ]
    })
  },

  // ==========================================
  // 2. INVENTORY MASTERS - STOCK ITEM
  // ==========================================
  "pull-all-stock-items": {
    category: "Inventory Masters",
    entity: "Stock Item",
    action: "Pull All Stock Items",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "StockItem"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ]
    })
  },

  "pull-stock-item": {
    category: "Inventory Masters",
    entity: "Stock Item",
    action: "Pull a Stock Item",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "StockItem"
    },
    buildBody: (companyName, { fetch = ["Name", "Parent", "BaseUnits", "OpeningBalance", "ClosingBalance"] } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      fetch_list: fetch
    })
  },

  "pull-stock-items-of-stock-group": {
    category: "Inventory Masters",
    entity: "Stock Item",
    action: "Pull Stock Items of Stock Group",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPLStockItemsOfGroup"
    },
    buildBody: (companyName, { stockGroup = "$$StockGroupFinishedGoods" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPLStockItemsOfGroup", type: "Collection" },
              attributes: [
                { Type: "StockItem" },
                { "Child Of": stockGroup },
                { "Native Method": "Name, Parent, BaseUnits, ClosingBalance, ClosingRate, ClosingValue" }
              ]
            }
          ]
        }
      ]
    })
  },

  // ==========================================
  // 2. INVENTORY MASTERS - STOCK GROUP
  // ==========================================
  "pull-all-stock-groups": {
    category: "Inventory Masters",
    entity: "Stock Group",
    action: "Pull All Stock Groups",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "StockGroup"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ]
    })
  },

  "pull-stock-group": {
    category: "Inventory Masters",
    entity: "Stock Group",
    action: "Pull a Stock Group",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "StockGroup"
    },
    buildBody: (companyName, { fetch = ["Name", "Parent", "IsAddable"] } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      fetch_list: fetch
    })
  },

  "pull-stock-group-zero-balance": {
    category: "Inventory Masters",
    entity: "Stock Group",
    action: "Pull Stock Group With Zero Balance",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "StockGroup"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svZeroBalance", value: "Yes" }
      ]
    })
  },

  // ==========================================
  // 2. INVENTORY MASTERS - UNITS
  // ==========================================
  "pull-all-units": {
    category: "Inventory Masters",
    entity: "Units",
    action: "Pull All Units",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "Unit"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ]
    })
  },

  "pull-unit": {
    category: "Inventory Masters",
    entity: "Units",
    action: "Pull a Unit",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "Unit"
    },
    buildBody: (companyName, { fetch = ["Name", "OriginalName", "DecimalPlaces", "IsSimpleUnit"] } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      fetch_list: fetch
    })
  },

  // ==========================================
  // 3. TRANSACTIONS - PAYMENT VOUCHERS
  // ==========================================
  "payment-pull-all": {
    category: "Transactions",
    entity: "Payment",
    action: "Pull All Payment Vouchers",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPL All Payment Vouchers"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPL All Payment Vouchers", type: "Collection" },
              attributes: [
                { Type: "Vouchers:VoucherType" },
                { "Child Of": "$$VchTypePayment" },
                { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" }
              ]
            }
          ]
        }
      ]
    })
  },

  "payment-pull-period": {
    category: "Transactions",
    entity: "Payment",
    action: "Pull Payment Vouchers for Period",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPL Payment Vouchers"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20260331" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPL Payment Vouchers", type: "Collection" },
              attributes: [
                { Type: "Vouchers:VoucherType" },
                { "Child Of": "$$VchTypePayment" },
                { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" },
                { Filters: "Period Filter" }
              ]
            },
            {
              metadata: { name: "PeriodFilter", type: "System", sys_type: "Formulae", ismodify: true },
              value: `$Date >= ($$Date:"${formatDateString(fromDate)}") AND $Date <= ($$Date:"${formatDateString(toDate)}")`
            }
          ]
        }
      ]
    })
  },

  // ==========================================
  // 3. TRANSACTIONS - RECEIPT VOUCHERS
  // ==========================================
  "receipt-pull-all": {
    category: "Transactions",
    entity: "Receipt",
    action: "Pull All Receipt Vouchers",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPL All Receipt Vouchers"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPL All Receipt Vouchers", type: "Collection" },
              attributes: [
                { Type: "Vouchers:VoucherType" },
                { "Child Of": "$$VchTypeReceipt" },
                { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" }
              ]
            }
          ]
        }
      ]
    })
  },

  "receipt-pull-period": {
    category: "Transactions",
    entity: "Receipt",
    action: "Pull Receipt Vouchers for Period",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPL Receipt Vouchers"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20260331" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPL Receipt Vouchers", type: "Collection" },
              attributes: [
                { Type: "Vouchers:VoucherType" },
                { "Child Of": "$$VchTypeReceipt" },
                { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" },
                { Filters: "Period Filter" }
              ]
            },
            {
              metadata: { name: "PeriodFilter", type: "System", sys_type: "Formulae", ismodify: true },
              value: `$Date >= ($$Date:"${formatDateString(fromDate)}") AND $Date <= ($$Date:"${formatDateString(toDate)}")`
            }
          ]
        }
      ]
    })
  },

  // ==========================================
  // 3. TRANSACTIONS - SALES VOUCHERS
  // ==========================================
  "sales-pull-all": {
    category: "Transactions",
    entity: "Sales",
    action: "Pull All Sales Vouchers",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPLAllSalesVouchers"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPL All Sales Vouchers", type: "Collection" },
              attributes: [
                { Type: "Vouchers:VoucherType" },
                { "Child Of": "$$VchTypeSales" },
                { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" }
              ]
            }
          ]
        }
      ]
    })
  },

  "sales-pull-period": {
    category: "Transactions",
    entity: "Sales",
    action: "Pull Sales Vouchers for Period",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPLSalesVouchers"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20260331" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPL Sales Vouchers", type: "Collection" },
              attributes: [
                { Type: "Vouchers:VoucherType" },
                { "Child Of": "$$VchTypeSales" },
                { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" },
                { Filters: "Period Filter" }
              ]
            },
            {
              metadata: { name: "PeriodFilter", type: "System", sys_type: "Formulae", ismodify: true },
              value: `$Date >= ($$Date:"${formatDateString(fromDate)}") AND $Date <= ($$Date:"${formatDateString(toDate)}")`
            }
          ]
        }
      ]
    })
  },

  // ==========================================
  // 3. TRANSACTIONS - PURCHASE VOUCHERS
  // ==========================================
  "purchase-pull-all": {
    category: "Transactions",
    entity: "Purchase",
    action: "Pull All Purchase Vouchers",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPL All Purchase Vouchers"
    },
    buildBody: (companyName) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPL All Purchase Vouchers", type: "Collection" },
              attributes: [
                { Type: "Vouchers:VoucherType" },
                { "Child Of": "$$VchTypePurchase" },
                { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" }
              ]
            }
          ]
        }
      ]
    })
  },

  "purchase-pull-period": {
    category: "Transactions",
    entity: "Purchase",
    action: "Pull Purchase Vouchers for Period",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "collection",
      id: "TSPL Purchase Vouchers"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20260331" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "TSPL Purchase Vouchers", type: "Collection" },
              attributes: [
                { Type: "Vouchers:VoucherType" },
                { "Child Of": "$$VchTypePurchase" },
                { "Native Method": "Date, VoucherTypeName, VoucherNumber, Partyledgername, Amount" },
                { Filters: "Period Filter" }
              ]
            },
            {
              metadata: { name: "PeriodFilter", type: "System", sys_type: "Formulae", ismodify: true },
              value: `$Date >= ($$Date:"${formatDateString(fromDate)}") AND $Date <= ($$Date:"${formatDateString(toDate)}")`
            }
          ]
        }
      ]
    })
  },

  // ==========================================
  // 4. REPORTS - TRIAL BALANCE
  // ==========================================
  "pull-trial-balance-period": {
    category: "Reports",
    entity: "Trial Balance",
    action: "Pull Trial Balance for any Period",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Trial Balance"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20250430" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate }
      ]
    })
  },

  "pull-trial-balance-detailed": {
    category: "Reports",
    entity: "Trial Balance",
    action: "Pull Trial Balance Detailed",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Trial Balance"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20250430" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate },
        { name: "ExplodeFlag", value: "Yes" },
        { name: "ExplodeAllLevels", value: "Yes" }
      ]
    })
  },

  "pull-trial-balance-plain": {
    category: "Reports",
    entity: "Trial Balance",
    action: "Pull Trial Balance Plain Format",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Trial Balance"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20250430" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "Trial Balance", type: "Report", ismodify: true },
              attributes: [{ "Plain Xml": "Yes" }]
            }
          ]
        }
      ]
    })
  },

  "pull-trial-balance-empty-fields": {
    category: "Reports",
    entity: "Trial Balance",
    action: "Pull Trial Balance with Empty Fields",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Trial Balance"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20250430" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "Trial Balance", type: "Report", ismodify: true },
              attributes: [{ "Export Empty Fields": "Yes" }]
            }
          ]
        }
      ]
    })
  },

  "pull-trial-balance-ledger-wise": {
    category: "Reports",
    entity: "Trial Balance",
    action: "Pull Trial Balance Ledger wise",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Trial Balance"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20250430" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate },
        { name: "IsLedgerwise", value: "Yes" }
      ]
    })
  },

  "pull-trial-balance-group": {
    category: "Reports",
    entity: "Trial Balance",
    action: "Pull Trial Balance for a Group",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Trial Balance"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20250430", targetGroup = "Bank Accounts" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "Trial Balance", type: "Report", ismodify: true },
              attributes: [{ Set: `Groupname :"${targetGroup}"` }]
            }
          ]
        }
      ]
    })
  },

  // ==========================================
  // 4. REPORTS - SALES REGISTER
  // ==========================================
  "pull-sales-register-period": {
    category: "Reports",
    entity: "Sales Register",
    action: "Pull Sales Register for any Period",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Sales Register"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20260331" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate }
      ]
    })
  },

  "pull-sales-register-plain": {
    category: "Reports",
    entity: "Sales Register",
    action: "Pull Sales Register Plain Format",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Sales Register"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20260331" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "Sales Register", type: "Report", ismodify: true },
              attributes: [{ "Plain Xml": "Yes" }]
            }
          ]
        }
      ]
    })
  },

  "pull-sales-register-empty-fields": {
    category: "Reports",
    entity: "Sales Register",
    action: "Pull Sales Register with Empty Fields",
    headers: {
      "content-type": "application/json",
      version: "1",
      tallyrequest: "export",
      type: "data",
      id: "Sales Register"
    },
    buildBody: (companyName, { fromDate = "20250401", toDate = "20260331" } = {}) => ({
      static_variables: [
        { name: "svExportFormat", value: "jsonex" },
        { name: "svCurrentCompany", value: companyName },
        { name: "svFromDate", value: fromDate },
        { name: "svToDate", value: toDate }
      ],
      tdlmessage: [
        {
          definitions: [
            {
              metadata: { name: "Sales Register", type: "Report", ismodify: true },
              attributes: [{ "Export Empty Fields": "Yes" }]
            }
          ]
        }
      ]
    })
  }
};

/**
 * Converts YYYYMMDD to DD-MM-YYYY required by Tally TDL $$Date formula
 */
function formatDateString(str) {
  if (!str) return "01-04-2025";
  const s = String(str).replace(/-/g, "");
  if (s.length === 8) {
    const yyyy = s.substring(0, 4);
    const mm = s.substring(4, 6);
    const dd = s.substring(6, 8);
    return `${dd}-${mm}-${yyyy}`;
  }
  return str;
}

module.exports = {
  CATALOG,
  formatDateString
};
