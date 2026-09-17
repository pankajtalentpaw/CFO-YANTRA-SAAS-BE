const {
  parseTypedValue,
  normalizeCollectionItem,
  parseJsonCollection,
  parseJsonBalanceSheet,
  parseJsonProfitAndLoss
} = require("../src/integrations/tally/parsers/tallyJson.parser");

describe("Tally Native JSON Parser", () => {
  describe("parseTypedValue", () => {
    test("parses Amount into clean number", () => {
      expect(parseTypedValue({ type: "Amount", value: "12500.50" })).toBe(12500.5);
      expect(parseTypedValue({ type: "Amount", value: "-46759.34" })).toBe(-46759.34);
    });

    test("parses Date into ISO format", () => {
      expect(parseTypedValue({ type: "Date", value: "20230401" })).toBe("2023-04-01");
      expect(parseTypedValue({ type: "Date", value: "2024-03-31" })).toBe("2024-03-31");
    });

    test("parses Logical into boolean", () => {
      expect(parseTypedValue({ type: "Logical", value: "Yes" })).toBe(true);
      expect(parseTypedValue({ type: "Logical", value: "No" })).toBe(false);
    });

    test("parses String values cleanly", () => {
      expect(parseTypedValue({ type: "String", value: "  Sundry Debtors  " })).toBe("Sundry Debtors");
    });

    test("recursively parses objects and arrays", () => {
      const input = {
        name: { type: "String", value: "Test Item" },
        rates: [{ type: "Number", value: "18" }, { type: "Number", value: "5" }],
        active: { type: "Logical", value: "Yes" }
      };
      expect(parseTypedValue(input)).toEqual({
        name: "Test Item",
        rates: [18, 5],
        active: true
      });
    });
  });

  describe("parseJsonCollection", () => {
    test("normalizes a raw Tally company collection", () => {
      const response = {
        status: "1",
        data: {
          collection: [
            {
              metadata: { type: "Company", name: "AQUA OVERSEAS" },
              name: { type: "String", value: "AQUA OVERSEAS" },
              guid: { type: "String", value: "guid-aqua-123" }
            }
          ]
        }
      };

      const result = parseJsonCollection(response);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("AQUA OVERSEAS");
      expect(result[0].guid).toBe("guid-aqua-123");
      expect(result[0].sourceObjectId).toBe("guid-aqua-123");
      expect(result[0].objectType).toBe("Company");
      expect(result[0].checksum).toBeTruthy();
    });

    test("normalizes a raw Tally ledger collection", () => {
      const response = {
        status: "1",
        data: {
          collection: [
            {
              metadata: { type: "Ledger", name: "Account Services" },
              parent: { type: "String", value: "Direct Expenses" },
              openingbalance: { type: "Amount", value: "5000" },
              guid: { type: "String", value: "led-serv-1" }
            }
          ]
        }
      };

      const result = parseJsonCollection(response, { companyId: "comp-1" });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Account Services");
      expect(result[0].parent).toBe("Direct Expenses");
      expect(result[0].openingbalance).toBe(5000);
      expect(result[0].companyId).toBe("comp-1");
      expect(result[0].sourceCompanyId).toBe("comp-1");
      expect(result[0].sourceObjectId).toBe("led-serv-1");
    });
  });

  describe("parseJsonBalanceSheet", () => {
    test("normalizes Balance Sheet report structure", () => {
      const sample = {
        status: "1",
        data: {
          bsbody: {
            bsinfo: {
              bssources: {
                bsdetail: [
                  {
                    bsname: { dspaccname: { dspdispname: "Capital Account" } },
                    bsamt: [{ bsmainamt: -46759.34 }]
                  }
                ]
              },
              bsapplications: {
                bsdetail: [
                  {
                    bsname: { dspaccname: { dspdispname: "Fixed Assets" } },
                    bsamt: [{ bsmainamt: 25000 }]
                  }
                ]
              }
            }
          }
        }
      };

      const report = parseJsonBalanceSheet(sample);
      expect(report.report).toBe("Balance Sheet");
      expect(report.sources).toHaveLength(1);
      expect(report.sources[0]).toEqual({ name: "Capital Account", amount: -46759.34 });
      expect(report.applications).toHaveLength(1);
      expect(report.applications[0]).toEqual({ name: "Fixed Assets", amount: 25000 });
    });
  });
});
