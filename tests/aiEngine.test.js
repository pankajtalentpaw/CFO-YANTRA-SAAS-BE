"use strict";

const { aiAnalysisService, buildFinancialContext, OpenAiClient } = require("../src/ai");

describe("AI Virtual CFO & Decision Intelligence Engine", () => {
  describe("OpenAiClient Unit Tests", () => {
    test("detects unconfigured API key safely", () => {
      const client = new OpenAiClient("your_openai_api_key");
      expect(client.isConfigured()).toBe(false);
    });

    test("detects configured API key correctly", () => {
      const client = new OpenAiClient("sk-proj-test1234567890abcdefghijklmnopqrst");
      expect(client.isConfigured()).toBe(true);
    });

    test("getStatus returns structured engine status", () => {
      const status = aiAnalysisService.getStatus();
      expect(status).toHaveProperty("configured");
      expect(status).toHaveProperty("model");
      expect(status).toHaveProperty("provider", "OpenAI");
      expect(status).toHaveProperty("fallbackMode");
    });
  });

  describe("Financial Context Compaction", () => {
    test("builds compact context from company, sales and report 5", () => {
      const mockCompany = {
        companyId: "comp-1",
        companyName: "Acme Industrial"
      };

      const mockSales = {
        totals: {
          invoicedValue: "1500000.00",
          invoiceCount: 42,
          customerCount: 15
        }
      };

      const mockReport5 = {
        metadata: {
          totalRevenue: "1500000.00",
          distinctSubCategories: 10,
          distinctCities: 4
        },
        executiveSummary: {
          cityTrendHeadline: "1 of 4 cities in decline",
          concentrationAlert: "Moderate"
        },
        filters: {
          filter1_cityRevenueTrend: {
            data: [{ city: "Delhi", totalRevenue: "500000.00", streakMonths: 3, slope: "-1200", costOfInaction: "45000.00" }]
          }
        }
      };

      const context = buildFinancialContext({
        company: mockCompany,
        salesAnalysis: mockSales,
        misReport5: mockReport5
      });

      expect(context.company.name).toBe("Acme Industrial");
      expect(context.salesMetrics.invoicedSales).toBe("1500000.00");
      expect(context.report5MIS.totalRevenue).toBe("1500000.00");
      expect(context.report5MIS.cityStreaks).toHaveLength(1);
      expect(context.report5MIS.cityStreaks[0].city).toBe("Delhi");
    });
  });

  describe("Offline CFO Intelligence Simulation", () => {
    test("generates rich deterministic CFO audit markdown when offline", async () => {
      const mockCompany = {
        companyId: "guid-test-co",
        companyName: "Apex Motors"
      };

      const mockContext = {
        company: { name: "Apex Motors" },
        report5MIS: {
          totalRevenue: "4500000.00",
          distinctCities: 5,
          distinctProducts: 12,
          cityStreaks: [{ city: "Mumbai", streak: 4, costOfInaction: "120000.00" }],
          topCombos: [{ combo: "Parts x Delhi", sharePercent: "35.5" }]
        }
      };

      const audit = aiAnalysisService._generateSimulatedAudit(mockCompany, mockContext);

      expect(audit.success).toBe(true);
      expect(audit.mode).toBe("simulated");
      expect(audit.companyName).toBe("Apex Motors");
      expect(audit.analysis).toContain("Executive Boardroom Audit");
      expect(audit.analysis).toContain("Mumbai");
      expect(audit.analysis).toContain("1,20,000");
      expect(audit.analysis).toContain("90-Day Tactical Capital & Cash Roadmap");
    });

    test("generates intelligent simulated chat responses for risk and streak queries", () => {
      const mockContext = {
        report5MIS: {
          totalRevenue: "2500000.00",
          cityStreaks: [{ city: "Kolkata", streak: 3, costOfInaction: "50000.00" }]
        }
      };

      const riskAnswer = aiAnalysisService._generateSimulatedAnswer("What is my biggest risk?", mockContext);
      expect(riskAnswer).toContain("Veteran CFO Risk Assessment");
      expect(riskAnswer).toContain("HHI Index");

      const streakAnswer = aiAnalysisService._generateSimulatedAnswer("Show me declining cities", mockContext);
      expect(streakAnswer).toContain("City Decline & Cost of Inaction");
      expect(streakAnswer).toContain("Kolkata");
    });
  });
});
