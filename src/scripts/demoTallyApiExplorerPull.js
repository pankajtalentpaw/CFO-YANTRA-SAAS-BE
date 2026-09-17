/**
 * Demo Script: Pulling All Data Categories from TallyPrime via API Explorer
 *
 * Covers:
 * 1. Accounting Masters (All Ledgers, Ledger of Group, Groups, Group of Group)
 * 2. Inventory Masters (All Stock Items, Stock Groups, Units)
 * 3. Transactions / Accounting Vouchers (Payment, Receipt, Sales, Purchase)
 * 4. Reports (Trial Balance [Period, Detailed, Ledger-wise, Group], Sales Register)
 *
 * Usage:
 * node src/scripts/demoTallyApiExplorerPull.js
 */

"use strict";

const tallyExplorer = require("../integrations/tally/tallyExplorer.service");
const { sendTallyJson } = require("../integrations/tally/transports/tallyJson.client");
const { buildJsonCollectionRequest } = require("../integrations/tally/requests/jsonRequests.builder");
const { parseJsonCollection } = require("../integrations/tally/parsers/tallyJson.parser");
const env = require("../config/env");

async function run() {
  console.log("================================================================================");
  console.log("       TALLYPRIME API EXPLORER - COMPREHENSIVE DATA PULL RUNNER                 ");
  console.log("================================================================================");
  console.log(`Tally Endpoint: http://${env.tally.host}:${env.tally.port}\n`);

  // Step 0: Find active company
  console.log("Discovering open companies...");
  const compReq = buildJsonCollectionRequest("Company");
  const compRes = await sendTallyJson({
    headers: compReq.headers,
    body: compReq.body,
    timeoutMs: 5000
  });

  let companyName = "Bhrama Enterprises"; // default from API explorer
  if (compRes.success && compRes.collection) {
    const list = parseJsonCollection(compRes.collection, "Company");
    if (list.length > 0 && (list[0].NAME || list[0].Name)) {
      companyName = list[0].NAME || list[0].Name;
      console.log(`✔ Found loaded company in Tally: "${companyName}"\n`);
    }
  } else {
    console.log(`ℹ Using target company: "${companyName}" (as documented in API Explorer sandbox)\n`);
  }

  // Helper printer
  async function testPull(label, fn) {
    process.stdout.write(`▶ ${label.padEnd(55, " ")} `);
    try {
      const res = await fn();
      if (res.success) {
        const count = Array.isArray(res.data) ? `${res.data.length} records` : "OK";
        console.log(`✔ SUCCESS (${count}, ${res.responseTimeMs}ms)`);
      } else {
        console.log(`⚠ ${res.error || "Failed"}`);
      }
    } catch (err) {
      console.log(`❌ ERROR: ${err.message}`);
    }
  }

  console.log("--------------------------------------------------------------------------------");
  console.log(" 1. ACCOUNTING MASTERS");
  console.log("--------------------------------------------------------------------------------");
  await testPull("Pull All Ledgers", () => tallyExplorer.pullAllLedgers(companyName));
  await testPull("Pull a Ledger (with Fetch list)", () => tallyExplorer.pullLedger(companyName));
  await testPull("Pull Ledgers of Group (Bank)", () => tallyExplorer.pullLedgersOfGroup(companyName, "$$GroupBank"));
  await testPull("Pull All Groups", () => tallyExplorer.pullAllGroups(companyName));
  await testPull("Pull Groups of Group (Current Assets)", () => tallyExplorer.pullGroupsOfGroup(companyName, "$$GroupCurrentAssets"));

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" 2. INVENTORY MASTERS");
  console.log("--------------------------------------------------------------------------------");
  await testPull("Pull All Stock Items", () => tallyExplorer.pullAllStockItems(companyName));
  await testPull("Pull Stock Items of Group", () => tallyExplorer.pullStockItemsOfGroup(companyName));
  await testPull("Pull All Stock Groups", () => tallyExplorer.pullAllStockGroups(companyName));
  await testPull("Pull All Units", () => tallyExplorer.pullAllUnits(companyName));

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" 3. TRANSACTIONS / ACCOUNTING VOUCHERS");
  console.log("--------------------------------------------------------------------------------");
  await testPull("Pull All Payment Vouchers", () => tallyExplorer.pullPaymentVouchers(companyName));
  await testPull("Pull Payment Vouchers (Period Filter)", () => tallyExplorer.pullPaymentVouchers(companyName, { fromDate: "20250401", toDate: "20260331" }));
  await testPull("Pull All Receipt Vouchers", () => tallyExplorer.pullReceiptVouchers(companyName));
  await testPull("Pull Receipt Vouchers (Period Filter)", () => tallyExplorer.pullReceiptVouchers(companyName, { fromDate: "20250401", toDate: "20260331" }));
  await testPull("Pull All Sales Vouchers", () => tallyExplorer.pullSalesVouchers(companyName));
  await testPull("Pull Sales Vouchers (Period Filter)", () => tallyExplorer.pullSalesVouchers(companyName, { fromDate: "20250401", toDate: "20260331" }));
  await testPull("Pull All Purchase Vouchers", () => tallyExplorer.pullPurchaseVouchers(companyName));
  await testPull("Pull Purchase Vouchers (Period Filter)", () => tallyExplorer.pullPurchaseVouchers(companyName, { fromDate: "20250401", toDate: "20260331" }));

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" 4. REPORTS");
  console.log("--------------------------------------------------------------------------------");
  await testPull("Pull Trial Balance for Period", () => tallyExplorer.pullTrialBalance(companyName, { fromDate: "20250401", toDate: "20250430" }));
  await testPull("Pull Trial Balance Detailed", () => tallyExplorer.pullTrialBalance(companyName, { detailed: true }));
  await testPull("Pull Trial Balance Ledger-wise", () => tallyExplorer.pullTrialBalance(companyName, { ledgerWise: true }));
  await testPull("Pull Trial Balance for Group (Bank)", () => tallyExplorer.pullTrialBalance(companyName, { group: "Bank Accounts" }));
  await testPull("Pull Sales Register for Period", () => tallyExplorer.pullSalesRegister(companyName, { fromDate: "20250401", toDate: "20260331" }));
  await testPull("Pull Sales Register Plain Format", () => tallyExplorer.pullSalesRegister(companyName, { plainFormat: true }));
  await testPull("Pull Sales Register with Empty Fields", () => tallyExplorer.pullSalesRegister(companyName, { emptyFields: true }));

  console.log("\n================================================================================");
  console.log("                 COMPLETED API EXPLORER PULL RUNNER                             ");
  console.log("================================================================================");
}

run().catch((err) => {
  console.error("Runner failed:", err);
  process.exit(1);
});
