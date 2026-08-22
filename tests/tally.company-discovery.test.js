const {
  parseTallyResponse,
  parseCompanies,
  toCompanyInfo,
  formatCompanyList
} = require("../src/integrations/tally/tally.parser");

/** Wrap company nodes in the envelope shape Tally actually returns. */
function envelope(inner) {
  return `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>${inner}</COLLECTION></DATA></BODY></ENVELOPE>`;
}

describe("Company discovery — parsing", () => {
  test("single company response yields one typed record", () => {
    const xml = envelope(`
      <COMPANY>
        <NAME>Demo Pvt Ltd</NAME>
        <GUID>a1b2c3d4-0001</GUID>
        <STARTINGFROM>20230401</STARTINGFROM>
      </COMPANY>`);

    const companies = parseCompanies(parseTallyResponse(xml));
    expect(companies).toHaveLength(1);
    expect(companies[0].name).toBe("Demo Pvt Ltd");
    expect(companies[0].guid).toBe("a1b2c3d4-0001");
    expect(companies[0].startingAt).toBe("2023-04-01");
    expect(companies[0].companyId).toBe("a1b2c3d4-0001");
  });

  test("multiple company response yields every company in order", () => {
    const xml = envelope(`
      <COMPANY><NAME>Alpha Traders</NAME><GUID>g-1</GUID></COMPANY>
      <COMPANY><NAME>Beta Enterprises</NAME><GUID>g-2</GUID></COMPANY>
      <COMPANY><NAME>Gamma Industries</NAME><GUID>g-3</GUID></COMPANY>`);

    const companies = parseCompanies(parseTallyResponse(xml));
    expect(companies.map((c) => c.name)).toEqual([
      "Alpha Traders",
      "Beta Enterprises",
      "Gamma Industries"
    ]);
    expect(companies.map((c) => c.companyId)).toEqual(["g-1", "g-2", "g-3"]);
  });

  test("empty company collection yields an empty array, not an error", () => {
    const companies = parseCompanies(parseTallyResponse(envelope("")));
    expect(companies).toEqual([]);
  });

  test("missing GUID falls back to MasterId for identity", () => {
    const xml = envelope("<COMPANY><NAME>No Guid Ltd</NAME><MASTERID>42</MASTERID></COMPANY>");
    const [company] = parseCompanies(parseTallyResponse(xml));
    expect(company.guid).toBeUndefined();
    expect(company.masterId).toBe("42");
    expect(company.companyId).toBe("MID_42");
  });

  test("missing starting date omits the field rather than inventing one", () => {
    const xml = envelope("<COMPANY><NAME>No Date Ltd</NAME><GUID>g-9</GUID></COMPANY>");
    const [company] = parseCompanies(parseTallyResponse(xml));
    expect(company.startingAt).toBeUndefined();
    expect(company.name).toBe("No Date Ltd");
  });

  test("malformed company XML is reported as a parse failure and yields no companies", () => {
    const malformed = "<ENVELOPE><BODY><DATA><COLLECTION><COMPANY><NAME>Broken</COMPANY></COLLECTION></DATA></BODY></ENVELOPE>";
    const parsed = parseTallyResponse(malformed);
    expect(parsed.success).toBe(false);
    expect(parsed.isMalformedXml).toBe(true);
    expect(parseCompanies(parsed)).toEqual([]);
  });

  test("name delivered as a text node with attributes is flattened to a string", () => {
    const xml = envelope('<COMPANY><NAME TYPE="String">Attr Node Ltd</NAME></COMPANY>');
    const [company] = parseCompanies(parseTallyResponse(xml));
    expect(company.name).toBe("Attr Node Ltd");
    expect(typeof company.name).toBe("string");
  });

  test("duplicate companies sharing an identity are collapsed, keeping the richer record", () => {
    const xml = envelope(`
      <COMPANY><NAME>Dup Ltd</NAME><GUID>g-dup</GUID></COMPANY>
      <COMPANY><NAME>Dup Ltd</NAME><GUID>g-dup</GUID><STARTINGFROM>20240401</STARTINGFROM></COMPANY>`);
    const companies = parseCompanies(parseTallyResponse(xml));
    expect(companies).toHaveLength(1);
    expect(companies[0].startingAt).toBe("2024-04-01");
  });

  test("toCompanyInfo rejects nodes without a usable name", () => {
    expect(toCompanyInfo(null)).toBeNull();
    expect(toCompanyInfo({})).toBeNull();
    expect(toCompanyInfo({ GUID: "g-x" })).toBeNull();
  });
});

describe("Company discovery — display formatting", () => {
  test("formats a numbered list and never emits [object Object]", () => {
    const xml = envelope(`
      <COMPANY><NAME>Alpha Traders</NAME><GUID>g-1</GUID><STARTINGFROM>20230401</STARTINGFROM></COMPANY>
      <COMPANY><NAME>Beta Enterprises</NAME></COMPANY>`);
    const output = formatCompanyList(parseCompanies(parseTallyResponse(xml)));

    expect(output).toContain("Loaded Companies: 2");
    expect(output).toContain("1. Alpha Traders");
    expect(output).toContain("2. Beta Enterprises");
    expect(output).toContain("GUID: g-1");
    expect(output).toContain("Starting At: 2023-04-01");
    expect(output).not.toContain("[object Object]");
  });

  test("formats the empty case without throwing", () => {
    const output = formatCompanyList([]);
    expect(output).toContain("Loaded Companies: 0");
    expect(output).not.toContain("[object Object]");
  });
});

describe("Company discovery — read-only safety", () => {
  test("collection TDL declares TYPE as a child element, not an attribute", () => {
    const { buildProbeXml, buildCompanyListRequest } = require("../src/integrations/tally/tally.requests");
    for (const xml of [buildProbeXml(null), buildCompanyListRequest()]) {
      // Tally raises "Could not find description!" when TYPE is an attribute.
      expect(xml).toContain("<TYPE>Company</TYPE>");
      expect(xml).not.toMatch(/<COLLECTION[^>]*\sTYPE=/i);
      expect(xml).toMatch(/<COLLECTION NAME="[^"]+" ISMODIFY="No">/);
    }
  });

  test("the discovery request stays an Export request", () => {
    const { buildProbeXml, buildCompanyListRequest } = require("../src/integrations/tally/tally.requests");
    for (const xml of [buildProbeXml(null), buildCompanyListRequest()]) {
      expect(xml).toContain("<TALLYREQUEST>Export</TALLYREQUEST>");
      expect(xml).not.toMatch(/<TALLYREQUEST>\s*(Import|Alter|Delete)/i);
    }
  });
});
