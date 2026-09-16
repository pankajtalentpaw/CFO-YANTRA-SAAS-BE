/**
 * Tests for Owner Top-5 and Sales Manager Top-10 Dashboards.
 */

const { buildAnalyticsCube } = require("../../src/analytics/compute/shared/analyticsCube.builder");
const { evaluateOwnerTop5 } = require("../../src/analytics/dashboards/ownerTop5");
const { evaluateSalesManagerTop10 } = require("../../src/analytics/dashboards/salesManagerTop10");
const { getDashboards } = require("../../src/analytics/dashboards");
const { WORKBOOK_FACTS } = require("./fixtures/workbook");

const WINDOW = { fromDate: "20250101", toDate: "20260131" };
const fullCube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);

describe("Executive Decision Dashboards", () => {
  describe("Owner Top-5 Strategic Decisions", () => {
    test("evaluates and ranks up to 5 strategic issues", () => {
      const top5 = evaluateOwnerTop5(fullCube);
      expect(Array.isArray(top5)).toBe(true);
      expect(top5.length).toBeGreaterThan(0);
      expect(top5.length).toBeLessThanOrEqual(5);

      // Verify descending rank order by score
      for (let i = 0; i < top5.length; i++) {
        expect(top5[i].rank).toBe(i + 1);
        expect(typeof top5[i].score).toBe("number");
        expect(top5[i].score).toBeGreaterThan(0);
        if (i > 0) {
          expect(top5[i - 1].score).toBeGreaterThanOrEqual(top5[i].score);
        }
      }
    });

    test("every Owner Top-5 item has required financial and operational fields", () => {
      const top5 = evaluateOwnerTop5(fullCube);
      top5.forEach((item) => {
        expect(item.id).toMatch(/^L\d{2}\.A\d{2}$/);
        expect(typeof item.lensId).toBe("number");
        expect(typeof item.slot).toBe("number");
        expect(item.title).toBeTruthy();
        expect(item.status).toMatch(/^(RED|AMBER|GREEN|IDLE)$/);
        expect(item.severity).toMatch(/^(CRITICAL|HIGH|MEDIUM|LOW)$/);
        expect(typeof item.priority).toBe("number");
        expect(typeof item.narrative).toBe("string");
        expect(Array.isArray(item.ownerActions)).toBe(true);
      });
    });
  });

  describe("Sales Manager Top-10 Tactical Actions", () => {
    test("evaluates and ranks up to 10 tactical actions", () => {
      const top10 = evaluateSalesManagerTop10(fullCube);
      expect(Array.isArray(top10)).toBe(true);
      expect(top10.length).toBeGreaterThan(0);
      expect(top10.length).toBeLessThanOrEqual(10);

      // Verify descending rank order by score
      for (let i = 0; i < top10.length; i++) {
        expect(top10[i].rank).toBe(i + 1);
        expect(typeof top10[i].score).toBe("number");
        expect(top10[i].score).toBeGreaterThan(0);
        if (i > 0) {
          expect(top10[i - 1].score).toBeGreaterThanOrEqual(top10[i].score);
        }
      }
    });

    test("every Sales Manager Top-10 item has required tactical fields", () => {
      const top10 = evaluateSalesManagerTop10(fullCube);
      top10.forEach((item) => {
        expect(item.id).toMatch(/^L\d{2}\.A\d{2}$/);
        expect(typeof item.lensId).toBe("number");
        expect(typeof item.slot).toBe("number");
        expect(item.title).toBeTruthy();
        expect(item.status).toMatch(/^(RED|AMBER|GREEN|IDLE)$/);
        expect(Array.isArray(item.tacticalActions)).toBe(true);
      });
    });
  });

  describe("getDashboards barrel", () => {
    test("returns both ownerTop5 and salesManagerTop10", () => {
      const dashboards = getDashboards(fullCube);
      expect(dashboards).toHaveProperty("ownerTop5");
      expect(dashboards).toHaveProperty("salesManagerTop10");
      expect(Array.isArray(dashboards.ownerTop5)).toBe(true);
      expect(Array.isArray(dashboards.salesManagerTop10)).toBe(true);
    });
  });
});
