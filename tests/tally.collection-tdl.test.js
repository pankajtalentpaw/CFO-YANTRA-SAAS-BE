const { buildProbeXml, buildCompanyListRequest } = require("../src/integrations/tally/tally.requests");
const { classifyError, isCollectionDescriptionError } = require("../src/services/diagnostics.service");
const { FAILURE_CODES } = require("../src/constants");

/** Pull HEADER.ID and every COLLECTION NAME out of a generated envelope. */
function tdlIdentity(xml) {
  const id = (xml.match(/<ID>([^<]+)<\/ID>/) || [])[1];
  const names = [...xml.matchAll(/<COLLECTION\s+NAME="([^"]+)"/g)].map((m) => m[1]);
  return { id, names };
}

describe("TDL collection definition", () => {
  const requests = {
    probe: buildProbeXml(null),
    companyList: buildCompanyListRequest()
  };

  test.each(Object.entries(requests))(
    "%s: HEADER.ID exactly matches the defined COLLECTION NAME",
    (_label, xml) => {
      const { id, names } = tdlIdentity(xml);
      expect(id).toBeTruthy();
      expect(names).toContain(id);
    }
  );

  test.each(Object.entries(requests))(
    "%s: collection declares its object TYPE as a child element",
    (_label, xml) => {
      // A TYPE attribute is ignored by Tally and causes "Could not find description!".
      expect(xml).toContain("<TYPE>Company</TYPE>");
      expect(xml).not.toMatch(/<COLLECTION[^>]*\sTYPE=/i);
    }
  );

  test.each(Object.entries(requests))("%s: stays read-only", (_label, xml) => {
    expect(xml).toContain("<TALLYREQUEST>Export</TALLYREQUEST>");
    expect(xml).toContain('ISMODIFY="No"');
    expect(xml).not.toMatch(/<TALLYREQUEST>\s*(Import|Alter|Delete)/i);
  });

  test("probe uses the minimal Name-only baseline", () => {
    const fetches = [...requests.probe.matchAll(/<FETCH>([^<]+)<\/FETCH>/g)].map((m) => m[1]);
    expect(fetches).toEqual(["Name"]);
    expect(requests.probe).not.toContain("<NATIVEMETHOD>");
  });

  test("one canonical collection name is used across discovery requests", () => {
    expect(tdlIdentity(requests.probe).id).toBe(tdlIdentity(requests.companyList).id);
  });
});

describe("TDL error classification", () => {
  test("recognizes Tally's missing-description text", () => {
    expect(isCollectionDescriptionError("Could not find description!")).toBe(true);
    expect(isCollectionDescriptionError("Error in TDL. 'Collection:CompanyCollection'")).toBe(true);
    expect(isCollectionDescriptionError("timeout of 10000ms exceeded")).toBe(false);
    expect(isCollectionDescriptionError(null)).toBe(false);
  });

  test("a missing collection definition is NOT reported as a network timeout", () => {
    const diag = classifyError(
      new Error("Error in TDL. 'Collection:CompanyCollection' Could not find description!")
    );
    expect(diag.failureCode).toBe(FAILURE_CODES.TALLY_INVALID_COLLECTION);
    expect(diag.failureCode).not.toBe(FAILURE_CODES.CONNECTION_TIMEOUT);
    expect(diag.retryable).toBe(false);
    expect(diag.diagnosticHint).toMatch(/could not resolve the requested collection/i);
    expect(diag.userAction).toMatch(/HEADER\.ID/);
  });

  test("the TDL branch does not swallow genuine timeouts", () => {
    const diag = classifyError(Object.assign(new Error("timeout of 10000ms exceeded"), { code: "ECONNABORTED" }));
    expect(diag.failureCode).toBe(FAILURE_CODES.CONNECTION_TIMEOUT);
  });
});
