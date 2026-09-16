/**
 * Tests for CV01–CV16 Cross-Verification Primitives.
 */

const { buildAnalyticsCube } = require("../../src/analytics/compute/shared/analyticsCube.builder");
const { verifyCube } = require("../../src/analytics/compute/shared/crossVerification");
const { WORKBOOK_FACTS } = require("./fixtures/workbook");

const WINDOW = { fromDate: "20250101", toDate: "20260131" };
const fullCube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);

describe("Cross-Verification (CV01–CV16)", () => {
  test("all 16 mathematical invariant checks pass on workbook cube", () => {
    const result = verifyCube(fullCube);
    expect(result.valid).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.checks).toHaveLength(16);

    const checkIds = result.checks.map((c) => c.id);
    for (let i = 1; i <= 16; i++) {
      const code = `CV${String(i).padStart(2, "0")}`;
      expect(checkIds).toContain(code);
    }

    result.checks.forEach((c) => {
      expect(c.passed).toBe(true);
    });
  });

  test("handles empty and hostile cubes gracefully without throwing", () => {
    const emptyCube = buildAnalyticsCube([]);
    const emptyRes = verifyCube(emptyCube);
    expect(emptyRes).toHaveProperty("valid");
    expect(emptyRes.checks).toHaveLength(16);

    const zeroCube = buildAnalyticsCube([
      { City: "Mumbai", Category: "Mobile", SalesAmount: "0", _meta: { voucherDate: "2025-01-10" } }
    ]);
    const zeroRes = verifyCube(zeroCube);
    expect(zeroRes).toHaveProperty("valid");
    expect(zeroRes.checks).toHaveLength(16);
  });
});
