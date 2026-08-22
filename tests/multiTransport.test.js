const { selectBestFormat } = require("../src/integrations/tally/tally.capabilities");
const { parseToCanonical } = require("../src/integrations/tally/canonical/canonical.parser");
const { normalizeCanonicalCompany } = require("../src/integrations/tally/canonical/company.canonical");

describe("Multi-Transport Strategy & Canonical Parser", () => {
  describe("Format Selection & Fallback Logic", () => {
    test("selects JSONEx when JSONEx, JSON, and XML are all supported", () => {
      expect(selectBestFormat({ xml: true, json: true, jsonEx: true })).toBe("JSONEx");
    });

    test("selects JSON when JSONEx is unsupported but JSON and XML are supported", () => {
      expect(selectBestFormat({ xml: true, json: true, jsonEx: false })).toBe("JSON");
    });

    test("fallbacks cleanly to XML when JSONEx and JSON are unsupported", () => {
      expect(selectBestFormat({ xml: true, json: false, jsonEx: false })).toBe("XML");
    });

    test("returns NONE when no transport is supported", () => {
      expect(selectBestFormat({ xml: false, json: false, jsonEx: false })).toBe("NONE");
    });
  });

  describe("Canonical Company Normalization", () => {
    test("normalizes XML company object to Canonical Company", () => {
      const xmlRaw = {
        NAME: "Acme Corporation Pvt Ltd",
        STARTINGFROM: "20240401",
        BOOKSFROM: "20240401",
        GUID: "00000001-0000-0000-0000-000000000001"
      };

      const canonical = normalizeCanonicalCompany(xmlRaw, "XML");
      expect(canonical.companyName).toBe("Acme Corporation Pvt Ltd");
      expect(canonical.financialYearStart).toBe("2024-04-01");
      expect(canonical.sourceFormat).toBe("XML");
      expect(canonical.checksum).toBeDefined();
    });

    test("normalizes JSON company object to Canonical Company with identical fields", () => {
      const jsonRaw = {
        name: "Acme Corporation Pvt Ltd",
        starting_from: "2024-04-01",
        books_from: "2024-04-01",
        guid: "00000001-0000-0000-0000-000000000001"
      };

      const canonical = normalizeCanonicalCompany(jsonRaw, "JSON");
      expect(canonical.companyName).toBe("Acme Corporation Pvt Ltd");
      expect(canonical.financialYearStart).toBe("2024-04-01");
      expect(canonical.sourceFormat).toBe("JSON");
      expect(canonical.checksum).toBeDefined();
    });

    test("parses multi-item transport results through parseToCanonical", () => {
      const transportRes = {
        success: true,
        format: "XML",
        parsedResponse: {
          collection: [
            { NAME: "Company A", GUID: "GUID-A" },
            { NAME: "Company B", GUID: "GUID-B" }
          ]
        }
      };

      const canonicalResult = parseToCanonical(transportRes);
      expect(canonicalResult.success).toBe(true);
      expect(canonicalResult.count).toBe(2);
      expect(canonicalResult.companies[0].companyName).toBe("Company A");
      expect(canonicalResult.companies[1].companyName).toBe("Company B");
    });
  });
});
