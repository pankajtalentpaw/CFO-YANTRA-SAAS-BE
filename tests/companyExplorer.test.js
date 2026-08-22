jest.mock("../src/integrations/tally/transports/xml.transport", () => ({ sendXmlRequest: jest.fn() }));

const { sendXmlRequest } = require("../src/integrations/tally/transports/xml.transport");
const { resolveCompany, listCompanies, paginate, invalidate } = require("../src/services/companyScope.service");
const service = require("../src/services/companyData.service");

const COMPANY_A_GUID = "guid-aaa-111";
const COMPANY_B_GUID = "guid-bbb-222";

/** Build a parsed transport result the way xml.transport returns one. */
function transportOk(collectionXml) {
  const { parseTallyResponse } = require("../src/integrations/tally/tally.parser");
  const raw = `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>${collectionXml}</COLLECTION></DATA></BODY></ENVELOPE>`;
  return { success: true, statusCode: 200, responseTimeMs: 5, rawResponse: raw, parsedResponse: parseTallyResponse(raw) };
}

const COMPANIES_XML = `
  <COMPANY NAME="Alpha Traders"><NAME>Alpha Traders</NAME><GUID>${COMPANY_A_GUID}</GUID><STARTINGFROM>20230401</STARTINGFROM></COMPANY>
  <COMPANY NAME="Beta Exports"><NAME>Beta Exports</NAME><GUID>${COMPANY_B_GUID}</GUID><STARTINGFROM>20240401</STARTINGFROM></COMPANY>`;

const LEDGERS_A_XML = `
  <LEDGER NAME="Acme Traders"><GUID TYPE="String">led-a-1</GUID><PARENT TYPE="String">Sundry Debtors</PARENT>
    <LEDSTATENAME TYPE="String">Maharashtra</LEDSTATENAME><CLOSINGBALANCE TYPE="Amount">-5000.00</CLOSINGBALANCE></LEDGER>
  <LEDGER NAME="Zenith Supplies"><GUID TYPE="String">led-a-2</GUID><PARENT TYPE="String">Sundry Creditors</PARENT></LEDGER>
  <LEDGER NAME="Sales Account"><GUID TYPE="String">led-a-3</GUID><PARENT TYPE="String">Sales Accounts</PARENT></LEDGER>`;

const LEDGERS_B_XML = `
  <LEDGER NAME="Beta Only Customer"><GUID TYPE="String">led-b-1</GUID><PARENT TYPE="String">Sundry Debtors</PARENT></LEDGER>`;

beforeEach(() => {
  sendXmlRequest.mockReset();
  invalidate();
});

describe("Company selection and scope", () => {
  test("lists the companies TallyPrime actually returns", async () => {
    sendXmlRequest.mockResolvedValue(transportOk(COMPANIES_XML));
    const result = await listCompanies();
    expect(result.success).toBe(true);
    expect(result.companies.map((c) => c.name)).toEqual(["Alpha Traders", "Beta Exports"]);
    expect(result.companies[0].companyId).toBe(COMPANY_A_GUID);
  });

  test("resolves a valid companyId to its company", async () => {
    sendXmlRequest.mockResolvedValue(transportOk(COMPANIES_XML));
    const scope = await resolveCompany(COMPANY_B_GUID);
    expect(scope.ok).toBe(true);
    expect(scope.company.name).toBe("Beta Exports");
  });

  test("rejects a companyId Tally does not know with 404", async () => {
    sendXmlRequest.mockResolvedValue(transportOk(COMPANIES_XML));
    const scope = await resolveCompany("not-a-real-company");
    expect(scope.ok).toBe(false);
    expect(scope.status).toBe(404);
    expect(scope.error.failureCode).toBe("TALLY_COMPANY_NOT_FOUND");
  });

  test("rejects a missing companyId with 400", async () => {
    const scope = await resolveCompany("");
    expect(scope.ok).toBe(false);
    expect(scope.status).toBe(400);
  });

  test("never resolves a company by display name", async () => {
    sendXmlRequest.mockResolvedValue(transportOk(COMPANIES_XML));
    const scope = await resolveCompany("Alpha Traders");
    expect(scope.ok).toBe(false);
    expect(scope.status).toBe(404);
  });

  test("a Tally timeout during discovery surfaces as a retryable 502", async () => {
    sendXmlRequest.mockResolvedValue({ success: false, errorMessage: "timeout of 10000ms exceeded" });
    const scope = await resolveCompany(COMPANY_A_GUID);
    expect(scope.ok).toBe(false);
    expect(scope.status).toBe(502);
    expect(scope.error.failureCode).toBe("TALLY_TIMEOUT");
    expect(scope.error.retryable).toBe(true);
  });
});

describe("Company isolation across modules", () => {
  test("each company gets only its own ledgers", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("AQUA") || xml.includes("Alpha Traders")) return Promise.resolve(transportOk(LEDGERS_A_XML));
      return Promise.resolve(transportOk(LEDGERS_B_XML));
    });

    const a = await resolveCompany(COMPANY_A_GUID);
    const ledgersA = await service.getDomain(a.company, "ledgers");
    const b = await resolveCompany(COMPANY_B_GUID);
    const ledgersB = await service.getDomain(b.company, "ledgers");

    expect(ledgersA.records.map((l) => l.name)).toContain("Acme Traders");
    expect(ledgersA.records.map((l) => l.name)).not.toContain("Beta Only Customer");
    expect(ledgersB.records.map((l) => l.name)).toEqual(["Beta Only Customer"]);
  });

  test("every extracted record is stamped with its own companyId", async () => {
    sendXmlRequest.mockImplementation(({ xml }) =>
      Promise.resolve(transportOk(xml.includes("<ID>CompanyCollection</ID>") ? COMPANIES_XML : LEDGERS_A_XML)));
    const scope = await resolveCompany(COMPANY_A_GUID);
    const ledgers = await service.getDomain(scope.company, "ledgers");
    expect(ledgers.records.every((l) => l.sourceCompanyId === COMPANY_A_GUID)).toBe(true);
  });

  test("cached data is keyed per company, so one company cannot serve another", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("Alpha Traders")) return Promise.resolve(transportOk(LEDGERS_A_XML));
      return Promise.resolve(transportOk(LEDGERS_B_XML));
    });

    const a = await resolveCompany(COMPANY_A_GUID);
    await service.getDomain(a.company, "ledgers");
    const b = await resolveCompany(COMPANY_B_GUID);
    const ledgersB = await service.getDomain(b.company, "ledgers");

    expect(ledgersB.records).toHaveLength(1);
    expect(ledgersB.records[0].sourceCompanyId).toBe(COMPANY_B_GUID);
  });
});

describe("Ledger and party retrieval", () => {
  beforeEach(() => {
    sendXmlRequest.mockImplementation(({ xml }) =>
      Promise.resolve(transportOk(xml.includes("<ID>CompanyCollection</ID>") ? COMPANIES_XML : LEDGERS_A_XML)));
  });

  test("maps ledger master fields including state and closing balance", async () => {
    const scope = await resolveCompany(COMPANY_A_GUID);
    const { records } = await service.getDomain(scope.company, "ledgers");
    const acme = records.find((l) => l.name === "Acme Traders");
    expect(acme.parent).toBe("Sundry Debtors");
    expect(acme.classification).toBe("SUNDRY_DEBTOR");
    expect(acme.address.stateName).toBe("Maharashtra");
    expect(acme.closingBalance.amount).toBe("5000.00");
  });

  test("splits customers and suppliers by classification", async () => {
    const scope = await resolveCompany(COMPANY_A_GUID);
    const customers = await service.getParties(scope.company, "customers");
    expect(customers.records.map((l) => l.name)).toEqual(["Acme Traders"]);
    const suppliers = await service.getParties(scope.company, "suppliers");
    expect(suppliers.records.map((l) => l.name)).toEqual(["Zenith Supplies"]);
  });
});

describe("Empty and failed modules", () => {
  test("an empty collection is available with zero records, not an error", async () => {
    sendXmlRequest.mockImplementation(({ xml }) =>
      Promise.resolve(transportOk(xml.includes("<ID>CompanyCollection</ID>") ? COMPANIES_XML : "")));
    const scope = await resolveCompany(COMPANY_A_GUID);
    const result = await service.getDomain(scope.company, "stockGroups");
    expect(result.available).toBe(true);
    expect(result.records).toEqual([]);
  });

  test("a failed extraction reports unavailable with a reason, never fake rows", async () => {
    sendXmlRequest.mockImplementation(({ xml }) =>
      xml.includes("<ID>CompanyCollection</ID>")
        ? Promise.resolve(transportOk(COMPANIES_XML))
        : Promise.resolve({ success: false, errorMessage: "timeout of 10000ms exceeded" }));
    const scope = await resolveCompany(COMPANY_A_GUID);
    const result = await service.getDomain(scope.company, "stockItems");
    expect(result.available).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.reason.failureCode).toBe("TALLY_TIMEOUT");
    expect(result.reason.companyId).toBe(COMPANY_A_GUID);
    expect(result.reason.source).toBe("stockItemMaster");
  });

  test("overview reports null for a failed domain so it is never read as zero", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("StockItemCollection")) return Promise.resolve({ success: false, errorMessage: "timeout" });
      if (xml.includes("SalesLedgerCollection")) return Promise.resolve(transportOk(LEDGERS_A_XML));
      return Promise.resolve(transportOk(""));
    });

    const scope = await resolveCompany(COMPANY_A_GUID);
    const overview = await service.getOverview(scope.company);
    expect(overview.counts.ledgers).toBe(3);
    expect(overview.counts.stockItems).toBeNull();
    expect(overview.counts.stockGroups).toBe(0);
    expect(overview.unavailable.stockItems.failureCode).toBe("TALLY_TIMEOUT");
    expect(overview.parties).toEqual({ customers: 1, suppliers: 1 });
  });

  test("capability map marks absent domains unavailable with a reason", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("SalesLedgerCollection")) return Promise.resolve(transportOk(LEDGERS_A_XML));
      return Promise.resolve(transportOk(""));
    });
    const scope = await resolveCompany(COMPANY_A_GUID);
    const capabilities = await service.getCapabilityMap(scope.company);
    expect(capabilities.ledgers.available).toBe(true);
    expect(capabilities.costCentres.available).toBe(false);
    expect(capabilities.salesman.available).toBe(false);
    expect(capabilities.salesman.reason).toMatch(/cost centres are not enabled/i);
  });
});

describe("Closed-company safety gate", () => {
  // Verified against the live instance: sending SVCURRENTCOMPANY for a company
  // that is not loaded CRASHES TallyPrime (the process died and restarted).
  test("no extraction is sent once a company has been closed in Tally", async () => {
    let discoveryCalls = 0;
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) {
        discoveryCalls += 1;
        // First call: both companies open. Re-check: the company was closed.
        return Promise.resolve(transportOk(discoveryCalls === 1 ? COMPANIES_XML : ""));
      }
      return Promise.resolve(transportOk(LEDGERS_A_XML)); // must never be reached
    });

    const scope = await resolveCompany(COMPANY_A_GUID);
    expect(scope.ok).toBe(true);

    const result = await service.getDomain(scope.company, "ledgers");
    expect(result.available).toBe(false);
    expect(result.reason.failureCode).toBe("TALLY_COMPANY_NOT_FOUND");
    expect(result.reason.stage).toBe("guard");
    expect(result.reason.message).toMatch(/no longer open/i);

    // Only discovery and the re-check went out; no collection query was sent.
    const collectionCalls = sendXmlRequest.mock.calls
      .filter(([arg]) => !arg.xml.includes("<ID>CompanyCollection</ID>"));
    expect(collectionCalls).toHaveLength(0);
  });

  test("extraction proceeds normally while the company is still open", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      return Promise.resolve(transportOk(LEDGERS_A_XML));
    });
    const scope = await resolveCompany(COMPANY_A_GUID);
    const result = await service.getDomain(scope.company, "ledgers");
    expect(result.available).toBe(true);
    expect(result.records.length).toBeGreaterThan(0);
  });

  test("the gate blocks the other company too, not just one", async () => {
    let calls = 0;
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) {
        calls += 1;
        return Promise.resolve(transportOk(calls === 1 ? COMPANIES_XML : ""));
      }
      return Promise.resolve(transportOk(LEDGERS_B_XML));
    });
    const scope = await resolveCompany(COMPANY_B_GUID);
    const result = await service.getDomain(scope.company, "ledgers");
    expect(result.available).toBe(false);
    expect(result.reason.companyId).toBe(COMPANY_B_GUID);
  });
});

describe("Failure caching", () => {
  test("a transient timeout is not cached, so the next call can succeed", async () => {
    sendXmlRequest
      .mockResolvedValueOnce({ success: false, errorMessage: "timeout of 10000ms exceeded" })
      .mockResolvedValueOnce(transportOk(COMPANIES_XML));

    const first = await listCompanies();
    expect(first.success).toBe(false);

    // Immediately retry, well inside the cache TTL.
    const second = await listCompanies();
    expect(second.success).toBe(true);
    expect(second.companies).toHaveLength(2);
  });

  test("an unavailable domain is not cached either", async () => {
    let ledgerCalls = 0;
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      ledgerCalls += 1;
      return ledgerCalls === 1
        ? Promise.resolve({ success: false, errorMessage: "timeout" })
        : Promise.resolve(transportOk(LEDGERS_A_XML));
    });

    const scope = await resolveCompany(COMPANY_A_GUID);
    expect((await service.getDomain(scope.company, "ledgers")).available).toBe(false);
    expect((await service.getDomain(scope.company, "ledgers")).available).toBe(true);
  });
});

describe("Stock group hierarchy", () => {
  test("nests sub groups under parents and attaches items", () => {
    const groups = [
      { sourceObjectId: "g1", name: "Electronics", parent: "Primary" },
      { sourceObjectId: "g2", name: "Mobile", parent: "Electronics" }
    ];
    const items = [
      { sourceObjectId: "i1", name: "iPhone", parent: "Mobile" },
      { sourceObjectId: "i2", name: "Charger", parent: "Electronics" }
    ];
    const tree = service.buildStockGroupTree(groups, items);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Electronics");
    expect(tree[0].items.map((i) => i.name)).toEqual(["Charger"]);
    expect(tree[0].children[0].name).toBe("Mobile");
    expect(tree[0].children[0].items.map((i) => i.name)).toEqual(["iPhone"]);
  });

  test("an empty master yields an empty tree, not a fabricated root", () => {
    expect(service.buildStockGroupTree([], [])).toEqual([]);
  });
});

describe("Pagination, search and filtering", () => {
  const records = Array.from({ length: 55 }, (_, i) => ({ name: `Ledger ${i + 1}`, parent: i % 2 ? "Sundry Debtors" : "Sundry Creditors" }));

  test("paginates with sane defaults and metadata", () => {
    const { items, pagination } = paginate(records, { page: 1, limit: 25 });
    expect(items).toHaveLength(25);
    expect(pagination).toMatchObject({ page: 1, limit: 25, total: 55, totalPages: 3, hasMore: true });
  });

  test("the last page reports hasMore false", () => {
    const { items, pagination } = paginate(records, { page: 3, limit: 25 });
    expect(items).toHaveLength(5);
    expect(pagination.hasMore).toBe(false);
  });

  test("search is case-insensitive across the given fields", () => {
    const { items } = paginate(records, { search: "ledger 5", limit: 100 }, ["name"]);
    expect(items.map((r) => r.name)).toEqual(["Ledger 5", "Ledger 50", "Ledger 51", "Ledger 52", "Ledger 53", "Ledger 54", "Ledger 55"]);
  });

  test("search can match a nested field path", () => {
    const nested = [{ name: "A", address: { stateName: "Maharashtra" } }, { name: "B", address: { stateName: "Kerala" } }];
    const { items } = paginate(nested, { search: "maha" }, ["name", "address.stateName"]);
    expect(items.map((r) => r.name)).toEqual(["A"]);
  });

  test("limit is clamped so a client cannot request unbounded data", () => {
    const { pagination } = paginate(records, { limit: 99999 });
    expect(pagination.limit).toBe(500);
  });

  test("a search matching nothing returns an empty page, not everything", () => {
    const { items, pagination } = paginate(records, { search: "nonexistent" }, ["name"]);
    expect(items).toEqual([]);
    expect(pagination.total).toBe(0);
  });
});

describe("Party state on the voucher register", () => {
  /** Serve companies to discovery and ledgers to everything else. */
  function serveLedgers(ledgersXml) {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      return Promise.resolve(transportOk(ledgersXml));
    });
  }

  test("takes the state from the party ledger's discrete Tally field", async () => {
    serveLedgers(LEDGERS_A_XML);
    const scope = await resolveCompany(COMPANY_A_GUID);
    const stateOf = await service.getPartyStateResolver(scope.company);
    expect(stateOf("Acme Traders")).toBe("Maharashtra");
  });

  test("matches the party name the way the FACT_SALES join does", async () => {
    serveLedgers(LEDGERS_A_XML);
    const scope = await resolveCompany(COMPANY_A_GUID);
    const stateOf = await service.getPartyStateResolver(scope.company);
    // Case and inner whitespace must not decide whether a state appears.
    expect(stateOf("  acme   traders ")).toBe("Maharashtra");
  });

  test("a ledger Tally holds no state for resolves to null, never a guess", async () => {
    serveLedgers(LEDGERS_A_XML);
    const scope = await resolveCompany(COMPANY_A_GUID);
    const stateOf = await service.getPartyStateResolver(scope.company);
    // Verified live: Cash and overseas customers legitimately carry no state.
    expect(stateOf("Zenith Supplies")).toBeNull();
  });

  test("a voucher with no party, or a party outside the master, resolves to null", async () => {
    serveLedgers(LEDGERS_A_XML);
    const scope = await resolveCompany(COMPANY_A_GUID);
    const stateOf = await service.getPartyStateResolver(scope.company);
    expect(stateOf(null)).toBeNull();
    expect(stateOf("Someone Not In The Master")).toBeNull();
  });

  test("an unavailable ledger master empties the column instead of failing the register", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      return Promise.resolve({ success: false, errorMessage: "timeout of 10000ms exceeded" });
    });
    const scope = await resolveCompany(COMPANY_A_GUID);
    const stateOf = await service.getPartyStateResolver(scope.company);
    expect(stateOf("Acme Traders")).toBeNull();
  });

  test("one company's ledgers never supply another company's states", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("Alpha Traders")) return Promise.resolve(transportOk(LEDGERS_A_XML));
      return Promise.resolve(transportOk(LEDGERS_B_XML));
    });
    const beta = await resolveCompany(COMPANY_B_GUID);
    const stateOf = await service.getPartyStateResolver(beta.company);
    expect(stateOf("Acme Traders")).toBeNull();
  });
});

describe("Sales analysis aggregation", () => {
  // Two sales invoices and one receipt, shaped as a live Tally returns them:
  // the voucher total carries tax, the stock lines do not.
  const ANALYSIS_XML = `
    <VOUCHER><DATE TYPE="Date">20230715</DATE><GUID>s1</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S1</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Acme Traders</PARTYLEDGERNAME>
      <AMOUNT TYPE="Amount">-11800.00</AMOUNT>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME TYPE="String">Pump</STOCKITEMNAME>
        <BILLEDQTY TYPE="Quantity">2 Nos</BILLEDQTY>
        <RATE TYPE="Rate">5000.00/Nos</RATE>
        <AMOUNT TYPE="Amount">-10000.00</AMOUNT>
      </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER><DATE TYPE="Date">20230820</DATE><GUID>s2</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S2</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Zenith Supplies</PARTYLEDGERNAME>
      <AMOUNT TYPE="Amount">-2360.00</AMOUNT>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME TYPE="String">Valve</STOCKITEMNAME>
        <BILLEDQTY TYPE="Quantity">4 Nos</BILLEDQTY>
        <RATE TYPE="Rate">500.00/Nos</RATE>
        <AMOUNT TYPE="Amount">-2000.00</AMOUNT>
      </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER><DATE TYPE="Date">20230825</DATE><GUID>r1</GUID>
      <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>R1</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Acme Traders</PARTYLEDGERNAME>
      <AMOUNT TYPE="Amount">5000.00</AMOUNT>
    </VOUCHER>
    <VOUCHER><DATE TYPE="Date">20230901</DATE><GUID>s3</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S3</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Acme Traders</PARTYLEDGERNAME>
      <ISCANCELLED TYPE="Logical">Yes</ISCANCELLED>
      <AMOUNT TYPE="Amount">-99999.00</AMOUNT>
    </VOUCHER>`;

  beforeEach(() => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("<TYPE>Ledger</TYPE>")) return Promise.resolve(transportOk(LEDGERS_A_XML));
      return Promise.resolve(transportOk(ANALYSIS_XML));
    });
  });

  const analyse = async () => {
    const scope = await resolveCompany(COMPANY_A_GUID);
    return service.getSalesAnalysis(scope.company, {});
  };

  test("totals count sales only — receipts and cancelled invoices are excluded", async () => {
    const result = await analyse();
    expect(result.available).toBe(true);
    expect(result.totals.invoiceCount).toBe(2);
    // 11800 + 2360. The receipt and the cancelled invoice contribute nothing.
    expect(result.totals.invoicedValue).toBe("14160.00");
  });

  test("invoiced value and item value are reported separately, never merged", async () => {
    const result = await analyse();
    // Tax lives on the voucher, not the stock line, so these must not be equal.
    expect(result.totals.invoicedValue).toBe("14160.00");
    expect(result.totals.itemValue).toBe("12000.00");
    expect(result.totals.itemQuantity).toBe(6);
  });

  test("months are ordered chronologically and carry their own invoice counts", async () => {
    const result = await analyse();
    expect(result.months.map((m) => m.label)).toEqual(["Jul 2023", "Aug 2023"]);
    expect(result.months[0].amount).toBe("11800.00");
    expect(result.months[1].invoices).toBe(1);
  });

  test("customers rank by invoiced value and carry their state", async () => {
    const result = await analyse();
    const [top] = result.customers.top;
    expect(top.name).toBe("Acme Traders");
    expect(top.amount).toBe("11800.00");
    expect(top.state).toBe("Maharashtra");
    expect(top.invoices).toBe(1);
  });

  test("items rank by line value, with quantity and unit preserved", async () => {
    const result = await analyse();
    expect(result.items.top.map((i) => i.name)).toEqual(["Pump", "Valve"]);
    expect(result.items.top[0]).toMatchObject({ amount: "10000.00", quantity: 2, unit: "Nos" });
  });

  test("a party Tally holds no state for is grouped as unknown, not guessed", async () => {
    const result = await analyse();
    const states = Object.fromEntries(result.states.top.map((s) => [s.name, s.amount]));
    // Zenith Supplies has no LEDSTATENAME in the master.
    expect(states["Maharashtra"]).toBe("11800.00");
    expect(states["(no state)"]).toBe("2360.00");
  });

  test("ranking past the cut reports the remainder instead of dropping it", async () => {
    const scope = await resolveCompany(COMPANY_A_GUID);
    const result = await service.getSalesAnalysis(scope.company, { topN: 1 });
    expect(result.customers.top).toHaveLength(1);
    expect(result.customers.otherCount).toBe(1);
    expect(result.customers.otherAmount).toBe("2360.00");
  });

  test("an unavailable register reports why instead of showing zeroes", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      return Promise.resolve({ success: false, errorMessage: "timeout of 10000ms exceeded" });
    });
    const scope = await resolveCompany(COMPANY_A_GUID);
    const result = await service.getSalesAnalysis(scope.company, {});
    expect(result.available).toBe(false);
    expect(result.reason.failureCode).toBe("TALLY_TIMEOUT");
  });
});

describe("Sales detail rows", () => {
  // Ledgers shaped like the live ones: a discrete country and state, plus a
  // free-text address the city must be parsed out of.
  const GEO_LEDGERS_XML = `
    <LEDGER NAME="Vahini Irrigation Private Limited">
      <GUID TYPE="String">led-geo-1</GUID><PARENT TYPE="String">Sundry Debtors</PARENT>
      <COUNTRYNAME TYPE="String">India</COUNTRYNAME>
      <LEDSTATENAME TYPE="String">Karnataka</LEDSTATENAME>
      <ADDRESS.LIST><ADDRESS TYPE="String">Plot 14, Industrial Area</ADDRESS><ADDRESS TYPE="String">Tumakuru - 572106</ADDRESS></ADDRESS.LIST>
    </LEDGER>
    <LEDGER NAME="Al Husseini Construction Limited">
      <GUID TYPE="String">led-geo-2</GUID><PARENT TYPE="String">Sundry Debtors</PARENT>
      <COUNTRYNAME TYPE="String">Tanzania</COUNTRYNAME>
      <LEDSTATENAME TYPE="String">Dar es Salaam</LEDSTATENAME>
    </LEDGER>`;

  const GEO_VOUCHERS_XML = `
    <VOUCHER><DATE TYPE="Date">20240619</DATE><GUID>g1</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>AO/1</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Vahini Irrigation Private Limited</PARTYLEDGERNAME>
      <AMOUNT TYPE="Amount">-118000.00</AMOUNT>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME TYPE="String">Gear Box - V 700</STOCKITEMNAME>
        <BILLEDQTY TYPE="Quantity">2 Nos</BILLEDQTY>
        <RATE TYPE="Rate">50000.00/Nos</RATE>
        <AMOUNT TYPE="Amount">-100000.00</AMOUNT>
      </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER><DATE TYPE="Date">20240721</DATE><GUID>g2</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>AO/2</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Al Husseini Construction Limited</PARTYLEDGERNAME>
      <AMOUNT TYPE="Amount">-50000.00</AMOUNT>
      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME TYPE="String">Water Ring Vacuum Pump</STOCKITEMNAME>
        <BILLEDQTY TYPE="Quantity">1 Nos</BILLEDQTY>
        <AMOUNT TYPE="Amount">-50000.00</AMOUNT>
      </ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER><DATE TYPE="Date">20240801</DATE><GUID>g3</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>AO/3</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Vahini Irrigation Private Limited</PARTYLEDGERNAME>
      <AMOUNT TYPE="Amount">-9000.00</AMOUNT>
    </VOUCHER>`;

  beforeEach(() => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("<TYPE>Ledger</TYPE>")) return Promise.resolve(transportOk(GEO_LEDGERS_XML));
      return Promise.resolve(transportOk(GEO_VOUCHERS_XML));
    });
  });

  const analyse = async () => {
    const scope = await resolveCompany(COMPANY_A_GUID);
    return service.getSalesAnalysis(scope.company, {});
  };

  test("each row carries customer, product, geography, quantity and value", async () => {
    const { rows } = await analyse();
    const row = rows.find((r) => r.voucherNumber === "AO/1");
    expect(row).toMatchObject({
      date: "2024-06-19",
      customer: "Vahini Irrigation Private Limited",
      product: "Gear Box - V 700",
      country: "India",
      state: "Karnataka",
      city: "Tumakuru",
      quantity: 2,
      unit: "Nos",
      amount: "100000.00"
    });
  });

  test("the row's amount is the line value, not the invoice total", async () => {
    const { rows, totals } = await analyse();
    const row = rows.find((r) => r.voucherNumber === "AO/1");
    // Invoice was 118,000 including tax; the stock line is 100,000.
    expect(row.amount).toBe("100000.00");
    expect(totals.invoicedValue).toBe("177000.00");
    expect(totals.itemValue).toBe("150000.00");
  });

  test("a customer with no address yields no city rather than a guess", async () => {
    const { rows } = await analyse();
    const row = rows.find((r) => r.voucherNumber === "AO/2");
    expect(row.country).toBe("Tanzania");
    expect(row.state).toBe("Dar es Salaam");
    expect(row.city).toBeNull();
  });

  test("rows run newest first", async () => {
    const { rows } = await analyse();
    expect(rows.map((r) => r.date)).toEqual(["2024-07-21", "2024-06-19"]);
  });

  test("an invoice with no stock lines contributes no row but still counts in totals", async () => {
    const { rows, totals } = await analyse();
    expect(rows.some((r) => r.voucherNumber === "AO/3")).toBe(false);
    expect(totals.invoiceCount).toBe(3);
    expect(totals.vouchersWithoutItems).toBe(1);
  });

  test("an unavailable ledger master leaves geography empty, not fabricated", async () => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("<TYPE>Ledger</TYPE>")) return Promise.resolve({ success: false, errorMessage: "timeout of 10000ms exceeded" });
      return Promise.resolve(transportOk(GEO_VOUCHERS_XML));
    });
    const { rows } = await analyse();
    expect(rows[0]).toMatchObject({ country: null, state: null, city: null });
    // The sale itself is still reported.
    expect(rows[0].amount).toBe("50000.00");
  });
});

describe("Sales analysis filters", () => {
  const FILTER_LEDGERS_XML = `
    <LEDGER NAME="Acme Traders"><GUID TYPE="String">f1</GUID><PARENT TYPE="String">Sundry Debtors</PARENT>
      <COUNTRYNAME TYPE="String">India</COUNTRYNAME><LEDSTATENAME TYPE="String">Maharashtra</LEDSTATENAME>
      <ADDRESS.LIST><ADDRESS TYPE="String">Jalgaon - 425001</ADDRESS></ADDRESS.LIST></LEDGER>
    <LEDGER NAME="Zenith Supplies"><GUID TYPE="String">f2</GUID><PARENT TYPE="String">Sundry Debtors</PARENT>
      <COUNTRYNAME TYPE="String">Tanzania</COUNTRYNAME><LEDSTATENAME TYPE="String">Dar es Salaam</LEDSTATENAME></LEDGER>`;

  const FILTER_VOUCHERS_XML = `
    <VOUCHER><DATE TYPE="Date">20240610</DATE><GUID>f-v1</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>F1</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Acme Traders</PARTYLEDGERNAME><AMOUNT TYPE="Amount">-11800.00</AMOUNT>
      <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME TYPE="String">Pump</STOCKITEMNAME>
        <BILLEDQTY TYPE="Quantity">1 Nos</BILLEDQTY><AMOUNT TYPE="Amount">-6000.00</AMOUNT></ALLINVENTORYENTRIES.LIST>
      <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME TYPE="String">Valve</STOCKITEMNAME>
        <BILLEDQTY TYPE="Quantity">2 Nos</BILLEDQTY><AMOUNT TYPE="Amount">-4000.00</AMOUNT></ALLINVENTORYENTRIES.LIST>
    </VOUCHER>
    <VOUCHER><DATE TYPE="Date">20240715</DATE><GUID>f-v2</GUID>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>F2</VOUCHERNUMBER>
      <PARTYLEDGERNAME TYPE="String">Zenith Supplies</PARTYLEDGERNAME><AMOUNT TYPE="Amount">-5000.00</AMOUNT>
      <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME TYPE="String">Pump</STOCKITEMNAME>
        <BILLEDQTY TYPE="Quantity">1 Nos</BILLEDQTY><AMOUNT TYPE="Amount">-5000.00</AMOUNT></ALLINVENTORYENTRIES.LIST>
    </VOUCHER>`;

  beforeEach(() => {
    sendXmlRequest.mockImplementation(({ xml }) => {
      if (xml.includes("<ID>CompanyCollection</ID>")) return Promise.resolve(transportOk(COMPANIES_XML));
      if (xml.includes("<TYPE>Ledger</TYPE>")) return Promise.resolve(transportOk(FILTER_LEDGERS_XML));
      return Promise.resolve(transportOk(FILTER_VOUCHERS_XML));
    });
  });

  const analyse = async (filters) => {
    const scope = await resolveCompany(COMPANY_A_GUID);
    return service.getSalesAnalysis(scope.company, filters);
  };

  test("a customer filter selects whole invoices", async () => {
    const result = await analyse({ customer: "Acme Traders" });
    expect(result.totals.invoiceCount).toBe(1);
    expect(result.totals.invoicedValue).toBe("11800.00");
    expect(result.rows).toHaveLength(2);
  });

  test("geography filters select on the ledger's own fields", async () => {
    expect((await analyse({ country: "Tanzania" })).totals.invoiceCount).toBe(1);
    expect((await analyse({ state: "Maharashtra" })).totals.invoicedValue).toBe("11800.00");
    expect((await analyse({ city: "Jalgaon" })).totals.invoiceCount).toBe(1);
  });

  test("a product filter narrows the lines, and says the invoice total is wider", async () => {
    const result = await analyse({ product: "Valve" });
    // Only the Valve line survives...
    expect(result.rows.map((r) => r.product)).toEqual(["Valve"]);
    expect(result.totals.itemValue).toBe("4000.00");
    // ...but the invoice it sits on is counted whole, and that is declared.
    expect(result.totals.invoicedValue).toBe("11800.00");
    expect(result.invoiceTotalsSpanWholeInvoice).toBe(true);
  });

  test("an invoice keeps its place only while a line of it survives", async () => {
    const result = await analyse({ product: "Valve" });
    // F2 has no Valve line, so it drops out entirely.
    expect(result.totals.invoiceCount).toBe(1);
    expect(result.rows.every((r) => r.voucherNumber === "F1")).toBe(true);
  });

  test("search matches across product, customer and geography", async () => {
    expect((await analyse({ search: "valve" })).rows).toHaveLength(1);
    expect((await analyse({ search: "zenith" })).rows.map((r) => r.customer)).toEqual(["Zenith Supplies"]);
    expect((await analyse({ search: "dar es" })).totals.invoiceCount).toBe(1);
    expect((await analyse({ search: "nothing-matches-this" })).rows).toEqual([]);
  });

  test("filters combine, and an impossible combination returns nothing rather than everything", async () => {
    const result = await analyse({ state: "Maharashtra", product: "Pump" });
    expect(result.rows.map((r) => r.voucherNumber)).toEqual(["F1"]);
    expect((await analyse({ country: "Tanzania", product: "Valve" })).totals.invoiceCount).toBe(0);
  });

  test("the options offered stay complete, so one filter never hides the others", async () => {
    // Options come from the period, not the narrowed set: after picking
    // Tanzania the reader can still switch to Maharashtra.
    const result = await analyse({ country: "Tanzania" });
    expect(result.filterOptions.states).toEqual(expect.arrayContaining(["Maharashtra", "Dar es Salaam"]));
    expect(result.filterOptions.products).toEqual(["Pump", "Valve"]);
    expect(result.filterOptions.customers).toEqual(["Acme Traders", "Zenith Supplies"]);
  });

  test("a party with no city is offered under an explicit unknown bucket", async () => {
    const result = await analyse({});
    expect(result.filterOptions.cities).toContain("(no city)");
    expect((await analyse({ city: "(no city)" })).totals.invoiceCount).toBe(1);
  });

  test("filtering never mutates the cached register", async () => {
    await analyse({ product: "Valve" });
    // A later unfiltered read must still see both lines of F1.
    const all = await analyse({});
    expect(all.rows).toHaveLength(3);
    expect(all.totals.itemValue).toBe("15000.00");
  });
});
