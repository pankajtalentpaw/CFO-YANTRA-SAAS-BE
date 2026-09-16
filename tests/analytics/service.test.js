/**
 * Tests for report5Analytics.service.js.
 */

const {
  getAnalyticsIndex,
  getAnalyticsForLens,
  getAnalyticsDashboards,
  getAnalyticsVerification
} = require("../../src/services/report5Analytics.service");
const companyDataService = require("../../src/services/companyData.service");
const { WORKBOOK_FACTS } = require("./fixtures/workbook");

describe("report5Analytics service", () => {
  const mockCompany = {
    companyId: "mock-company-1",
    name: "Test Corp",
    guid: "guid-123"
  };

  beforeAll(() => {
    jest.spyOn(companyDataService, "getFactSalesContext").mockImplementation(async (company, options) => {
      return {
        available: true,
        companyId: company.companyId,
        companyName: company.name,
        factResult: {
          rows: WORKBOOK_FACTS,
          stats: { rowCount: WORKBOOK_FACTS.length }
        },
        rawVouchers: [],
        options
      };
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test("getAnalyticsIndex returns catalog with 161 entries and 100% coverage", () => {
    const res = getAnalyticsIndex();
    expect(res.available).toBe(true);
    expect(res.totalAnalyses).toBe(161);
    expect(res.coverage.total).toBe(161);
    expect(res.coverage.bound).toBe(161);
    expect(res.coverage.pending).toBe(0);
    expect(res.coverage.percent).toBe(100);
    expect(res.catalog).toHaveLength(161);
  });

  test("getAnalyticsForLens with lensId returns blocks for that lens", async () => {
    const res = await getAnalyticsForLens(mockCompany, { lensId: 5 });
    expect(res.available).toBe(true);
    expect(res.lensId).toBe(5);
    expect(Array.isArray(res.blocks)).toBe(true);
    expect(res.blocks).toHaveLength(11);
    res.blocks.forEach((b) => expect(b.lensId).toBe(5));
  });

  test("getAnalyticsForLens with analysisId returns single block", async () => {
    const res = await getAnalyticsForLens(mockCompany, { analysisId: "L01.A01" });
    expect(res.available).toBe(true);
    expect(res.analysisId).toBe("L01.A01");
    expect(res.block.id).toBe("L01.A01");
  });

  test("getAnalyticsForLens with no lensId returns all 161 blocks", async () => {
    const res = await getAnalyticsForLens(mockCompany, {});
    expect(res.available).toBe(true);
    expect(res.blocks).toHaveLength(161);
  });

  test("getAnalyticsDashboards returns Owner Top-5 and Sales Manager Top-10", async () => {
    const res = await getAnalyticsDashboards(mockCompany, {});
    expect(res.available).toBe(true);
    expect(res.dashboards).toHaveProperty("ownerTop5");
    expect(res.dashboards).toHaveProperty("salesManagerTop10");
    expect(res.dashboards.ownerTop5.length).toBeGreaterThan(0);
    expect(res.dashboards.salesManagerTop10.length).toBeGreaterThan(0);
  });

  test("getAnalyticsVerification returns CV01–CV16 validation summary", async () => {
    const res = await getAnalyticsVerification(mockCompany, {});
    expect(res.available).toBe(true);
    expect(res.valid).toBe(true);
    expect(res.checks).toHaveLength(16);
  });
});
