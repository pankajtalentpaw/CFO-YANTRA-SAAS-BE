const { buildFactSales, deriveMonth } = require("../src/integrations/tally/sales/factSales.builder");
const { normalizeSalesVoucher, buildRowId } = require("../src/integrations/tally/sales/salesVoucher.canonical");
const { parseCity } = require("../src/integrations/tally/sales/city.parser");
const { reconcileFactSales, RECONCILIATION_STATUS, buildDataReadiness, deriveSalesControlTotal } = require("../src/integrations/tally/sales/factSales.reconcile");
const { CLASSIFICATION_SOURCES } = require("../src/integrations/tally/sales/customerClassification");
const { DATA_QUALITY_REASONS, ingestionError, classifyTransportFailure, INGESTION_ERROR_CODES } = require("../src/integrations/tally/sales/factSales.errors");
const { normalizeCanonicalLedger } = require("../src/integrations/tally/canonical/accounting.canonical");
const { normalizeCanonicalStockItem, normalizeCanonicalStockGroup } = require("../src/integrations/tally/canonical/inventory.canonical");
const { parseTallyResponse } = require("../src/integrations/tally/tally.parser");
const { validateReadOnlyXml } = require("../src/integrations/tally/tally.readonly");
const salesRequests = require("../src/integrations/tally/sales/sales.requests");

const COMPANY_A = "guid-company-a";
const COMPANY_B = "guid-company-b";

/** A two-item sales invoice as Tally returns it. */
function rawSalesVoucher(overrides = {}) {
  return {
    GUID: "vch-1001",
    VOUCHERNUMBER: "1001",
    VOUCHERTYPENAME: "Sales",
    DATE: "20230715",
    PARTYLEDGERNAME: "Acme Traders",
    "ALLLEDGERENTRIES.LIST": [
      {
        LEDGERNAME: "Acme Traders",
        AMOUNT: "15000",
        "CATEGORYALLOCATIONS.LIST": [
          {
            CATEGORY: "Salesman",
            "COSTCENTREALLOCATIONS.LIST": [{ NAME: "Ravi Kumar", AMOUNT: "15000" }]
          }
        ]
      }
    ],
    "ALLINVENTORYENTRIES.LIST": [
      { STOCKITEMNAME: "Product A", BILLEDQTY: "10 Nos", RATE: "1000/Nos", AMOUNT: "-10000" },
      { STOCKITEMNAME: "Product B", BILLEDQTY: "5 Nos", RATE: "1000/Nos", AMOUNT: "-5000" }
    ],
    ...overrides
  };
}

function ledger(companyId, name, extra = {}) {
  return normalizeCanonicalLedger(
    { NAME: name, GUID: `led-${name}`, PARENT: "Sundry Debtors", ...extra },
    { sourceCompanyId: companyId }
  );
}

function stockItem(companyId, name, parent) {
  return normalizeCanonicalStockItem({ NAME: name, GUID: `si-${name}`, PARENT: parent }, { sourceCompanyId: companyId });
}

function stockGroup(companyId, name) {
  return normalizeCanonicalStockGroup({ NAME: name, GUID: `sg-${name}` }, { sourceCompanyId: companyId });
}

function baseInput(overrides = {}) {
  return {
    companyId: COMPANY_A,
    salesVouchers: [normalizeSalesVoucher(rawSalesVoucher(), { companyId: COMPANY_A })],
    ledgers: [
      ledger(COMPANY_A, "Acme Traders", {
        "ADDRESS.LIST": ["12 MG Road", "Andheri East", "Mumbai - 400001"],
        LEDSTATENAME: "Maharashtra"
      })
    ],
    stockItems: [stockItem(COMPANY_A, "Product A", "Electronics"), stockItem(COMPANY_A, "Product B", "Electronics")],
    stockGroups: [stockGroup(COMPANY_A, "Electronics")],
    costCentres: [{ sourceCompanyId: COMPANY_A, sourceObjectId: "cc-1", name: "Ravi Kumar" }],
    classifications: [],
    ...overrides
  };
}

describe("Sales voucher and inventory entry parsing", () => {
  test("parses a sales voucher header from real Tally field names", () => {
    const voucher = normalizeSalesVoucher(rawSalesVoucher(), { companyId: COMPANY_A });
    expect(voucher.voucherType).toBe("Sales");
    expect(voucher.sourceVoucherNumber).toBe("1001");
    expect(voucher.voucherDate).toBe("2023-07-15");
    expect(voucher.partyLedgerName).toBe("Acme Traders");
    expect(voucher.companyId).toBe(COMPANY_A);
  });

  test("parses every inventory entry with its own identity", () => {
    const voucher = normalizeSalesVoucher(rawSalesVoucher(), { companyId: COMPANY_A });
    expect(voucher.inventoryEntries).toHaveLength(2);
    expect(voucher.inventoryEntries[0].stockItemName).toBe("Product A");
    expect(voucher.inventoryEntries[0].amount).toBe("10000.00");
    expect(voucher.inventoryEntries[0].quantity).toBe(10);
    expect(voucher.inventoryEntries[0].unit).toBe("Nos");
    // Credit sign is preserved as a flag, not baked into the amount.
    expect(voucher.inventoryEntries[0].isCredit).toBe(true);
    const ids = voucher.inventoryEntries.map((e) => e.sourceInventoryEntryId);
    expect(new Set(ids).size).toBe(2);
  });

  test("the same stock item twice on one invoice stays two entries", () => {
    const raw = rawSalesVoucher({
      "ALLINVENTORYENTRIES.LIST": [
        { STOCKITEMNAME: "Product A", AMOUNT: "-1000" },
        { STOCKITEMNAME: "Product A", AMOUNT: "-2000" }
      ]
    });
    const voucher = normalizeSalesVoucher(raw, { companyId: COMPANY_A });
    expect(voucher.inventoryEntries).toHaveLength(2);
    expect(new Set(voucher.inventoryEntries.map((e) => e.sourceInventoryEntryId)).size).toBe(2);
  });

  test("parses cost centre allocations from the ledger entry", () => {
    const voucher = normalizeSalesVoucher(rawSalesVoucher(), { companyId: COMPANY_A });
    expect(voucher.ledgerEntries[0].costCentreAllocations[0]).toMatchObject({
      costCategory: "Salesman",
      costCentreName: "Ravi Kumar"
    });
  });

  test("reads quantity and unit from the typed nodes a live Tally sends", () => {
    // Verified against TallyPrime: BILLEDQTY arrives as a typed node, not a
    // bare string. Flattening it is what keeps quantity from coming back null.
    const raw = rawSalesVoucher({
      "ALLINVENTORYENTRIES.LIST": [
        {
          STOCKITEMNAME: { "#text": "Ele.Motor Vibrator 3Ph", "@_TYPE": "String" },
          BILLEDQTY: { "#text": "2 Nos", "@_TYPE": "Quantity" },
          ACTUALQTY: { "#text": "2 Nos", "@_TYPE": "Quantity" },
          RATE: { "#text": "10900.00/Nos", "@_TYPE": "Rate" },
          AMOUNT: { "#text": "-21800.00", "@_TYPE": "Amount" }
        }
      ]
    });
    const entry = normalizeSalesVoucher(raw, { companyId: COMPANY_A }).inventoryEntries[0];
    expect(entry.stockItemName).toBe("Ele.Motor Vibrator 3Ph");
    expect(entry.quantity).toBe(2);
    expect(entry.unit).toBe("Nos");
    expect(entry.amount).toBe("21800.00");
  });

  test("takes the unit from the rate when the line carries no quantity", () => {
    const raw = rawSalesVoucher({
      "ALLINVENTORYENTRIES.LIST": [{ STOCKITEMNAME: "Product A", RATE: "1000.00/Kg", AMOUNT: "-1000" }]
    });
    const entry = normalizeSalesVoucher(raw, { companyId: COMPANY_A }).inventoryEntries[0];
    expect(entry.quantity).toBeNull();
    expect(entry.unit).toBe("Kg");
  });

  test("a fractional quantity keeps its precision and unit", () => {
    const raw = rawSalesVoucher({
      "ALLINVENTORYENTRIES.LIST": [{ STOCKITEMNAME: "Product A", BILLEDQTY: "-2.5 Kg", AMOUNT: "1000" }]
    });
    const entry = normalizeSalesVoucher(raw, { companyId: COMPANY_A }).inventoryEntries[0];
    expect(entry.quantity).toBe(-2.5);
    expect(entry.unit).toBe("Kg");
  });

  test("a cancelled voucher is recognised through Tally's typed logical node", () => {
    // Verified live: ISCANCELLED arrives as { "#text": "Yes", "@_TYPE":
    // "Logical" }. Read as a bare string it was always false, which let a
    // cancelled invoice count as revenue.
    const cancelled = normalizeSalesVoucher(
      rawSalesVoucher({ ISCANCELLED: { "#text": "Yes", "@_TYPE": "Logical" } }),
      { companyId: COMPANY_A }
    );
    expect(cancelled.isCancelled).toBe(true);

    const live = normalizeSalesVoucher(
      rawSalesVoucher({ ISCANCELLED: { "#text": "No", "@_TYPE": "Logical" } }),
      { companyId: COMPANY_A }
    );
    expect(live.isCancelled).toBe(false);
  });

  test("a voucher with no inventory entries yields an empty list, not an error", () => {
    const voucher = normalizeSalesVoucher(rawSalesVoucher({ "ALLINVENTORYENTRIES.LIST": [] }), { companyId: COMPANY_A });
    expect(voucher.inventoryEntries).toEqual([]);
  });
});

describe("FACT_SALES grain and amounts", () => {
  test("one row per inventory entry — never a collapsed voucher total", () => {
    const { rows, stats } = buildFactSales(baseInput());
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.SalesAmount).sort()).toEqual(["10000.00", "5000.00"]);
    // The 15,000 voucher total must NOT appear as a single row.
    expect(rows.some((r) => r.SalesAmount === "15000.00")).toBe(false);
    expect(stats.totalSalesAmount).toBe("15000.00");
  });

  test("Month and MonthNum come from the voucher date", () => {
    const { rows } = buildFactSales(baseInput());
    expect(rows[0].Month).toBe("July");
    expect(rows[0].MonthNum).toBe(7);
    expect(deriveMonth("2024-01-31")).toEqual({ month: "January", monthNum: 1 });
    expect(deriveMonth(null)).toEqual({ month: null, monthNum: null });
  });

  test("Customer is the raw party ledger name", () => {
    const { rows } = buildFactSales(baseInput());
    expect(rows.every((r) => r.Customer === "Acme Traders")).toBe(true);
  });

  test("Category resolves via stock item parent, SubCategory is the stock item", () => {
    const { rows } = buildFactSales(baseInput());
    expect(rows[0].Category).toBe("Electronics");
    expect(rows.map((r) => r.SubCategory).sort()).toEqual(["Product A", "Product B"]);
  });

  test("State comes from LEDSTATENAME and City from the address", () => {
    const { rows } = buildFactSales(baseInput());
    expect(rows[0].State).toBe("Maharashtra");
    expect(rows[0].City).toBe("Mumbai");
    expect(rows[0]._meta.cityConfidence).toBe("high");
    expect(rows[0]._meta.rawAddress).toContain("MG Road");
  });

  test("Salesman resolves from the cost centre allocation", () => {
    const { rows } = buildFactSales(baseInput());
    expect(rows[0].Salesman).toBe("Ravi Kumar");
    expect(rows[0]._meta.dataQuality).not.toContain(DATA_QUALITY_REASONS.SALESMAN_UNAVAILABLE);
  });

  test("RowID is internal, deterministic and stable across runs", () => {
    const first = buildFactSales(baseInput()).rows.map((r) => r.RowID);
    const second = buildFactSales(baseInput()).rows.map((r) => r.RowID);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
    expect(first[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  test("re-ingesting the same voucher cannot produce duplicate rows", () => {
    const voucher = normalizeSalesVoucher(rawSalesVoucher(), { companyId: COMPANY_A });
    const { rows, rejected } = buildFactSales(baseInput({ salesVouchers: [voucher, voucher] }));
    expect(rows).toHaveLength(2);
    expect(rejected.filter((r) => r.reason === "DUPLICATE_ROW_ID")).toHaveLength(2);
  });

  test("RowID differs across companies for identical voucher data", () => {
    expect(buildRowId(COMPANY_A, "v1", "v1#INV1")).not.toBe(buildRowId(COMPANY_B, "v1", "v1#INV1"));
  });
});

describe("Company isolation", () => {
  test("vouchers from another company are never included", () => {
    const foreign = normalizeSalesVoucher(rawSalesVoucher(), { companyId: COMPANY_B });
    const { rows } = buildFactSales(baseInput({
      salesVouchers: [normalizeSalesVoucher(rawSalesVoucher(), { companyId: COMPANY_A }), foreign]
    }));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r._meta.companyId === COMPANY_A)).toBe(true);
  });

  test("masters from another company never satisfy a join", () => {
    const { rows } = buildFactSales(baseInput({
      ledgers: [ledger(COMPANY_B, "Acme Traders", { LEDSTATENAME: "Karnataka" })],
      stockItems: [stockItem(COMPANY_B, "Product A", "Electronics")]
    }));
    expect(rows[0].State).toBeNull();
    expect(rows[0].Category).toBeNull();
    expect(rows[0]._meta.dataQuality).toContain(DATA_QUALITY_REASONS.LEDGER_NOT_FOUND);
    expect(rows[0]._meta.dataQuality).toContain(DATA_QUALITY_REASONS.STOCK_ITEM_NOT_FOUND);
  });

  test("classifications are company-scoped", () => {
    const led = baseInput().ledgers[0];
    const { rows } = buildFactSales(baseInput({
      classifications: [{
        companyId: COMPANY_B, ledgerId: led.sourceObjectId,
        tier: "Gold", customerType: "Distributor", source: CLASSIFICATION_SOURCES.MANUAL
      }]
    }));
    expect(rows[0].Tier).toBeNull();
  });

  test("two companies produce separate, non-overlapping datasets", () => {
    const a = buildFactSales(baseInput());
    const b = buildFactSales({
      companyId: COMPANY_B,
      salesVouchers: [normalizeSalesVoucher(rawSalesVoucher(), { companyId: COMPANY_B })],
      ledgers: [ledger(COMPANY_B, "Acme Traders", { LEDSTATENAME: "Karnataka" })],
      stockItems: [stockItem(COMPANY_B, "Product A", "Hardware"), stockItem(COMPANY_B, "Product B", "Hardware")],
      stockGroups: [stockGroup(COMPANY_B, "Hardware")]
    });
    expect(a.rows[0].State).toBe("Maharashtra");
    expect(b.rows[0].State).toBe("Karnataka");
    expect(b.rows[0].Category).toBe("Hardware");
    const overlap = a.rows.map((r) => r.RowID).filter((id) => b.rows.some((r) => r.RowID === id));
    expect(overlap).toHaveLength(0);
  });
});

describe("Missing data is recorded, never fabricated", () => {
  test("no cost centres configured leaves Salesman null with a reason", () => {
    const raw = rawSalesVoucher({
      "ALLLEDGERENTRIES.LIST": [{ LEDGERNAME: "Acme Traders", AMOUNT: "15000" }]
    });
    const { rows } = buildFactSales(baseInput({
      salesVouchers: [normalizeSalesVoucher(raw, { companyId: COMPANY_A })],
      costCentres: [],
      costCentresEnabled: false
    }));
    expect(rows[0].Salesman).toBeNull();
    expect(rows[0]._meta.dataQuality).toContain(DATA_QUALITY_REASONS.SALESMAN_UNAVAILABLE);
  });

  test("Tier and CustomerType are null when no classification exists", () => {
    const { rows } = buildFactSales(baseInput());
    expect(rows[0].Tier).toBeNull();
    expect(rows[0].CustomerType).toBeNull();
    expect(rows[0]._meta.dataQuality).toEqual(
      expect.arrayContaining([
        DATA_QUALITY_REASONS.TIER_NOT_CONFIGURED,
        DATA_QUALITY_REASONS.CUSTOMER_TYPE_NOT_CONFIGURED
      ])
    );
  });

  test("a configured classification populates Tier and records its source", () => {
    const led = baseInput().ledgers[0];
    const { rows } = buildFactSales(baseInput({
      classifications: [{
        companyId: COMPANY_A, ledgerId: led.sourceObjectId,
        tier: "Gold", customerType: "Distributor",
        source: CLASSIFICATION_SOURCES.EXTERNAL_MASTER, confidence: "high"
      }]
    }));
    expect(rows[0].Tier).toBe("Gold");
    expect(rows[0].CustomerType).toBe("Distributor");
    expect(rows[0]._meta.classificationSource).toBe("external_master");
  });

  test("a classification with an unrecognized source is ignored", () => {
    const led = baseInput().ledgers[0];
    const { rows } = buildFactSales(baseInput({
      classifications: [{ companyId: COMPANY_A, ledgerId: led.sourceObjectId, tier: "Gold", source: "guessed" }]
    }));
    expect(rows[0].Tier).toBeNull();
  });

  test("missing ledger leaves City and State null with reasons", () => {
    const { rows } = buildFactSales(baseInput({ ledgers: [] }));
    expect(rows[0].City).toBeNull();
    expect(rows[0].State).toBeNull();
    expect(rows[0].Customer).toBe("Acme Traders");
    expect(rows[0]._meta.dataQuality).toContain(DATA_QUALITY_REASONS.LEDGER_NOT_FOUND);
  });

  test("missing stock item leaves Category null but keeps the raw item name", () => {
    const { rows } = buildFactSales(baseInput({ stockItems: [], stockGroups: [] }));
    expect(rows[0].Category).toBeNull();
    expect(rows[0].SubCategory).toBe("Product A");
    expect(rows[0]._meta.dataQuality).toContain(DATA_QUALITY_REASONS.STOCK_ITEM_NOT_FOUND);
  });

  test("partial master data still produces rows for what resolved", () => {
    const { rows } = buildFactSales(baseInput({ stockItems: [stockItem(COMPANY_A, "Product A", "Electronics")] }));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.SubCategory === "Product A").Category).toBe("Electronics");
    expect(rows.find((r) => r.SubCategory === "Product B").Category).toBeNull();
  });

  test("service invoices (no inventory entries) are parsed into service fact rows", () => {
    // Tally returns <ALLINVENTORYENTRIES.LIST> empty for service sales (accounting invoices).
    const raw = rawSalesVoucher({ "ALLINVENTORYENTRIES.LIST": "   ", "LEDGERENTRIES.LIST": [
      { LEDGERNAME: "Service Customer", AMOUNT: "-590000.00" }
    ], "ALLLEDGERENTRIES.LIST": undefined });
    const voucher = normalizeSalesVoucher(raw, { companyId: COMPANY_A });
    expect(voucher.ledgerEntries).toHaveLength(1);
    const { rows, rejected } = buildFactSales(baseInput({ salesVouchers: [voucher] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].Category).toBe("Service");
    expect(rows[0].SalesAmount).toBe("590000.00");
    expect(rejected).toHaveLength(0);
  });

  test("cancelled vouchers are rejected, not silently counted", () => {
    const raw = rawSalesVoucher({ ISCANCELLED: "Yes" });
    const { rows, rejected } = buildFactSales(baseInput({
      salesVouchers: [normalizeSalesVoucher(raw, { companyId: COMPANY_A })]
    }));
    expect(rows).toHaveLength(0);
    expect(rejected[0].reason).toBe("VOUCHER_CANCELLED_OR_OPTIONAL");
  });
});

describe("City parser", () => {
  test("high confidence when a PIN code anchors the city line", () => {
    expect(parseCity(["12 MG Road", "Mumbai - 400001"])).toMatchObject({ city: "Mumbai", confidence: "high" });
  });

  test("falls back to the last city-shaped line", () => {
    expect(parseCity(["Plot 5", "Pune"])).toMatchObject({ city: "Pune", confidence: "medium" });
  });

  test("skips the state line when LEDSTATENAME is known", () => {
    const result = parseCity(["Sector 18", "Noida", "Uttar Pradesh 201301"], { knownState: "Uttar Pradesh" });
    expect(result.city).toBe("Noida");
  });

  test("returns null rather than guessing", () => {
    expect(parseCity(["India"]).city).toBeNull();
    expect(parseCity([])).toMatchObject({ city: null, reason: "ADDRESS_EMPTY" });
    expect(parseCity(["PO Box 1234"]).city).toBeNull();
  });

  // Shapes observed in the live TallyPrime instance during implementation.
  test.each([
    [["PLOT NO 1. GAT NO 1/1 TO 1/7", "VILLAGE SANGVI, SHIRWAL, KHANDALA", "SATARA"], "Maharashtra", "SATARA"],
    [["PLOT NO 490/1 URLA INDUSTRIAL AREA, RAIPUR,", "CHHATTISGARH, INDIA"], "Chhattisgarh", "RAIPUR"],
    [["INDUSTRIAL DEVELOPMENT AREA, PLOT NO 35", "IDA. KATTEDAN, RANGAREDDY"], "Telangana", "RANGAREDDY"]
  ])("parses real Tally address %#", (lines, state, expected) => {
    expect(parseCity(lines, { knownState: state }).city).toBe(expected);
  });

  test("steps over state and country segments on one line", () => {
    expect(parseCity(["Andheri", "Mumbai, Maharashtra, India"], { knownState: "Maharashtra" }).city).toBe("Mumbai");
  });

  test("always preserves the raw address", () => {
    expect(parseCity(["Unit 9", "Somewhere"]).rawAddress).toBe("Unit 9, Somewhere");
  });
});

describe("Ledger master address and state extraction", () => {
  test("extracts typed ADDRESS.LIST nodes and LEDSTATENAME", () => {
    // Exactly the shape TallyPrime returns: every line is a typed node.
    const raw = {
      "@_NAME": "AJAY INDUSTRIAL CORPORATION LIMITED",
      GUID: { "#text": "led-guid-1", "@_TYPE": "String" },
      PARENT: { "#text": "Sundry Debtors", "@_TYPE": "String" },
      LEDSTATENAME: { "#text": "Maharashtra", "@_TYPE": "String" },
      CLOSINGBALANCE: { "#text": "-125000.00", "@_TYPE": "Amount" },
      "ADDRESS.LIST": {
        "@_TYPE": "String",
        ADDRESS: [
          { "#text": "PLOT NO 1. GAT NO 1/1 TO 1/7", "@_TYPE": "String" },
          { "#text": "SATARA", "@_TYPE": "String" }
        ]
      }
    };
    const led = normalizeCanonicalLedger(raw, { sourceCompanyId: COMPANY_A });
    expect(led.name).toBe("AJAY INDUSTRIAL CORPORATION LIMITED");
    expect(led.parent).toBe("Sundry Debtors");
    expect(led.address.stateName).toBe("Maharashtra");
    expect(led.address.lines).toEqual(["PLOT NO 1. GAT NO 1/1 TO 1/7", "SATARA"]);
    expect(led.closingBalance.amount).toBe("125000.00");
    expect(JSON.stringify(led)).not.toContain("[object Object]");
  });

  test("closingBalance is null when Tally did not return it", () => {
    const led = normalizeCanonicalLedger({ NAME: "No Balance Ltd", PARENT: "Sales Accounts" }, { sourceCompanyId: COMPANY_A });
    expect(led.closingBalance).toBeNull();
  });
});

describe("Reconciliation", () => {
  const rows = [{ SalesAmount: "10000.00" }, { SalesAmount: "5000.00" }];

  test("matching totals reconcile", () => {
    const result = reconcileFactSales({ companyId: COMPANY_A, rows, controlTotal: "15000.00" });
    expect(result.status).toBe(RECONCILIATION_STATUS.RECONCILED);
    expect(result.reconciled).toBe(true);
    expect(result.difference).toBe("0.00");
  });

  test("a material difference is not marked reconciled", () => {
    const result = reconcileFactSales({ companyId: COMPANY_A, rows, controlTotal: "20000.00" });
    expect(result.status).toBe(RECONCILIATION_STATUS.MATERIAL_DIFFERENCE);
    expect(result.reconciled).toBe(false);
    expect(result.difference).toBe("-5000.00");
  });

  test("rounding noise is within tolerance", () => {
    const result = reconcileFactSales({ companyId: COMPANY_A, rows, controlTotal: "15000.01" });
    expect(result.status).toBe(RECONCILIATION_STATUS.WITHIN_TOLERANCE);
    expect(result.reconciled).toBe(true);
  });

  test("ledgers without a closing balance yield no control total, not zero", () => {
    const ledgers = [normalizeCanonicalLedger({ NAME: "Sales Accounts", PARENT: "Sales Accounts" }, { sourceCompanyId: COMPANY_A })];
    expect(deriveSalesControlTotal(ledgers, COMPANY_A)).toBeNull();
  });

  test("an empty dataset cannot reconcile against a real control total", () => {
    const ledgers = [normalizeCanonicalLedger(
      { NAME: "Service Sales", PARENT: "Sales Accounts", CLOSINGBALANCE: "-1537150.32" },
      { sourceCompanyId: COMPANY_A }
    )];
    const controlTotal = deriveSalesControlTotal(ledgers, COMPANY_A);
    expect(controlTotal).toBe("1537150.32");
    const result = reconcileFactSales({ companyId: COMPANY_A, rows: [], controlTotal });
    expect(result.status).toBe(RECONCILIATION_STATUS.MATERIAL_DIFFERENCE);
    expect(result.reconciled).toBe(false);
  });

  test("an unavailable control total is never reported as reconciled", () => {
    const result = reconcileFactSales({ companyId: COMPANY_A, rows, controlTotal: null });
    expect(result.status).toBe(RECONCILIATION_STATUS.CONTROL_TOTAL_UNAVAILABLE);
    expect(result.reconciled).toBe(false);
    expect(result.expected).toBeNull();
  });

  test("data readiness reports per-field coverage", () => {
    const { rows: factRows } = buildFactSales(baseInput());
    const readiness = buildDataReadiness(factRows);
    expect(readiness.rowCount).toBe(2);
    expect(readiness.coverage.SalesAmount.percent).toBe(100);
    expect(readiness.coverage.Tier.percent).toBe(0);
    expect(readiness.dataQualityReasons[DATA_QUALITY_REASONS.TIER_NOT_CONFIGURED]).toBe(2);
  });
});

describe("Extraction safety and errors", () => {
  test("every sales extraction request is read-only Export", () => {
    for (const build of Object.values(salesRequests)) {
      const xml = build("Demo Co", { fromDate: "20230401", toDate: "20240331" });
      expect(validateReadOnlyXml(xml).allowed).toBe(true);
      expect(xml).toContain("<TALLYREQUEST>Export</TALLYREQUEST>");
      expect(xml).toContain('ISMODIFY="No"');
      expect(xml).not.toMatch(/<TALLYREQUEST>\s*(Import|Alter|Delete)/i);
    }
  });

  test("the sales voucher request fetches inventory entries", () => {
    const xml = salesRequests.buildSalesVoucherRequest("Demo Co");
    expect(xml).toContain("<FETCH>AllInventoryEntries.*</FETCH>");
    expect(xml).toContain("<TYPE>Voucher</TYPE>");
  });

  test("malformed sales XML is reported, not partially ingested", () => {
    const parsed = parseTallyResponse("<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>");
    expect(parsed.success).toBe(false);
    expect(parsed.isMalformedXml).toBe(true);
  });

  test("a Tally timeout maps to a retryable TALLY_TIMEOUT", () => {
    const code = classifyTransportFailure({ errorMessage: "timeout of 10000ms exceeded" });
    expect(code).toBe(INGESTION_ERROR_CODES.TALLY_TIMEOUT);
    const error = ingestionError(code, { companyId: COMPANY_A, source: "salesVoucher", stage: "extract", message: "timed out" });
    expect(error).toMatchObject({
      failureCode: "TALLY_TIMEOUT", companyId: COMPANY_A, source: "salesVoucher", stage: "extract", retryable: true
    });
  });

  test("a parse failure is not retryable", () => {
    const error = ingestionError(INGESTION_ERROR_CODES.TALLY_XML_PARSE_ERROR, { companyId: COMPANY_A });
    expect(error.retryable).toBe(false);
  });
});
