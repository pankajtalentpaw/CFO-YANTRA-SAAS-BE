jest.mock("../src/integrations/tally/transports/xml.transport", () => ({ sendXmlRequest: jest.fn() }));

const { sendXmlRequest } = require("../src/integrations/tally/transports/xml.transport");
const { buildVouchersRequest } = require("../src/integrations/tally/tally.requests");
const { validateReadOnlyXml } = require("../src/integrations/tally/tally.readonly");
const { parseTallyResponse } = require("../src/integrations/tally/tally.parser");
const { normalizeSalesVoucher } = require("../src/integrations/tally/sales/salesVoucher.canonical");
const { classifyTransportFailure, isTdlError, ingestionError, INGESTION_ERROR_CODES } = require("../src/integrations/tally/sales/factSales.errors");
const { resolveCompany, invalidate } = require("../src/services/companyScope.service");
const service = require("../src/services/companyData.service");

const GUID_A = "guid-aqua-1111";
const GUID_B = "guid-plastao-2222";

function transportOk(collectionXml) {
  const raw = `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>${collectionXml}</COLLECTION></DATA></BODY></ENVELOPE>`;
  return { success: true, statusCode: 200, responseTimeMs: 7, rawResponse: raw, parsedResponse: parseTallyResponse(raw) };
}

const COMPANIES_XML = `
  <COMPANY NAME="AQUA OVERSEAS"><NAME>AQUA OVERSEAS</NAME><GUID>${GUID_A}</GUID></COMPANY>
  <COMPANY NAME="PLASTAO CONSULTANCY LLP"><NAME>PLASTAO CONSULTANCY LLP</NAME><GUID>${GUID_B}</GUID></COMPANY>`;

/** Voucher shape observed live: attributes plus typed child nodes. */
const VOUCHERS_A_XML = `
  <VOUCHER VCHTYPE="Sales">
    <DATE TYPE="Date">20260412</DATE>
    <GUID>vch-a-1</GUID>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <VOUCHERNUMBER>AQ/26-27/001</VOUCHERNUMBER>
    <PARTYLEDGERNAME TYPE="String">Alpha Customer</PARTYLEDGERNAME>
    <ISCANCELLED TYPE="Logical">No</ISCANCELLED>
  </VOUCHER>`;

const VOUCHERS_B_XML = `
  <VOUCHER VCHTYPE="Purchase">
    <DATE TYPE="Date">20260520</DATE>
    <GUID>vch-b-1</GUID>
    <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
    <VOUCHERNUMBER>PCL/26-27/009</VOUCHERNUMBER>
    <PARTYLEDGERNAME TYPE="String">Beta Supplier</PARTYLEDGERNAME>
    <ISCANCELLED TYPE="Logical">No</ISCANCELLED>
  </VOUCHER>`;

beforeEach(() => { sendXmlRequest.mockReset(); invalidate(); });

describe("Voucher request shape", () => {
  const minimal = buildVouchersRequest("Demo Co");

  test("is read-only Export with a resolvable collection", () => {
    expect(validateReadOnlyXml(minimal).allowed).toBe(true);
    expect(minimal).toContain("<TALLYREQUEST>Export</TALLYREQUEST>");
    expect(minimal).toContain('ISMODIFY="No"');
    expect(minimal).toContain("<TYPE>Voucher</TYPE>");
    // HEADER.ID must match the defined COLLECTION NAME.
    const id = minimal.match(/<ID>([^<]+)<\/ID>/)[1];
    expect(minimal).toContain(`<COLLECTION NAME="${id}"`);
  });

  test("uses FETCH, never NATIVEMETHOD on Voucher", () => {
    expect(minimal).toContain("<FETCH>VoucherNumber</FETCH>");
    expect(minimal).not.toContain("<NATIVEMETHOD>");
  });

  test("never requests voucher-level BILLALLOCATIONS", () => {
    // Bill allocations live under ALLLEDGERENTRIES; asking at voucher level is a TDL fault.
    for (const xml of [minimal, buildVouchersRequest("Demo Co", null, null, { includeLedgerEntries: true, includeInventoryEntries: true })]) {
      expect(xml).not.toMatch(/<FETCH>\s*BILLALLOCATIONS/i);
    }
  });

  test("requests the voucher-level Amount", () => {
    // Verified live: <FETCH>Amount</FETCH> returns <AMOUNT>-129800.00</AMOUNT>
    // as a direct child of <VOUCHER> (AO/D/24-25/001 = 110000 goods + 19800 tax).
    expect(minimal).toContain("<FETCH>Amount</FETCH>");
  });

  test("nested entries are opt-in, not part of the default list query", () => {
    expect(minimal).not.toContain("AllInventoryEntries");
    expect(minimal).not.toContain("AllLedgerEntries");

    const full = buildVouchersRequest("Demo Co", null, null, { includeLedgerEntries: true, includeInventoryEntries: true });
    expect(full).toContain("<FETCH>AllLedgerEntries.*</FETCH>");
    expect(full).toContain("<FETCH>AllInventoryEntries.*</FETCH>");
  });

  test("carries the company context and date range when given", () => {
    const ranged = buildVouchersRequest("Demo Co", "20260401", "20270331");
    expect(ranged).toContain("<SVCURRENTCOMPANY>Demo Co</SVCURRENTCOMPANY>");
    expect(ranged).toContain('<SVFROMDATE TYPE="Date">20260401</SVFROMDATE>');
    expect(ranged).toContain('<SVTODATE TYPE="Date">20270331</SVTODATE>');
  });

  test('period variables MUST carry TYPE="Date" or Tally ignores the range', () => {
    // Verified live: without the attribute Tally serves only the current period
    // (8 vouchers); with it the requested range is honoured (432).
    const ranged = buildVouchersRequest("Demo Co", "20230401", "20260331");
    expect(ranged).not.toMatch(/<SVFROMDATE>/);
    expect(ranged).not.toMatch(/<SVTODATE>/);
    expect(ranged).toMatch(/<SVFROMDATE TYPE="Date">/);
    expect(ranged).toMatch(/<SVTODATE TYPE="Date">/);
  });

  test("non-date static variables keep no TYPE attribute", () => {
    const { buildEnvelope } = require("../src/integrations/tally/tally.requests");
    const xml = buildEnvelope("C", "Ledger", [], "Demo Co", { SVFROMDATE: "20230401", SVSOMETHINGELSE: "x" }, ["Name"]);
    expect(xml).toContain('<SVFROMDATE TYPE="Date">20230401</SVFROMDATE>');
    expect(xml).toContain("<SVSOMETHINGELSE>x</SVSOMETHINGELSE>");
  });

  test("escapes a company name containing XML metacharacters", () => {
    expect(buildVouchersRequest('A & B <Ltd>')).toContain("A &amp; B &lt;Ltd&gt;");
  });
});

describe("TDL error classification", () => {
  test("recognizes TDL faults in a message or a response body", () => {
    expect(isTdlError("Error in TDL. Could not find description!")).toBe(true);
    expect(isTdlError("Unknown method 'Amount'")).toBe(true);
    expect(isTdlError("timeout of 10000ms exceeded")).toBe(false);
    expect(isTdlError(null)).toBe(false);
  });

  test("a TDL fault is never reported as a timeout", () => {
    const code = classifyTransportFailure({ errorMessage: "Error in TDL. 'Collection:X' Could not find description!" });
    expect(code).toBe(INGESTION_ERROR_CODES.TALLY_TDL_ERROR);
    expect(code).not.toBe(INGESTION_ERROR_CODES.TALLY_TIMEOUT);
  });

  test("a TDL fault in the body wins over a timeout message", () => {
    // A TDL modal also makes Tally stop responding, so the body is authoritative.
    expect(classifyTransportFailure({
      errorMessage: "timeout of 10000ms exceeded",
      rawResponse: "<ENVELOPE><LINEERROR>Error in TDL</LINEERROR></ENVELOPE>"
    })).toBe(INGESTION_ERROR_CODES.TALLY_TDL_ERROR);
  });

  test("a genuine timeout is still a retryable timeout", () => {
    const code = classifyTransportFailure({ errorMessage: "timeout of 10000ms exceeded" });
    expect(code).toBe(INGESTION_ERROR_CODES.TALLY_TIMEOUT);
    expect(ingestionError(code, {}).retryable).toBe(true);
  });

  test("a TDL fault is not retryable — it is a request bug", () => {
    expect(ingestionError(INGESTION_ERROR_CODES.TALLY_TDL_ERROR, {}).retryable).toBe(false);
  });
});

describe("Voucher parsing", () => {
  test("parses a minimal voucher without entries", () => {
    const parsed = parseTallyResponse(`<ENVELOPE><BODY><DATA><COLLECTION>${VOUCHERS_A_XML}</COLLECTION></DATA></BODY></ENVELOPE>`);
    const voucher = normalizeSalesVoucher(parsed.collection[0], { companyId: GUID_A });
    expect(voucher.voucherType).toBe("Sales");
    expect(voucher.sourceVoucherNumber).toBe("AQ/26-27/001");
    expect(voucher.voucherDate).toBe("2026-04-12");
    expect(voucher.partyLedgerName).toBe("Alpha Customer");
    expect(voucher.isCancelled).toBe(false);
    expect(voucher.ledgerEntries).toEqual([]);
    expect(voucher.inventoryEntries).toEqual([]);
  });

  test("no field ever serializes as [object Object]", () => {
    const parsed = parseTallyResponse(`<ENVELOPE><BODY><DATA><COLLECTION>${VOUCHERS_A_XML}</COLLECTION></DATA></BODY></ENVELOPE>`);
    const voucher = normalizeSalesVoucher(parsed.collection[0], { companyId: GUID_A });
    expect(JSON.stringify(voucher)).not.toContain("[object Object]");
    for (const key of ["voucherType", "sourceVoucherNumber", "voucherDate", "partyLedgerName"]) {
      expect(typeof voucher[key]).toBe("string");
    }
  });

  test("reads the voucher-level amount and keeps its direction", () => {
    const xml = `<ENVELOPE><BODY><DATA><COLLECTION>
      <VOUCHER>
        <DATE TYPE="Date">20240405</DATE><GUID>v-amt</GUID>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>AO/D/24-25/001</VOUCHERNUMBER>
        <AMOUNT TYPE="Amount">-129800.00</AMOUNT>
        <ALLLEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><AMOUNT>-129800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
      </VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>`;
    const voucher = normalizeSalesVoucher(parseTallyResponse(xml).collection[0], { companyId: GUID_A });
    expect(voucher.amount).toBe("129800.00");
    expect(voucher.amountIsCredit).toBe(true);
  });

  test("amount is null when Tally returned none, never zero", () => {
    const parsed = parseTallyResponse(`<ENVELOPE><BODY><DATA><COLLECTION>${VOUCHERS_A_XML}</COLLECTION></DATA></BODY></ENVELOPE>`);
    const voucher = normalizeSalesVoucher(parsed.collection[0], { companyId: GUID_A });
    expect(voucher.amount).toBeNull();
    expect(voucher.amountIsCredit).toBeNull();
  });

  test("a nested entry amount is not mistaken for the voucher total", () => {
    const xml = `<ENVELOPE><BODY><DATA><COLLECTION>
      <VOUCHER>
        <DATE TYPE="Date">20240405</DATE><GUID>v-nested</GUID>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>N1</VOUCHERNUMBER>
        <ALLLEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><AMOUNT>-5000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
      </VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>`;
    const voucher = normalizeSalesVoucher(parseTallyResponse(xml).collection[0], { companyId: GUID_A });
    expect(voucher.amount).toBeNull();
    expect(voucher.ledgerEntries[0].amount).toBe("5000.00");
  });

  test("malformed voucher XML is rejected, not partially ingested", () => {
    const parsed = parseTallyResponse("<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><DATE>x</COLLECTION></DATA></BODY></ENVELOPE>");
    expect(parsed.success).toBe(false);
    expect(parsed.isMalformedXml).toBe(true);
  });
});

describe("Company-scoped voucher retrieval", () => {
  test("both real company identities resolve and return their own vouchers", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("AQUA OVERSEAS")) return Promise.resolve(transportOk(VOUCHERS_A_XML));
      if (xml.includes("PLASTAO")) return Promise.resolve(transportOk(VOUCHERS_B_XML));
      return Promise.resolve(transportOk(""));
    });

    const a = await resolveCompany(GUID_A);
    const b = await resolveCompany(GUID_B);
    expect(a.ok && b.ok).toBe(true);

    const vouchersA = await service.getVouchers(a.company, {});
    const vouchersB = await service.getVouchers(b.company, {});

    expect(vouchersA.records.map((v) => v.sourceVoucherNumber)).toEqual(["AQ/26-27/001"]);
    expect(vouchersB.records.map((v) => v.sourceVoucherNumber)).toEqual(["PCL/26-27/009"]);
    expect(vouchersA.records.every((v) => v.companyId === GUID_A)).toBe(true);
    expect(vouchersB.records.every((v) => v.companyId === GUID_B)).toBe(true);
  });

  test("company A vouchers never leak into company B", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("AQUA OVERSEAS")) return Promise.resolve(transportOk(VOUCHERS_A_XML));
      return Promise.resolve(transportOk(VOUCHERS_B_XML));
    });
    const a = await resolveCompany(GUID_A);
    await service.getVouchers(a.company, {});
    const b = await resolveCompany(GUID_B);
    const vouchersB = await service.getVouchers(b.company, {});
    expect(vouchersB.records.map((v) => v.sourceVoucherNumber)).not.toContain("AQ/26-27/001");
  });

  test("light and full voucher queries use separate cache entries", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      return Promise.resolve(transportOk(VOUCHERS_A_XML));
    });
    const a = await resolveCompany(GUID_A);
    await service.getVouchers(a.company, {});
    const callsAfterLight = sendXmlRequest.mock.calls.length;
    await service.getVouchers(a.company, { includeEntries: true });
    // A different shape must hit Tally again rather than reuse the light result.
    expect(sendXmlRequest.mock.calls.length).toBeGreaterThan(callsAfterLight);
  });

  test("date range is part of the voucher cache key", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      return Promise.resolve(transportOk(VOUCHERS_A_XML));
    });
    const a = await resolveCompany(GUID_A);
    await service.getVouchers(a.company, { fromDate: "20260401" });
    const before = sendXmlRequest.mock.calls.length;
    await service.getVouchers(a.company, { fromDate: "20250401" });
    expect(sendXmlRequest.mock.calls.length).toBeGreaterThan(before);
  });

  test("an empty voucher register is available with zero records", async () => {
    sendXmlRequest.mockImplementation(({ xml }) =>
      Promise.resolve(transportOk(xml.includes("<ID>CompanyCollection</ID>") ? COMPANIES_XML : "")));
    const a = await resolveCompany(GUID_A);
    const result = await service.getVouchers(a.company, {});
    expect(result.available).toBe(true);
    expect(result.records).toEqual([]);
  });

  test("a TDL fault surfaces as TALLY_TDL_ERROR and is not cached", async () => {
    let voucherCalls = 0;
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      voucherCalls += 1;
      return voucherCalls === 1
        ? Promise.resolve({ success: false, errorMessage: "Error in TDL. Could not find description!" })
        : Promise.resolve(transportOk(VOUCHERS_A_XML));
    });

    const a = await resolveCompany(GUID_A);
    const failed = await service.getVouchers(a.company, {});
    expect(failed.available).toBe(false);
    expect(failed.reason.failureCode).toBe("TALLY_TDL_ERROR");
    expect(failed.reason.source).toBe("voucherRegister");
    expect(failed.reason.companyId).toBe(GUID_A);

    // The failure must not have been cached.
    const retried = await service.getVouchers(a.company, {});
    expect(retried.available).toBe(true);
  });

  test("a voucher timeout stays a retryable timeout", async () => {
    sendXmlRequest.mockImplementation(({ xml }) =>
      xml.includes("<ID>CompanyCollection</ID>")
        ? Promise.resolve(transportOk(COMPANIES_XML))
        : Promise.resolve({ success: false, errorMessage: "timeout of 10000ms exceeded" }));
    const a = await resolveCompany(GUID_A);
    const result = await service.getVouchers(a.company, {});
    expect(result.reason.failureCode).toBe("TALLY_TIMEOUT");
    expect(result.reason.retryable).toBe(true);
  });
});

describe("Voucher date range enforcement", () => {
  const { getVouchers } = require("../src/controllers/companies.controller");

  /** Minimal Express-ish res double. */
  function makeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    return res;
  }

  const MULTI_MONTH_XML = `
    <VOUCHER><DATE TYPE="Date">20250513</DATE><GUID>v1</GUID><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>R1</VOUCHERNUMBER></VOUCHER>
    <VOUCHER><DATE TYPE="Date">20250523</DATE><GUID>v2</GUID><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>J1</VOUCHERNUMBER></VOUCHER>
    <VOUCHER><DATE TYPE="Date">20250602</DATE><GUID>v3</GUID><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>J2</VOUCHERNUMBER></VOUCHER>`;

  beforeEach(() => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      return Promise.resolve(transportOk(MULTI_MONTH_XML));
    });
  });

  const call = async (query) => {
    const res = makeRes();
    await getVouchers({ params: { companyId: GUID_A }, query, path: "/vouchers" }, res);
    return res;
  };

  test("Tally ignores SVFROMDATE/SVTODATE, so the range is enforced server-side", async () => {
    // Verified live: a May range still returned a June voucher from Tally.
    const res = await call({ fromDate: "20250501", toDate: "20250531" });
    expect(res.body.success).toBe(true);
    expect(res.body.items.map((v) => v.voucherDate)).toEqual(["2025-05-13", "2025-05-23"]);
    expect(res.body.items.map((v) => v.voucherDate)).not.toContain("2025-06-02");
  });

  test("reports the filters it actually applied", async () => {
    const res = await call({ fromDate: "20250501", toDate: "20250531" });
    expect(res.body.appliedFilters).toEqual({ type: null, fromDate: "2025-05-01", toDate: "2025-05-31" });
  });

  test("an open-ended range filters on one bound only", async () => {
    const fromOnly = await call({ fromDate: "20250601" });
    expect(fromOnly.body.items.map((v) => v.voucherDate)).toEqual(["2025-06-02"]);
    const toOnly = await call({ toDate: "20250514" });
    expect(toOnly.body.items.map((v) => v.voucherDate)).toEqual(["2025-05-13"]);
  });

  test("date range and voucher type combine", async () => {
    const res = await call({ fromDate: "20250501", toDate: "20250531", type: "Journal" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].voucherNumber).toBe("J1");
  });

  test("no range returns every voucher", async () => {
    const res = await call({});
    expect(res.body.pagination.total).toBe(3);
  });

  test("a non-yyyymmdd date is rejected with a field-level message", async () => {
    const res = await call({ fromDate: "2025-05-01" });
    expect(res.statusCode).toBe(400);
    expect(res.body.issues[0]).toMatchObject({ path: "fromDate" });
  });
});

describe("Voucher register item lines", () => {
  const { getVouchers, summarizeItems } = require("../src/controllers/companies.controller");

  function makeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    return res;
  }

  // Shaped exactly as TallyPrime returns it: inventory entries ride along with
  // the plain register even though the request never asks for them.
  const ITEM_VOUCHERS_XML = `
    <VOUCHER VCHTYPE="Sales">
      <DATE TYPE="Date">20250513</DATE><GUID>v-sale</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S1</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Alpha Customer</PARTYLEDGERNAME>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME TYPE="String">Volumetric Feeder</STOCKITEMNAME>
        <RATE TYPE="Rate">110000.00/Nos</RATE>
        <BILLEDQTY TYPE="Quantity">1 Nos</BILLEDQTY>
        <ACTUALQTY TYPE="Quantity">1 Nos</ACTUALQTY>
        <AMOUNT TYPE="Amount">-110000.00</AMOUNT>
      </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER VCHTYPE="Purchase">
      <DATE TYPE="Date">20250514</DATE><GUID>v-purchase</GUID>
      <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><VOUCHERNUMBER>P1</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Sonal Motors</PARTYLEDGERNAME>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME TYPE="String">Ele.Motor Vibrator 3Ph</STOCKITEMNAME>
        <RATE TYPE="Rate">10900.00/Nos</RATE>
        <BILLEDQTY TYPE="Quantity">2 Nos</BILLEDQTY>
        <AMOUNT TYPE="Amount">-21800.00</AMOUNT>
      </ALLINVENTORYENTRIES.LIST>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME TYPE="String">Mounting Bracket</STOCKITEMNAME>
        <RATE TYPE="Rate">500.00/Nos</RATE>
        <BILLEDQTY TYPE="Quantity">4 Nos</BILLEDQTY>
        <AMOUNT TYPE="Amount">-2000.00</AMOUNT>
      </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER VCHTYPE="Receipt">
      <DATE TYPE="Date">20250515</DATE><GUID>v-receipt</GUID>
      <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>R1</VOUCHERNUMBER>
    </VOUCHER>`;

  beforeEach(() => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      return Promise.resolve(transportOk(ITEM_VOUCHERS_XML));
    });
  });

  const call = async (query) => {
    const res = makeRes();
    await getVouchers({ params: { companyId: GUID_A }, query, path: "/vouchers" }, res);
    return res;
  };

  test("a sales row names its item and quantity", async () => {
    const res = await call({ type: "Sales" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].items).toEqual([
      { name: "Volumetric Feeder", quantity: 1, unit: "Nos", rate: "110000.00/Nos", amount: "110000.00" }
    ]);
    expect(res.body.items[0].totalQuantity).toBe(1);
    expect(res.body.items[0].quantityUnit).toBe("Nos");
  });

  test("a purchase row carries every line and totals the shared unit", async () => {
    const res = await call({ type: "Purchase" });
    const row = res.body.items[0];
    expect(row.itemNames).toEqual(["Ele.Motor Vibrator 3Ph", "Mounting Bracket"]);
    expect(row.totalQuantity).toBe(6);
    expect(row.quantityUnit).toBe("Nos");
    expect(row.inventoryEntryCount).toBe(2);
  });

  test("item columns are offered only for registers that hold stock lines", async () => {
    expect((await call({ type: "Sales" })).body.hasInventory).toBe(true);
    expect((await call({ type: "Receipt" })).body.hasInventory).toBe(false);
    const receipt = (await call({ type: "Receipt" })).body.items[0];
    expect(receipt.items).toEqual([]);
    expect(receipt.totalQuantity).toBeNull();
  });

  test("search matches on item name, not only party and voucher number", async () => {
    const res = await call({ search: "Mounting Bracket" });
    expect(res.body.items.map((v) => v.voucherNumber)).toEqual(["P1"]);
  });

  test("quantities in different units are listed, never added together", () => {
    const summary = summarizeItems([
      { stockItemName: "Resin", quantity: 5, unit: "Kg", rate: "100/Kg", amount: "500.00" },
      { stockItemName: "Drum", quantity: 2, unit: "Nos", rate: "250/Nos", amount: "500.00" }
    ]);
    expect(summary.totalQuantity).toBeNull();
    expect(summary.quantityUnit).toBeNull();
    expect(summary.itemNames).toEqual(["Resin", "Drum"]);
  });

  test("a line Tally bills without a quantity does not fake one", () => {
    const summary = summarizeItems([{ stockItemName: "Service Charge", quantity: null, unit: null, rate: null, amount: "1000.00" }]);
    expect(summary.totalQuantity).toBeNull();
    expect(summary.items[0].name).toBe("Service Charge");
  });
});
