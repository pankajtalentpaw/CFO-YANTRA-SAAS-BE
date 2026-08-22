/**
 * Read-only extraction requests for the FACT_SALES pipeline.
 *
 * Each builder is a separate, independently retryable Export request. There is
 * deliberately no single "fetch everything" request: one unsupported field must
 * never be able to fail the whole ingestion.
 */

const { escapeXml, buildEnvelope } = require("../tally.requests");

/**
 * Ledger master fields required for Customer, City and State.
 * ADDRESS.LIST and LEDSTATENAME are the only sources for City/State.
 */
function buildSalesLedgerRequest(companyName) {
  return buildEnvelope("SalesLedgerCollection", "Ledger", [], companyName, {}, [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent",
    "LedStateName",
    "Address",
    "PinCode",
    "CountryName",
    "IsCostCentresOn",
    "ClosingBalance"
  ]);
}

/** Stock group master — the source of FACT_SALES.Category. */
function buildSalesStockGroupRequest(companyName) {
  return buildEnvelope("SalesStockGroupCollection", "StockGroup", [], companyName, {}, [
    "Name",
    "Guid",
    "MasterId",
    "Parent"
  ]);
}

/** Stock item master — links an inventory entry to its stock group. */
function buildSalesStockItemRequest(companyName) {
  return buildEnvelope("SalesStockItemCollection", "StockItem", [], companyName, {}, [
    "Name",
    "Guid",
    "MasterId",
    "Parent",
    "Category",
    "BaseUnits"
  ]);
}

/** Cost centre master — the source of Salesman, when cost centres are enabled. */
function buildSalesCostCentreRequest(companyName) {
  return buildEnvelope("SalesCostCentreCollection", "CostCentre", [], companyName, {}, [
    "Name",
    "Guid",
    "MasterId",
    "Parent",
    "Category"
  ]);
}

/**
 * Sales vouchers with their inventory entries and cost centre allocations.
 *
 * FETCH on a child path is how Tally returns nested lists; without these the
 * response carries voucher headers only and item-level FACT_SALES is impossible.
 *
 * @param {string|null} companyName
 * @param {object} [range]
 * @param {string} [range.fromDate] Tally date (yyyymmdd or d-MMM-yyyy)
 * @param {string} [range.toDate]
 */
function buildSalesVoucherRequest(companyName, range = {}) {
  const { fromDate, toDate } = range;
  const staticVars = {};
  if (fromDate) staticVars.SVFROMDATE = fromDate;
  if (toDate) staticVars.SVTODATE = toDate;

  const companyContext = companyName
    ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`
    : "";
  const dateVars = Object.entries(staticVars)
    .map(([k, v]) => `        <${k}>${escapeXml(v)}</${k}>`)
    .join("\n");

  return `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>SalesVoucherCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyContext}
${dateVars}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="SalesVoucherCollection" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FILTER>IsSalesVoucher</FILTER>
            <FETCH>Date</FETCH>
            <FETCH>Guid</FETCH>
            <FETCH>MasterId</FETCH>
            <FETCH>AlterId</FETCH>
            <FETCH>VoucherTypeName</FETCH>
            <FETCH>VoucherNumber</FETCH>
            <FETCH>PartyLedgerName</FETCH>
            <FETCH>IsCancelled</FETCH>
            <FETCH>IsOptional</FETCH>
            <FETCH>AllInventoryEntries.*</FETCH>
            <FETCH>AllLedgerEntries.*</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsSalesVoucher">
            $$IsSales:$VoucherTypeName
          </SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`.trim();
}

/**
 * Sales ledger closing balances — the reconciliation control total.
 * This is a sanity check only; it never sources individual FACT_SALES rows.
 */
function buildSalesControlTotalRequest(companyName, range = {}) {
  const staticVars = {};
  if (range.fromDate) staticVars.SVFROMDATE = range.fromDate;
  if (range.toDate) staticVars.SVTODATE = range.toDate;

  return buildEnvelope("SalesControlTotalCollection", "Ledger", [], companyName, staticVars, [
    "Name",
    "Parent",
    "ClosingBalance"
  ]);
}

module.exports = {
  buildSalesLedgerRequest,
  buildSalesStockGroupRequest,
  buildSalesStockItemRequest,
  buildSalesCostCentreRequest,
  buildSalesVoucherRequest,
  buildSalesControlTotalRequest
};
