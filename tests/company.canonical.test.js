const { normalizeCanonicalCompany, deriveStableId } = require("../src/integrations/tally/canonical/company.canonical");

describe("Canonical Company Parser & Stable ID", () => {
  it("should extract company identity with GUID as durable primary identifier", () => {
    const raw = {
      NAME: "Universal Exports Pvt Ltd",
      FORMALNAME: "Universal Exports Private Limited",
      GUID: "e9a03975-234b-4c0a-9d22-96538b8e0e7a",
      MASTERID: "1",
      ALTERID: "42",
      STARTINGFROM: "20240401",
      BOOKSFROM: "20240401",
      BASECURRENCY: "INR",
      COUNTRYNAME: "India",
      STATENAME: "Maharashtra",
      PINCODE: "400001",
      GSTREGNO: "27AABCU9603R1ZM",
      ISBILLWISEON: "Yes",
      ISCOSTCENTRESON: "Yes",
      ISINVENTORYON: "Yes",
      ISGSTAPPLICABLE: "Yes"
    };

    const canonical = normalizeCanonicalCompany(raw, { sourceFormat: "XML" });

    expect(canonical).toBeDefined();
    expect(canonical.sourceCompanyId).toBe("e9a03975-234b-4c0a-9d22-96538b8e0e7a");
    expect(canonical.displayName).toBe("Universal Exports Pvt Ltd");
    expect(canonical.legalName).toBe("Universal Exports Private Limited");
    expect(canonical.financialYearBeginning).toBe("2024-04-01");
    expect(canonical.booksFrom).toBe("2024-04-01");
    expect(canonical.baseCurrency).toBe("INR");
    expect(canonical.country).toBe("India");
    expect(canonical.state).toBe("Maharashtra");
    expect(canonical.gstRegistration.gstin).toBe("27AABCU9603R1ZM");
    expect(canonical.features.billWise).toBe(true);
    expect(canonical.features.inventory).toBe(true);
    expect(canonical.features.costCentres).toBe(true);
    expect(canonical.checksum).toBeDefined();
  });

  it("should fallback to deterministic hash when GUID and MasterID are absent", () => {
    const raw = {
      NAME: "Legacy Trader"
    };

    const canonical = normalizeCanonicalCompany(raw, { sourceFormat: "XML" });
    expect(canonical.sourceCompanyId).toMatch(/^HASH_/);
    expect(canonical.displayName).toBe("Legacy Trader");
    expect(canonical.baseCurrency).toBe("INR");
  });

  it("should generate stable ID deterministically for identical inputs", () => {
    const id1 = deriveStableId(null, null, "My Special Company");
    const id2 = deriveStableId(null, null, "My Special Company");
    expect(id1).toBe(id2);
  });

  it("should handle null or invalid input gracefully", () => {
    expect(normalizeCanonicalCompany(null)).toBeNull();
    expect(normalizeCanonicalCompany(undefined)).toBeNull();
  });
});
