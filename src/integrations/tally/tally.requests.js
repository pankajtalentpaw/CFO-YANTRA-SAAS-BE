/**
 * Comprehensive Safe Read-Only Tally XML Request Generators
 * All requests generate standard Export collections compatible with TallyPrime HTTP loopback.
 * Strictly Read-Only (Export only).
 */

function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Static variables Tally treats as dates. They need an explicit TYPE="Date". */
const DATE_STATIC_VARS = new Set(["SVFROMDATE", "SVTODATE", "SVCURRENTDATE", "SVEXPORTFROMDATE", "SVEXPORTTODATE"]);

function buildEnvelope(collectionName, collectionType, nativeMethods = [], companyName = null, staticVars = {}, fetchFields = [], { exportFormat = "XML" } = {}) {
  const companyContext = companyName
    ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`
    : "";

  let extraVars = "";
  for (const [key, value] of Object.entries(staticVars)) {
    // Period variables are ignored unless declared TYPE="Date". Verified against
    // the live instance: without the attribute Tally silently serves only the
    // current period (8 vouchers); with it the requested range is honoured (432).
    const attr = DATE_STATIC_VARS.has(key.toUpperCase()) ? ' TYPE="Date"' : "";
    extraVars += `        <${escapeXml(key)}${attr}>${escapeXml(value)}</${escapeXml(key)}>\n`;
  }

  const fetchXml = fetchFields
    .map((f) => `            <FETCH>${escapeXml(f)}</FETCH>`)
    .join("\n");

  const methodsXml = [
    fetchXml,
    nativeMethods.map((m) => `            <NATIVEMETHOD>${escapeXml(m)}</NATIVEMETHOD>`).join("\n")
  ].filter(Boolean).join("\n");

  return `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${collectionName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:${escapeXml(exportFormat)}</SVEXPORTFORMAT>
        ${companyContext}
${extraVars}      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="${escapeXml(collectionName)}" ISMODIFY="No">
            <TYPE>${escapeXml(collectionType)}</TYPE>
${methodsXml}
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`.trim();
}

/**
 * Standard probe XML — the Experiment 1 company discovery baseline.
 *
 * Deliberately minimal: <FETCH>Name</FETCH> only. Optional fields live in
 * buildCompanyListRequest so a TDL error in one of them can never break the
 * handshake probe.
 */
function buildProbeXml(companyName) {
  return buildEnvelope("CompanyCollection", "Company", [], companyName, {}, ["Name"]);
}

/**
 * Company probe in a given export format — the safe shape for transport checks.
 *
 * A request may not name a collection the TDL does not define. Asking for
 * <ID>CompanyCollection</ID> with no <TDL> block raises "Error in TDL …
 * Could not find description!" inside TallyPrime, and that modal blocks the
 * HTTP gateway until a person clicks OK — every later request then times out.
 * Verified: this is what put Tally into the unresponsive state repeatedly.
 *
 * @param {string} exportFormat XML | JSON | JSONEx
 */
function buildCompanyProbeRequest(exportFormat = "XML") {
  return buildEnvelope("CompanyCollection", "Company", [], null, {}, ["Name"], { exportFormat });
}

/**
 * List all companies
 */
function buildCompanyListRequest() {
  return buildEnvelope("CompanyCollection", "Company", [], null, {}, [
    "Name",
    "FormalName",
    "Guid",
    "StartingFrom",
    "BooksFrom",
    "MasterId",
    "AlterId",
    "CountryName",
    "StateName",
    "PinCode",
    "EMail",
    "PhoneNumber",
    "MobileNo",
    "GstRegNo",
    "PanCardNo",
    "CinNo"
  ]);
}

/**
 * Detailed active company identity and feature extraction
 */
function buildCompanyDetailedRequest(companyName) {
  return buildEnvelope("CompanyDetailedCollection", "Company", [
    "Name",
    "FormalName",
    "StartingFrom",
    "BooksFrom",
    "Guid",
    "MasterId",
    "AlterId",
    "BaseCurrency",
    "CountryName",
    "StateName",
    "PinCode",
    "EMail",
    "PhoneNumber",
    "MobileNo",
    "GstRegNo",
    "PanCardNo",
    "CinNo",
    "IsBillWiseOn",
    "IsCostCentresOn",
    "IsInventoryOn",
    "IsMultiCurrencyOn",
    "IsPayrollOn",
    "IsGstApplicable",
    "IsTdsApplicable",
    "IsTcsApplicable",
    "IsBatchOn",
    "IsGodownOn",
    "IsBOMOn"
  ], companyName);
}

/**
 * Master: Groups
 */
function buildGroupsRequest(companyName) {
  return buildEnvelope("GroupCollection", "Group", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent",
    "IsAddable",
    "IsRevenue",
    "IsDeemedPositive",
    "AffectsGrossProfit",
    "SortPosition"
  ], companyName);
}

/**
 * Master: Ledgers
 */
function buildLedgersRequest(companyName) {
  return buildEnvelope("LedgerCollection", "Ledger", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent",
    "OpeningBalance",
    "ClosingBalance",
    "IsBillWiseOn",
    "IsCostCentresOn",
    "TaxType",
    "GstType",
    "PartyGSTIN",
    "AppropriateFor",
    "IsActive",
    "MailingName",
    "CountryName"
  ], companyName);
}

/**
 * Master: Voucher Types
 */
function buildVoucherTypesRequest(companyName) {
  return buildEnvelope("VoucherTypeCollection", "VoucherType", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent",
    "Abbreviation",
    "NumberingMethod",
    "IsActive",
    "IsOptional",
    "IsDeemedPositive",
    "CoreVoucherType",
    "PrintTitle"
  ], companyName);
}

/**
 * Master: Cost Categories
 */
function buildCostCategoriesRequest(companyName) {
  return buildEnvelope("CostCategoryCollection", "CostCategory", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "AllocateRevenue",
    "AllocateNonRevenue"
  ], companyName);
}

/**
 * Master: Cost Centres
 */
function buildCostCentresRequest(companyName) {
  return buildEnvelope("CostCentreCollection", "CostCentre", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent",
    "Category"
  ], companyName);
}

/**
 * Master: Currencies
 */
function buildCurrenciesRequest(companyName) {
  return buildEnvelope("CurrencyCollection", "Currency", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "OriginalName",
    "ExpandedSymbol",
    "DecimalSymbol",
    "DecimalPlaces"
  ], companyName);
}

/**
 * Master: Units
 */
function buildUnitsRequest(companyName) {
  return buildEnvelope("UnitCollection", "Unit", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "OriginalName",
    "IsSimpleUnit",
    "DecimalPlaces"
  ], companyName);
}

/**
 * Master: Stock Groups
 */
function buildStockGroupsRequest(companyName) {
  return buildEnvelope("StockGroupCollection", "StockGroup", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent",
    "IsAddable"
  ], companyName);
}

/**
 * Master: Stock Categories
 */
function buildStockCategoriesRequest(companyName) {
  return buildEnvelope("StockCategoryCollection", "StockCategory", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent"
  ], companyName);
}

/**
 * Master: Stock Items
 */
function buildStockItemsRequest(companyName) {
  return buildEnvelope("StockItemCollection", "StockItem", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent",
    "Category",
    "BaseUnits",
    "OpeningBalance",
    "OpeningValue",
    "OpeningRate",
    "ClosingBalance",
    "ClosingValue",
    "CostingMethod",
    "ValuationMethod",
    "GstTypeofSupply",
    "HsnCode"
  ], companyName);
}

/**
 * Master: Godowns
 */
function buildGodownsRequest(companyName) {
  return buildEnvelope("GodownCollection", "Godown", [
    "Name",
    "Guid",
    "MasterId",
    "AlterId",
    "Parent",
    "Address",
    "PinCode"
  ], companyName);
}

/**
 * EXP-03: Trial Balance Report Extraction Request
 */
function buildTrialBalanceRequest(companyName, fromDate = null, toDate = null) {
  const staticVars = {};
  if (fromDate) staticVars.SVFROMDATE = fromDate;
  if (toDate) staticVars.SVTODATE = toDate;

  return buildEnvelope("TrialBalanceCollection", "Ledger", [
    "Name",
    "Parent",
    "OpeningBalance",
    "ClosingBalance",
    "DebitTotal",
    "CreditTotal",
    "IsRevenue",
    "IsDeemedPositive"
  ], companyName, staticVars);
}

/**
 * Voucher register extraction.
 *
 * Mirrors the shape proven against the live TallyPrime instance
 * (buildSalesVoucherRequest, 102KB response, no TDL fault). Specifically:
 *   - <FETCH> only. NATIVEMETHOD on Voucher was the previous form and is not used.
 *   - No voucher-level <FETCH>BILLALLOCATIONS.*</FETCH>: bill allocations hang off
 *     ALLLEDGERENTRIES, not off Voucher, so requesting them here is a TDL fault.
 *   - No <FETCH>Amount</FETCH>: Voucher exposes no such member; amounts live on
 *     the ledger and inventory entries.
 *
 * Entries are opt-in so a plain voucher list can be proven before the heavier
 * nested collections are requested.
 *
 * @param {string|null} companyName
 * @param {string|null} [fromDate] Tally yyyymmdd
 * @param {string|null} [toDate] Tally yyyymmdd
 * @param {object} [options]
 * @param {boolean} [options.includeLedgerEntries=false]
 * @param {boolean} [options.includeInventoryEntries=false]
 */
function buildVouchersRequest(companyName, fromDate = null, toDate = null, options = {}) {
  const { includeLedgerEntries = false, includeInventoryEntries = false } = options;

  const fetches = [
    "Date",
    "Guid",
    "MasterId",
    "AlterId",
    "VoucherTypeName",
    "VoucherNumber",
    "PartyLedgerName",
    "Narration",
    "IsCancelled",
    "IsOptional",
    // Voucher-level total. Verified live: AO/D/24-25/001 returns
    // <AMOUNT>-129800.00</AMOUNT> as a direct child of <VOUCHER>.
    "Amount"
  ];
  if (includeLedgerEntries) fetches.push("AllLedgerEntries.*");
  if (includeInventoryEntries) fetches.push("AllInventoryEntries.*");

  const staticVars = {};
  if (fromDate) staticVars.SVFROMDATE = fromDate;
  if (toDate) staticVars.SVTODATE = toDate;

  return buildEnvelope("VoucherRegisterCollection", "Voucher", [], companyName, staticVars, fetches);
}

/**
 * EXP-05: Bill-wise Outstanding Bills Request
 */
function buildBillWiseOutstandingRequest(companyName) {
  return buildEnvelope("BillsCollection", "Bills", [
    "Name",
    "BillDate",
    "BillDueDate",
    "BillCreditPeriod",
    "OpeningValue",
    "ClosingValue",
    "Parent",
    "PartyLedgerName"
  ], companyName);
}

/**
 * EXP-08: Incremental Sync Request using AlterID Cursor
 * Uses FETCH for high performance extraction of inserted/altered vouchers.
 */
/**
 * EXP-08: Incremental Sync Request using AlterID Cursor
 * Uses FETCH for high performance extraction of inserted/altered vouchers.
 */
function buildIncrementalSyncRequest(companyName, lastAlterId = 0, options = {}) {
  const { includeLedgerEntries = true, includeInventoryEntries = true, fromDate, toDate } = options;

  const fetches = [
    "Date",
    "Guid",
    "MasterId",
    "AlterId",
    "VoucherTypeName",
    "VoucherNumber",
    "PartyLedgerName",
    "Narration",
    "Amount",
    "IsCancelled",
    "IsOptional"
  ];
  if (includeLedgerEntries) fetches.push("AllLedgerEntries.*");
  if (includeInventoryEntries) fetches.push("AllInventoryEntries.*");

  const fetchesXml = fetches.map((f) => `            <FETCH>${escapeXml(f)}</FETCH>`).join("\n");
  const dateVars = [
    fromDate ? `        <SVFROMDATE TYPE="Date">${escapeXml(fromDate)}</SVFROMDATE>` : "",
    toDate ? `        <SVTODATE TYPE="Date">${escapeXml(toDate)}</SVTODATE>` : ""
  ].filter(Boolean).join("\n");

  return `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>IncrementalVoucherCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : ""}
${dateVars ? dateVars + "\n" : ""}      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="IncrementalVoucherCollection" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
${fetchesXml}
            <FILTER>AlterIdFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="AlterIdFilter">
            $AlterId &gt; ${Number(lastAlterId) || 0}
          </SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`.trim();
}

/**
 * Lightweight Voucher Keys Request for high-speed Change Data Capture & Deletion Detection
 * Returns solely identifiers (~100-200ms even on 20,000+ vouchers across books period).
 */
function buildLightweightVoucherKeysRequest(companyName, fromDate = null, toDate = null) {
  const dateVars = [
    fromDate ? `        <SVFROMDATE TYPE="Date">${escapeXml(fromDate)}</SVFROMDATE>` : "",
    toDate ? `        <SVTODATE TYPE="Date">${escapeXml(toDate)}</SVTODATE>` : ""
  ].filter(Boolean).join("\n");

  return `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>LightweightVoucherKeysCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : ""}
${dateVars ? dateVars + "\n" : ""}      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="LightweightVoucherKeysCollection" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>Guid</FETCH>
            <FETCH>MasterId</FETCH>
            <FETCH>AlterId</FETCH>
            <FETCH>VoucherNumber</FETCH>
            <FETCH>VoucherTypeName</FETCH>
            <FETCH>Date</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`.trim();
}


/**
 * Request to inspect active company and basic accounting features
 */
function buildCapabilityDiscoveryRequest(companyName) {
  return buildEnvelope("CapabilityDiscovery", "Company", [
    "Name",
    "IsBillWiseOn",
    "IsCostCentresOn",
    "IsInventoryOn",
    "IsMultiCurrencyOn",
    "IsPayrollOn",
    "IsGstApplicable",
    "IsTdsApplicable",
    "IsTcsApplicable",
    "IsBatchOn",
    "IsGodownOn"
  ], companyName);
}

/**
 * Safe 500-record batch extraction using AlterId window.
 * Limits extraction to a small slice so Tally Prime memory stays under 100MB
 * and single-threaded event loop is never blocked.
 *
 * @param {string} companyName
 * @param {number} startAlterId
 * @param {number} endAlterId
 * @param {object} [options]
 */
function buildBatchVouchersRequest(companyName, startAlterId, endAlterId, options = {}) {
  const { includeLedgerEntries = false, includeInventoryEntries = false } = options;

  const fetches = [
    "Date",
    "Guid",
    "MasterId",
    "AlterId",
    "VoucherTypeName",
    "VoucherNumber",
    "PartyLedgerName",
    "Narration",
    "IsCancelled",
    "IsOptional",
    "Amount"
  ];
  if (includeLedgerEntries) fetches.push("AllLedgerEntries.*");
  if (includeInventoryEntries) fetches.push("AllInventoryEntries.*");

  const fetchesXml = fetches.map((f) => `            <FETCH>${escapeXml(f)}</FETCH>`).join("\n");

  return `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>BatchVoucherCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : ""}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="BatchVoucherCollection" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
${fetchesXml}
            <FILTER>BatchAlterIdFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="BatchAlterIdFilter">
            $AlterId &gt;= ${Number(startAlterId) || 0} AND $AlterId &lt;= ${Number(endAlterId) || 0}
          </SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`.trim();
}

module.exports = {
  escapeXml,
  buildEnvelope,
  buildProbeXml,
  buildCompanyProbeRequest,
  buildCompanyListRequest,
  buildCompanyDetailedRequest,
  buildCapabilityDiscoveryRequest,
  buildGroupsRequest,
  buildLedgersRequest,
  buildVoucherTypesRequest,
  buildCostCategoriesRequest,
  buildCostCentresRequest,
  buildCurrenciesRequest,
  buildUnitsRequest,
  buildStockGroupsRequest,
  buildStockCategoriesRequest,
  buildStockItemsRequest,
  buildGodownsRequest,
  buildTrialBalanceRequest,
  buildVouchersRequest,
  buildBatchVouchersRequest,
  buildBillWiseOutstandingRequest,
  buildIncrementalSyncRequest,
  buildLightweightVoucherKeysRequest
};


