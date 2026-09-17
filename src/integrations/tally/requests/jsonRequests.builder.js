/**
 * TallyPrime Native JSON Request Builders
 * Implements the request structures from the TallyPrime API Explorer specification.
 */

"use strict";

/**
 * Build a native JSON request for Tally financial reports (Balance Sheet, P&L, Trial Balance, etc.)
 *
 * @param {string} reportName - e.g. "Balance Sheet", "Profit and Loss", "Trial Balance"
 * @param {string} [companyName] - target company context
 * @param {object} [options]
 * @param {string} [options.fromDate] - YYYYMMDD
 * @param {string} [options.toDate] - YYYYMMDD
 * @returns {{ headers: object, body: object }}
 */
function parseArgs(companyNameOrOptions, maybeOptions = {}) {
  let companyName = null;
  let options = maybeOptions;

  if (typeof companyNameOrOptions === "string") {
    companyName = companyNameOrOptions;
  } else if (companyNameOrOptions && typeof companyNameOrOptions === "object") {
    companyName = companyNameOrOptions.companyName || null;
    options = { ...companyNameOrOptions, ...maybeOptions };
  }

  return { companyName, options };
}

function buildJsonReportRequest(reportName, companyNameOrOptions = null, maybeOptions = {}) {
  const { companyName, options } = parseArgs(companyNameOrOptions, maybeOptions);

  const statVars = {
    SVExportInPlainFormat: "Yes"
  };

  if (companyName) {
    statVars.SVCURRENTCOMPANY = companyName;
  }
  if (options.fromDate) {
    statVars.SVFROMDATE = options.fromDate;
  }
  if (options.toDate) {
    statVars.SVTODATE = options.toDate;
  }
  if (options.vars && typeof options.vars === "object") {
    Object.assign(statVars, options.vars);
  }

  return {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      version: "1",
      tallyrequest: "Export",
      type: "Data",
      id: reportName
    },
    body: {
      stat_vars_list: statVars,
      tdlmessage: {
        report: reportName
      }
    }
  };
}

/**
 * Build a native JSON request for Tally collections (Company, Ledger, Group, StockItem, Voucher, etc.)
 *
 * @param {string} collectionType - e.g. "Company", "Ledger", "Group", "StockItem", "Voucher"
 * @param {string|object} [companyNameOrOptions] - target company context or options object
 * @param {object} [maybeOptions]
 * @returns {{ headers: object, body: object }}
 */
function buildJsonCollectionRequest(collectionType, companyNameOrOptions = null, maybeOptions = {}) {
  const { companyName, options } = parseArgs(companyNameOrOptions, maybeOptions);

  const statVars = {
    SVExportInPlainFormat: "Yes"
  };

  if (companyName) {
    statVars.SVCURRENTCOMPANY = companyName;
  }
  if (options.fromDate) {
    statVars.SVFROMDATE = options.fromDate;
  }
  if (options.toDate) {
    statVars.SVTODATE = options.toDate;
  }
  if (options.vars && typeof options.vars === "object") {
    Object.assign(statVars, options.vars);
  }

  const collectionDef = {
    type: collectionType
  };

  if (Array.isArray(options.fetch) && options.fetch.length > 0) {
    collectionDef.fetch = options.fetch;
  }

  return {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      version: "1",
      tallyrequest: "Export",
      type: "Collection",
      id: collectionType
    },
    body: {
      stat_vars_list: statVars,
      tdlmessage: {
        collection: collectionDef
      }
    }
  };
}

// Shortcuts for standard canonical domains
function buildJsonCompanyRequest() {
  return buildJsonCollectionRequest("Company");
}

function buildJsonLedgerRequest(companyName, options = {}) {
  return buildJsonCollectionRequest("Ledger", companyName, options);
}

function buildJsonGroupRequest(companyName, options = {}) {
  return buildJsonCollectionRequest("Group", companyName, options);
}

function buildJsonStockItemRequest(companyName, options = {}) {
  return buildJsonCollectionRequest("StockItem", companyName, options);
}

function buildJsonVoucherRequest(companyName, options = {}) {
  return buildJsonCollectionRequest("Voucher", companyName, options);
}

function buildJsonBalanceSheetRequest(companyName, options = {}) {
  return buildJsonReportRequest("Balance Sheet", companyName, options);
}

function buildJsonProfitAndLossRequest(companyName, options = {}) {
  return buildJsonReportRequest("Profit and Loss", companyName, options);
}

function buildJsonTrialBalanceRequest(companyName, options = {}) {
  return buildJsonReportRequest("Trial Balance", companyName, options);
}

module.exports = {
  buildJsonReportRequest,
  buildJsonCollectionRequest,
  buildJsonCompanyRequest,
  buildJsonLedgerRequest,
  buildJsonGroupRequest,
  buildJsonStockItemRequest,
  buildJsonVoucherRequest,
  buildJsonBalanceSheetRequest,
  buildJsonProfitAndLossRequest,
  buildJsonTrialBalanceRequest
};
