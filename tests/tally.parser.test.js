const { parseTallyResponse, extractLineError, normalizeArray } = require("../src/integrations/tally/tally.parser");

describe("Tally XML Parser", () => {
  test("parses valid Tally XML envelope and extracts status", () => {
    const validXml = `
      <ENVELOPE>
        <HEADER>
          <VERSION>1</VERSION>
          <STATUS>1</STATUS>
        </HEADER>
        <BODY>
          <DESC>
            <CMPINFO><COMPANY>1</COMPANY></CMPINFO>
          </DESC>
          <DATA>
            <COLLECTION>
              <COMPANY>
                <NAME>Demo Pvt Ltd</NAME>
              </COMPANY>
            </COLLECTION>
          </DATA>
        </BODY>
      </ENVELOPE>
    `;

    const result = parseTallyResponse(validXml);
    expect(result.success).toBe(true);
    expect(result.headerStatus).toBe("1");
    expect(result.collection).toHaveLength(1);
    expect(result.collection[0].NAME).toBe("Demo Pvt Ltd");
    expect(result.cmpInfo.COMPANY).toBe("1");
  });

  test("detects <LINEERROR> in Tally response", () => {
    const errorXml = `
      <ENVELOPE>
        <HEADER><STATUS>0</STATUS></HEADER>
        <BODY>
          <LINEERROR>Formula : Expression Error! Company not found.</LINEERROR>
        </BODY>
      </ENVELOPE>
    `;

    const result = parseTallyResponse(errorXml);
    expect(result.success).toBe(false);
    expect(result.hasLineError).toBe(true);
    expect(result.lineError).toContain("Expression Error");
  });

  test("handles empty response gracefully", () => {
    const result = parseTallyResponse("");
    expect(result.success).toBe(false);
    expect(result.isEmpty).toBe(true);
  });

  test("detects malformed XML", () => {
    const malformed = "<ENVELOPE><HEADER><STATUS>1</HEADER></ENVELOPE>";
    const result = parseTallyResponse(malformed);
    expect(result.success).toBe(false);
    expect(result.isMalformedXml).toBe(true);
  });

  test("detects missing root ENVELOPE", () => {
    const missingEnvelope = "<DATA><ITEM>123</ITEM></DATA>";
    const result = parseTallyResponse(missingEnvelope);
    expect(result.success).toBe(false);
    expect(result.isInvalidEnvelope).toBe(true);
  });

  test("normalizeArray handles null, scalar, and array", () => {
    expect(normalizeArray(null)).toEqual([]);
    expect(normalizeArray(undefined)).toEqual([]);
    expect(normalizeArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(normalizeArray([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
