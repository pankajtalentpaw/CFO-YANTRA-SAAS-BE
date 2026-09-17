/**
 * Verification Script: TallyPrime API Explorer Native JSON Data Fetching
 *
 * Demonstrates:
 * 1. Fetching open companies directly using native JSON collection request.
 * 2. Fetching financial reports (Balance Sheet, Profit & Loss) in native JSON format.
 * 3. Fetching master records (Ledgers) in native JSON format.
 * 4. Normalizing Tally's typed JSON values ({ type: "...", value: "..." }) into canonical JS objects.
 *
 * Usage:
 * node src/scripts/testTallyJsonExtraction.js
 */

const {
  buildJsonReportRequest,
  buildJsonCollectionRequest
} = require("../integrations/tally/requests/jsonRequests.builder");
const { sendTallyJson } = require("../integrations/tally/transports/tallyJson.client");
const {
  parseJsonCollection,
  parseJsonBalanceSheet,
  parseJsonProfitAndLoss
} = require("../integrations/tally/parsers/tallyJson.parser");
const env = require("../config/env");

async function main() {
  console.log("================================================================================");
  console.log("           TALLYPRIME API EXPLORER - NATIVE JSON EXTRACTION TEST                ");
  console.log("================================================================================");
  console.log(`Connecting to Tally at http://${env.tally.host}:${env.tally.port} ...\n`);

  // Step 1: Fetch Companies via JSON Collection
  console.log("▶ 1. Fetching Loaded Companies (Native JSON Collection)...");
  const companyReq = buildJsonCollectionRequest("Company");
  const companyRes = await sendTallyJson({
    headers: companyReq.headers,
    body: companyReq.body,
    timeoutMs: 8000
  });

  if (!companyRes.success) {
    console.error("❌ Failed to fetch companies:", companyRes.errorMessage || companyRes.errorCode);
    console.log("\nNote: Make sure TallyPrime is open and listening on port " + env.tally.port);
    process.exit(1);
  }

  const companies = parseJsonCollection(companyRes.collection, "Company");
  console.log(`✔ Found ${companies.length} company/companies in ${companyRes.responseTimeMs}ms:`);
  companies.forEach((c, idx) => {
    console.log(`   [${idx + 1}] ${c.NAME || c.Name || "Unknown"} (GUID: ${c.GUID || "N/A"})`);
  });

  const targetCompany = companies[0]?.NAME || companies[0]?.Name;
  if (!targetCompany) {
    console.log("\n⚠ No active companies loaded in Tally. Please open a company in TallyPrime.");
    return;
  }

  console.log(`\nUsing active company: "${targetCompany}" for subsequent report extraction.\n`);

  // Step 2: Fetch Balance Sheet via Native JSON Report
  console.log("▶ 2. Fetching Balance Sheet (Native JSON Report)...");
  const bsReq = buildJsonReportRequest("Balance Sheet", { companyName: targetCompany });
  const bsRes = await sendTallyJson({
    headers: bsReq.headers,
    body: bsReq.body,
    timeoutMs: 15000
  });

  if (!bsRes.success) {
    console.warn("⚠ Balance Sheet fetch returned error:", bsRes.errorMessage);
  } else {
    const bsParsed = parseJsonBalanceSheet(bsRes.data);
    console.log(`✔ Balance Sheet received in ${bsRes.responseTimeMs}ms!`);
    console.log(`   Total Liabilities items: ${bsParsed.liabilities.length}`);
    console.log(`   Total Assets items:      ${bsParsed.assets.length}`);
    if (bsParsed.totals.totalLiabilities !== null) {
      console.log(`   Total Liabilities:       ${bsParsed.totals.totalLiabilities}`);
    }
    if (bsParsed.totals.totalAssets !== null) {
      console.log(`   Total Assets:            ${bsParsed.totals.totalAssets}`);
    }
  }

  // Step 3: Fetch Profit & Loss via Native JSON Report
  console.log("\n▶ 3. Fetching Profit & Loss (Native JSON Report)...");
  const plReq = buildJsonReportRequest("Profit & Loss", { companyName: targetCompany });
  const plRes = await sendTallyJson({
    headers: plReq.headers,
    body: plReq.body,
    timeoutMs: 15000
  });

  if (!plRes.success) {
    console.warn("⚠ Profit & Loss fetch returned error:", plRes.errorMessage);
  } else {
    const plParsed = parseJsonProfitAndLoss(plRes.data);
    console.log(`✔ Profit & Loss received in ${plRes.responseTimeMs}ms!`);
    console.log(`   Expenses line items: ${plParsed.expenses.length}`);
    console.log(`   Income line items:   ${plParsed.income.length}`);
    if (plParsed.netProfit !== null) {
      console.log(`   Net Profit / Loss:   ${plParsed.netProfit}`);
    }
  }

  // Step 4: Fetch Ledgers via Native JSON Collection
  console.log("\n▶ 4. Fetching Ledgers Collection (Native JSON)...");
  const ledgerReq = buildJsonCollectionRequest("Ledger", { companyName: targetCompany });
  const ledgerRes = await sendTallyJson({
    headers: ledgerReq.headers,
    body: ledgerReq.body,
    timeoutMs: 15000
  });

  if (!ledgerRes.success) {
    console.warn("⚠ Ledgers fetch returned error:", ledgerRes.errorMessage);
  } else {
    const ledgers = parseJsonCollection(ledgerRes.collection, "Ledger");
    console.log(`✔ Received ${ledgers.length} ledgers in ${ledgerRes.responseTimeMs}ms!`);
    console.log("   First 3 sample ledgers:");
    ledgers.slice(0, 3).forEach((l, i) => {
      console.log(`     [${i + 1}] ${l.NAME || "N/A"} | Group: ${l.PARENT || "N/A"} | Opening: ${l.OPENINGBALANCE || 0}`);
    });
  }

  console.log("\n================================================================================");
  console.log("          NATIVE JSON EXTRACTION COMPLETED SUCCESSFULLY!                        ");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
