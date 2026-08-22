const {
  escapeXml,
  buildProbeXml,
  buildCompanyListRequest,
  buildCapabilityDiscoveryRequest
} = require("../src/integrations/tally/tally.requests");
const { validateReadOnlyXml } = require("../src/integrations/tally/tally.readonly");

describe("Tally Request Builders", () => {
  test("escapeXml correctly escapes special XML characters", () => {
    expect(escapeXml('A & B < C > "D" \'E\'')).toBe("A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;");
    expect(escapeXml(null)).toBe("");
    expect(escapeXml(undefined)).toBe("");
  });

  test("buildProbeXml produces safe read-only XML", () => {
    const xml = buildProbeXml("Test Company & Co");
    expect(xml).toContain("<TALLYREQUEST>Export</TALLYREQUEST>");
    expect(xml).toContain("<SVCURRENTCOMPANY>Test Company &amp; Co</SVCURRENTCOMPANY>");
    expect(validateReadOnlyXml(xml).allowed).toBe(true);
  });

  test("buildCompanyListRequest produces safe read-only XML", () => {
    const xml = buildCompanyListRequest();
    // One canonical collection name is used across all company discovery requests.
    expect(xml).toContain("<ID>CompanyCollection</ID>");
    expect(validateReadOnlyXml(xml).allowed).toBe(true);
  });

  test("buildCapabilityDiscoveryRequest produces safe read-only XML", () => {
    const xml = buildCapabilityDiscoveryRequest();
    expect(xml).toContain("<ID>CapabilityDiscovery</ID>");
    expect(validateReadOnlyXml(xml).allowed).toBe(true);
  });
});

describe("Every request defines the collection it asks for", () => {
  const requests = require("../src/integrations/tally/tally.requests");

  /**
   * A request that names <ID>X</ID> without a <COLLECTION NAME="X"> in its TDL
   * makes TallyPrime raise "Error in TDL … Could not find description!" — a
   * modal that blocks the HTTP gateway until a person clicks OK, after which
   * every later request times out. Verified live: this is what repeatedly put
   * Tally into the unresponsive state, not the size of any query.
   */
  function undefinedCollectionIn(xml) {
    const id = /<ID>([^<]+)<\/ID>/.exec(xml);
    if (!id) return "NO_ID";
    const name = id[1].trim();
    // Report requests name a built-in report rather than a TDL collection.
    if (!/<TYPE>Collection<\/TYPE>/.test(xml)) return null;
    return xml.includes(`<COLLECTION NAME="${name}"`) ? null : name;
  }

  const samples = {
    buildProbeXml: () => requests.buildProbeXml("Acme Ltd"),
    "buildCompanyProbeRequest(XML)": () => requests.buildCompanyProbeRequest("XML"),
    "buildCompanyProbeRequest(JSON)": () => requests.buildCompanyProbeRequest("JSON"),
    "buildCompanyProbeRequest(JSONEx)": () => requests.buildCompanyProbeRequest("JSONEx"),
    buildCompanyListRequest: () => requests.buildCompanyListRequest(),
    buildCompanyDetailedRequest: () => requests.buildCompanyDetailedRequest("Acme Ltd"),
    buildGroupsRequest: () => requests.buildGroupsRequest("Acme Ltd"),
    buildLedgersRequest: () => requests.buildLedgersRequest("Acme Ltd"),
    buildVoucherTypesRequest: () => requests.buildVoucherTypesRequest("Acme Ltd"),
    buildCostCentresRequest: () => requests.buildCostCentresRequest("Acme Ltd"),
    buildCurrenciesRequest: () => requests.buildCurrenciesRequest("Acme Ltd"),
    buildUnitsRequest: () => requests.buildUnitsRequest("Acme Ltd"),
    buildStockGroupsRequest: () => requests.buildStockGroupsRequest("Acme Ltd"),
    buildStockItemsRequest: () => requests.buildStockItemsRequest("Acme Ltd"),
    buildGodownsRequest: () => requests.buildGodownsRequest("Acme Ltd"),
    buildVouchersRequest: () => requests.buildVouchersRequest("Acme Ltd", "20240401", null),
    buildBillWiseOutstandingRequest: () => requests.buildBillWiseOutstandingRequest("Acme Ltd"),
    buildIncrementalSyncRequest: () => requests.buildIncrementalSyncRequest("Acme Ltd", 5)
  };

  for (const [label, build] of Object.entries(samples)) {
    test(`${label} defines its collection`, () => {
      // null means "every collection this request names is defined in its TDL".
      expect(undefinedCollectionIn(build())).toBeNull();
    });
  }

  test("the format probes keep their export format and stay read-only", () => {
    expect(requests.buildCompanyProbeRequest("JSON")).toContain("$$SysName:JSON");
    expect(requests.buildCompanyProbeRequest("JSONEx")).toContain("$$SysName:JSONEx");
    expect(requests.buildCompanyProbeRequest()).toContain("$$SysName:XML");
    expect(() => validateReadOnlyXml(requests.buildCompanyProbeRequest("JSON"))).not.toThrow();
  });
});
