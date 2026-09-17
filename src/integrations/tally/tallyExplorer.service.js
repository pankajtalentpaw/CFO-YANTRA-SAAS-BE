/**
 * TallyPrime API Explorer High-Level Dynamic Extraction Service
 * Executes pure JSON pull requests adhering to the official TallyPrime API Explorer catalog.
 */

"use strict";

const { CATALOG } = require("./catalog/tallyApiExplorer.catalog");
const { sendTallyJson } = require("./transports/tallyJson.client");
const {
  parseJsonCollection,
  parseJsonBalanceSheet,
  parseJsonProfitAndLoss,
  parseJsonTrialBalance
} = require("./parsers/tallyJson.parser");
const env = require("../../config/env");
const { logger } = require("../../utils/logger");

/**
 * Pull any endpoint from the Tally API Explorer catalog by endpoint key.
 *
 * @param {string} endpointKey - e.g. "pull-all-ledger", "sales-pull-period", "pull-trial-balance-detailed"
 * @param {object} [params]
 * @param {string} [params.companyName]
 * @param {object} [params.options] - options passed to catalog request builder
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{ success: boolean, endpoint: string, data: any, raw: any, error?: string }>}
 */
async function pullFromTally(endpointKey, { companyName = null, options = {}, timeoutMs = 15000 } = {}) {
  const endpointDef = CATALOG[endpointKey];
  if (!endpointDef) {
    throw new Error(`Unknown Tally API Explorer endpoint: "${endpointKey}". Available endpoints: ${Object.keys(CATALOG).join(", ")}`);
  }

  const headers = endpointDef.headers;
  const body = endpointDef.buildBody(companyName, options);

  logger.debug({ endpoint: endpointKey, companyName, id: headers.id }, "Executing Tally API Explorer JSON pull");

  const response = await sendTallyJson({
    headers,
    body,
    timeoutMs
  });

  if (!response.success) {
    return {
      success: false,
      endpoint: endpointKey,
      category: endpointDef.category,
      entity: endpointDef.entity,
      action: endpointDef.action,
      data: null,
      error: response.errorMessage || response.errorCode,
      statusCode: response.statusCode,
      responseTimeMs: response.responseTimeMs
    };
  }

  // Parse result according to entity / type
  let parsedData = null;
  if (response.collection) {
    parsedData = parseJsonCollection(response.collection, endpointDef.entity);
  } else if (endpointDef.entity === "Trial Balance" && response.data) {
    parsedData = parseJsonTrialBalance(response.data);
  } else if (response.data) {
    parsedData = response.data;
  }

  return {
    success: true,
    endpoint: endpointKey,
    category: endpointDef.category,
    entity: endpointDef.entity,
    action: endpointDef.action,
    data: parsedData,
    raw: response.data || response.collection,
    responseTimeMs: response.responseTimeMs
  };
}

// =========================================================================
// Category Convenience Methods
// =========================================================================

// 1. Accounting Masters
async function pullAllLedgers(companyName, options = {}) {
  return pullFromTally("pull-all-ledger", { companyName, options });
}

async function pullLedger(companyName, fetchFields = ["Name", "Parent", "Opening Balance", "Closing Balance"]) {
  return pullFromTally("pull-a-ledger", { companyName, options: { fetch: fetchFields } });
}

async function pullLedgersOfGroup(companyName, groupName = "$$GroupBank") {
  return pullFromTally("pull-ledgers-of-group", { companyName, options: { groupName } });
}

async function pullAllGroups(companyName, options = {}) {
  return pullFromTally("pull-all-groups", { companyName, options });
}

async function pullGroupsOfGroup(companyName, parentGroup = "$$GroupCurrentAssets") {
  return pullFromTally("pull-groups-of-group", { companyName, options: { parentGroup } });
}

// 2. Inventory Masters
async function pullAllStockItems(companyName, options = {}) {
  return pullFromTally("pull-all-stock-items", { companyName, options });
}

async function pullStockItemsOfGroup(companyName, stockGroup = "$$StockGroupFinishedGoods") {
  return pullFromTally("pull-stock-items-of-stock-group", { companyName, options: { stockGroup } });
}

async function pullAllStockGroups(companyName, options = {}) {
  return pullFromTally("pull-all-stock-groups", { companyName, options });
}

async function pullAllUnits(companyName, options = {}) {
  return pullFromTally("pull-all-units", { companyName, options });
}

// 3. Transactions / Accounting Vouchers
async function pullPaymentVouchers(companyName, { fromDate, toDate } = {}) {
  const key = fromDate && toDate ? "payment-pull-period" : "payment-pull-all";
  return pullFromTally(key, { companyName, options: { fromDate, toDate } });
}

async function pullReceiptVouchers(companyName, { fromDate, toDate } = {}) {
  const key = fromDate && toDate ? "receipt-pull-period" : "receipt-pull-all";
  return pullFromTally(key, { companyName, options: { fromDate, toDate } });
}

async function pullSalesVouchers(companyName, { fromDate, toDate } = {}) {
  const key = fromDate && toDate ? "sales-pull-period" : "sales-pull-all";
  return pullFromTally(key, { companyName, options: { fromDate, toDate } });
}

async function pullPurchaseVouchers(companyName, { fromDate, toDate } = {}) {
  const key = fromDate && toDate ? "purchase-pull-period" : "purchase-pull-all";
  return pullFromTally(key, { companyName, options: { fromDate, toDate } });
}

// 4. Reports
async function pullTrialBalance(companyName, { fromDate = "20250401", toDate = "20250430", detailed = false, ledgerWise = false, group = null } = {}) {
  let key = "pull-trial-balance-period";
  if (detailed) key = "pull-trial-balance-detailed";
  else if (ledgerWise) key = "pull-trial-balance-ledger-wise";
  else if (group) key = "pull-trial-balance-group";

  return pullFromTally(key, {
    companyName,
    options: { fromDate, toDate, targetGroup: group }
  });
}

async function pullSalesRegister(companyName, { fromDate = "20250401", toDate = "20260331", plainFormat = false, emptyFields = false } = {}) {
  let key = "pull-sales-register-period";
  if (plainFormat) key = "pull-sales-register-plain";
  else if (emptyFields) key = "pull-sales-register-empty-fields";

  return pullFromTally(key, {
    companyName,
    options: { fromDate, toDate }
  });
}

module.exports = {
  CATALOG,
  pullFromTally,
  // Accounting Masters
  pullAllLedgers,
  pullLedger,
  pullLedgersOfGroup,
  pullAllGroups,
  pullGroupsOfGroup,
  // Inventory Masters
  pullAllStockItems,
  pullStockItemsOfGroup,
  pullAllStockGroups,
  pullAllUnits,
  // Transactions
  pullPaymentVouchers,
  pullReceiptVouchers,
  pullSalesVouchers,
  pullPurchaseVouchers,
  // Reports
  pullTrialBalance,
  pullSalesRegister
};
