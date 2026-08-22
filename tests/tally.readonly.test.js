const { validateReadOnlyXml, assertReadOnlyXml } = require("../src/integrations/tally/tally.readonly");

describe("Tally Read-Only Security Gate (ReadOnlyPolicy)", () => {
  test("allows valid read-only Export collection request", () => {
    const validXml = `
      <ENVELOPE>
        <HEADER>
          <VERSION>1</VERSION>
          <TALLYREQUEST>Export</TALLYREQUEST>
          <TYPE>Collection</TYPE>
          <ID>CompanyCollection</ID>
        </HEADER>
        <BODY>
          <DESC>
            <STATICVARIABLES>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
          </DESC>
        </BODY>
      </ENVELOPE>
    `;

    const result = validateReadOnlyXml(validXml);
    expect(result.allowed).toBe(true);
    expect(() => assertReadOnlyXml(validXml)).not.toThrow();
  });

  test("rejects request with <IMPORTDATA>", () => {
    const dangerousXml = `
      <ENVELOPE>
        <HEADER>
          <TALLYREQUEST>Import</TALLYREQUEST>
          <TYPE>Data</TYPE>
        </HEADER>
        <BODY>
          <IMPORTDATA>
            <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>
            <REQUESTDATA><TALLYMESSAGE></TALLYMESSAGE></REQUESTDATA>
          </IMPORTDATA>
        </BODY>
      </ENVELOPE>
    `;

    const result = validateReadOnlyXml(dangerousXml);
    expect(result.allowed).toBe(false);
    expect(() => assertReadOnlyXml(dangerousXml)).toThrow(/READ_ONLY_VIOLATION/);
  });

  test("rejects request with <ACTION>Create</ACTION>", () => {
    const dangerousXml = `
      <ENVELOPE>
        <HEADER>
          <TALLYREQUEST>Export</TALLYREQUEST>
        </HEADER>
        <BODY>
          <ACTION>Create</ACTION>
        </BODY>
      </ENVELOPE>
    `;

    const result = validateReadOnlyXml(dangerousXml);
    expect(result.allowed).toBe(false);
    expect(() => assertReadOnlyXml(dangerousXml)).toThrow(/READ_ONLY_VIOLATION/);
  });

  test("rejects request with <ACTION>Alter</ACTION>", () => {
    const dangerousXml = `
      <ENVELOPE>
        <HEADER>
          <TALLYREQUEST>Export</TALLYREQUEST>
        </HEADER>
        <BODY>
          <ACTION>Alter</ACTION>
        </BODY>
      </ENVELOPE>
    `;

    const result = validateReadOnlyXml(dangerousXml);
    expect(result.allowed).toBe(false);
    expect(() => assertReadOnlyXml(dangerousXml)).toThrow(/READ_ONLY_VIOLATION/);
  });

  test("rejects request with <ACTION>Delete</ACTION>", () => {
    const dangerousXml = `
      <ENVELOPE>
        <HEADER>
          <TALLYREQUEST>Export</TALLYREQUEST>
        </HEADER>
        <BODY>
          <ACTION>Delete</ACTION>
        </BODY>
      </ENVELOPE>
    `;

    const result = validateReadOnlyXml(dangerousXml);
    expect(result.allowed).toBe(false);
    expect(() => assertReadOnlyXml(dangerousXml)).toThrow(/READ_ONLY_VIOLATION/);
  });

  test("rejects empty or non-string payload", () => {
    expect(validateReadOnlyXml("").allowed).toBe(false);
    expect(validateReadOnlyXml(null).allowed).toBe(false);
    expect(validateReadOnlyXml(123).allowed).toBe(false);
  });

  test("rejects malformed XML without root ENVELOPE", () => {
    const invalidXml = `<NOT_AN_ENVELOPE><HEADER></HEADER></NOT_AN_ENVELOPE>`;
    expect(validateReadOnlyXml(invalidXml).allowed).toBe(false);
  });
});
