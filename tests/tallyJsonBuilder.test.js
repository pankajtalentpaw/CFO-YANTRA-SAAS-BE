const {
  buildJsonReportRequest,
  buildJsonCollectionRequest,
  buildJsonCompanyRequest,
  buildJsonLedgerRequest,
  buildJsonBalanceSheetRequest,
  buildJsonProfitAndLossRequest
} = require("../src/integrations/tally/requests/jsonRequests.builder");

describe("Tally Native JSON Request Builder", () => {
  describe("buildJsonReportRequest", () => {
    test("builds a standard Balance Sheet report request", () => {
      const req = buildJsonReportRequest("Balance Sheet", "Demo Company Ltd");
      expect(req.headers).toEqual({
        "Content-Type": "application/json; charset=utf-8",
        version: "1",
        tallyrequest: "Export",
        type: "Data",
        id: "Balance Sheet"
      });
      expect(req.body.stat_vars_list.SVCURRENTCOMPANY).toBe("Demo Company Ltd");
      expect(req.body.stat_vars_list.SVExportInPlainFormat).toBe("Yes");
      expect(req.body.tdlmessage.report).toBe("Balance Sheet");
    });

    test("supports object options format with dates", () => {
      const req = buildJsonReportRequest("Profit & Loss", {
        companyName: "Acme Corp",
        fromDate: "20240401",
        toDate: "20250331"
      });
      expect(req.headers.id).toBe("Profit & Loss");
      expect(req.body.stat_vars_list.SVCURRENTCOMPANY).toBe("Acme Corp");
      expect(req.body.stat_vars_list.SVFROMDATE).toBe("20240401");
      expect(req.body.stat_vars_list.SVTODATE).toBe("20250331");
    });
  });

  describe("buildJsonCollectionRequest", () => {
    test("builds a Company collection request", () => {
      const req = buildJsonCompanyRequest();
      expect(req.headers).toEqual({
        "Content-Type": "application/json; charset=utf-8",
        version: "1",
        tallyrequest: "Export",
        type: "Collection",
        id: "Company"
      });
      expect(req.body.tdlmessage.collection.type).toBe("Company");
      expect(req.body.stat_vars_list.SVExportInPlainFormat).toBe("Yes");
    });

    test("builds a Ledger collection request with fetch fields", () => {
      const req = buildJsonLedgerRequest("Demo Company Ltd", {
        fetch: ["Name", "Parent", "OpeningBalance"]
      });
      expect(req.headers.id).toBe("Ledger");
      expect(req.body.stat_vars_list.SVCURRENTCOMPANY).toBe("Demo Company Ltd");
      expect(req.body.tdlmessage.collection.type).toBe("Ledger");
      expect(req.body.tdlmessage.collection.fetch).toEqual(["Name", "Parent", "OpeningBalance"]);
    });
  });

  describe("report shortcuts", () => {
    test("buildJsonBalanceSheetRequest and buildJsonProfitAndLossRequest work correctly", () => {
      const bs = buildJsonBalanceSheetRequest("Demo Co");
      expect(bs.headers.id).toBe("Balance Sheet");
      expect(bs.body.stat_vars_list.SVCURRENTCOMPANY).toBe("Demo Co");

      const pl = buildJsonProfitAndLossRequest("Demo Co");
      expect(pl.headers.id).toBe("Profit and Loss");
      expect(pl.body.stat_vars_list.SVCURRENTCOMPANY).toBe("Demo Co");
    });
  });
});
