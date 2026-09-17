const { CATALOG, formatDateString } = require("../src/integrations/tally/catalog/tallyApiExplorer.catalog");
const tallyExplorer = require("../src/integrations/tally/tallyExplorer.service");

describe("TallyPrime API Explorer Complete Catalog", () => {
  test("formatDateString formats YYYYMMDD to DD-MM-YYYY", () => {
    expect(formatDateString("20250401")).toBe("01-04-2025");
    expect(formatDateString("20260331")).toBe("31-03-2026");
  });

  test("contains all requested Accounting Masters endpoints", () => {
    const endpoints = [
      "pull-all-ledger",
      "pull-a-ledger",
      "pull-ledgers-of-group",
      "pull-all-groups",
      "pull-group",
      "pull-groups-of-group"
    ];
    endpoints.forEach((ep) => {
      expect(CATALOG[ep]).toBeDefined();
      expect(CATALOG[ep].category).toBe("Accounting Masters");
      expect(CATALOG[ep].headers["content-type"]).toBe("application/json");
      expect(CATALOG[ep].headers.version).toBe("1");
      expect(CATALOG[ep].headers.tallyrequest).toBe("export");

      const body = CATALOG[ep].buildBody("Demo Co");
      expect(body.static_variables).toEqual(
        expect.arrayContaining([{ name: "svCurrentCompany", value: "Demo Co" }])
      );
    });
  });

  test("contains all requested Inventory Masters endpoints", () => {
    const endpoints = [
      "pull-all-stock-items",
      "pull-stock-item",
      "pull-stock-items-of-stock-group",
      "pull-all-stock-groups",
      "pull-stock-group",
      "pull-stock-group-zero-balance",
      "pull-all-units",
      "pull-unit"
    ];
    endpoints.forEach((ep) => {
      expect(CATALOG[ep]).toBeDefined();
      expect(CATALOG[ep].category).toBe("Inventory Masters");
      expect(CATALOG[ep].headers.tallyrequest).toBe("export");

      const body = CATALOG[ep].buildBody("Demo Co");
      expect(body.static_variables).toBeDefined();
    });
  });

  test("contains all requested Voucher / Transaction endpoints", () => {
    const endpoints = [
      "payment-pull-all",
      "payment-pull-period",
      "receipt-pull-all",
      "receipt-pull-period",
      "sales-pull-all",
      "sales-pull-period",
      "purchase-pull-all",
      "purchase-pull-period"
    ];
    endpoints.forEach((ep) => {
      expect(CATALOG[ep]).toBeDefined();
      expect(CATALOG[ep].category).toBe("Transactions");
      expect(CATALOG[ep].headers.type).toBe("collection");

      const body = CATALOG[ep].buildBody("Demo Co");
      expect(body.tdlmessage).toBeDefined();
    });
  });

  test("contains all requested Reports endpoints", () => {
    const endpoints = [
      "pull-trial-balance-period",
      "pull-trial-balance-detailed",
      "pull-trial-balance-plain",
      "pull-trial-balance-empty-fields",
      "pull-trial-balance-ledger-wise",
      "pull-trial-balance-group",
      "pull-sales-register-period",
      "pull-sales-register-plain",
      "pull-sales-register-empty-fields"
    ];
    endpoints.forEach((ep) => {
      expect(CATALOG[ep]).toBeDefined();
      expect(CATALOG[ep].category).toBe("Reports");
      expect(CATALOG[ep].headers.type).toBe("data");

      const body = CATALOG[ep].buildBody("Demo Co");
      expect(body.static_variables).toBeDefined();
    });
  });

  test("throws error when requested endpoint does not exist", async () => {
    await expect(tallyExplorer.pullFromTally("non-existent-endpoint")).rejects.toThrow(
      /Unknown Tally API Explorer endpoint/
    );
  });
});
