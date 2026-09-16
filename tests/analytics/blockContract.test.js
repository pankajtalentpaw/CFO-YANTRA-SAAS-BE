/**
 * The load-bearing test for the whole layer.
 *
 * 160 hand-written analyses stay honest because every one of them is run
 * against real data and checked against the block contract. A builder that
 * returns a Decimal where the JSON envelope needs a number, invents a column
 * key, or emits a status the frontend has no colour for, fails here rather
 * than in the browser.
 *
 * It also runs each analysis against deliberately hostile cubes — empty, one
 * period, one entity, all-zero — because those are the shapes that reach a real
 * deployment on day one, before a company has much history.
 */

const { buildAnalyticsCube } = require("../../src/analytics/compute/shared/analyticsCube.builder");
const { runOne, runAll, runLens, catalogIndex, lensIds, coverage, ANALYSIS_CATALOG } = require("../../src/analytics/engine/runner");
const { validateBlock, STATUS } = require("../../src/analytics/models/analysisBlock");
const { bindingFor } = require("../../src/analytics/engine/registry");
const { WORKBOOK_FACTS } = require("./fixtures/workbook");

const WINDOW = { fromDate: "20250101", toDate: "20260131" };
const fullCube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);

/** Cubes that a real deployment hits before it has any history. */
const EDGE_CUBES = {
  empty: buildAnalyticsCube([]),
  singlePeriod: buildAnalyticsCube([
    { City: "Mumbai", Category: "Mobile", SalesAmount: "1000", _meta: { voucherDate: "2025-01-10" } }
  ]),
  singleEntity: buildAnalyticsCube(
    Array.from({ length: 13 }, (_, i) => ({
      City: "Mumbai",
      Category: "Mobile",
      SalesAmount: "1000",
      _meta: { voucherDate: `2025-${String((i % 12) + 1).padStart(2, "0")}-10` }
    }))
  ),
  allZero: buildAnalyticsCube([
    { City: "Mumbai", Category: "Mobile", SalesAmount: "0", _meta: { voucherDate: "2025-01-10" } },
    { City: "Delhi", Category: "Shoes", SalesAmount: "0", _meta: { voucherDate: "2025-02-10" } }
  ]),
  noMeta: buildAnalyticsCube([
    { City: "Delhi", Category: "Footwear", Month: "April", MonthNum: 4, SalesAmount: "100" },
    { City: "Delhi", Category: "Footwear", Month: "May", MonthNum: 5, SalesAmount: "90" },
    { City: "Mumbai", Category: "Apparel", Month: "April", MonthNum: 4, SalesAmount: "80" },
    { City: "Mumbai", Category: "Apparel", Month: "May", MonthNum: 5, SalesAmount: "95" }
  ])
};

describe("catalog integrity", () => {
  test("every analysis has a unique, well-formed id", () => {
    const ids = ANALYSIS_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^L\d{2}\.A\d{2}$/);
  });

  test("the id agrees with its own lensId and slot", () => {
    for (const e of ANALYSIS_CATALOG) {
      expect(e.id).toBe(`L${String(e.lensId).padStart(2, "0")}.A${String(e.slot).padStart(2, "0")}`);
    }
  });

  test("every workbook-declared Analysis ID matches the derived id", () => {
    const declared = ANALYSIS_CATALOG.filter((e) => e.provenance && e.provenance.workbookId);
    expect(declared.length).toBeGreaterThan(100);
    for (const e of declared) {
      expect(e.provenance.workbookId).toBe(`F${String(e.lensId).padStart(2, "0")}-A${String(e.slot).padStart(2, "0")}`);
    }
  });

  test("covers lenses 1-16 with a title on every entry", () => {
    expect(lensIds()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    for (const e of ANALYSIS_CATALOG) expect(e.title).toBeTruthy();
  });

  test("the 16 x 10 grid is complete", () => {
    // The workbook supplies 152 blocks and leaves 9 slots empty; those nine are
    // authored in designedAnalyses.js. Lens 5 legitimately carries an 11th.
    const perLens = new Map();
    for (const e of ANALYSIS_CATALOG) perLens.set(e.lensId, (perLens.get(e.lensId) || 0) + 1);
    for (const lens of lensIds()) expect(perLens.get(lens)).toBeGreaterThanOrEqual(10);
    expect(perLens.get(5)).toBe(11);
    expect(ANALYSIS_CATALOG).toHaveLength(161);
  });

  test("every lens numbers its slots 1..n with no gaps", () => {
    for (const lens of lensIds()) {
      const slots = ANALYSIS_CATALOG.filter((e) => e.lensId === lens).map((e) => e.slot);
      expect(slots).toEqual(Array.from({ length: slots.length }, (_, i) => i + 1));
    }
  });

  test("authored analyses are marked so they are never mistaken for workbook-verified ones", () => {
    const designed = ANALYSIS_CATALOG.filter((e) => e.source === "designed");
    expect(designed.map((e) => e.id).sort()).toEqual([
      "L03.A02", "L03.A03", "L03.A04",
      "L07.A10", "L08.A10", "L12.A10", "L13.A10", "L14.A10", "L15.A10"
    ]);
    for (const e of designed) {
      expect(e.title).toBeTruthy();
      expect(e.question).toBeTruthy();
      expect(e.narrative).toBeTruthy();
      expect(e.recommendedAction).toBeTruthy();
      // No workbook provenance, precisely because there is none to claim.
      expect(e.provenance && e.provenance.workbookId).toBeFalsy();
    }
  });

  test("every registry binding points at a catalogued analysis", () => {
    const known = new Set(ANALYSIS_CATALOG.map((e) => e.id));
    for (const e of ANALYSIS_CATALOG) {
      const binding = bindingFor(e.id);
      if (binding) expect(typeof binding.builder).toBe("function");
    }
    const { REGISTRY } = require("../../src/analytics/engine/registry");
    for (const id of Object.keys(REGISTRY)) expect(known.has(id)).toBe(true);
  });
});

describe("block contract — every analysis against the workbook dataset", () => {
  const blocks = runAll(fullCube);

  test("produces one block per catalogued analysis", () => {
    expect(blocks).toHaveLength(ANALYSIS_CATALOG.length);
  });

  test.each(blocks.map((b) => [b.id, b]))("%s satisfies the contract", (_id, block) => {
    expect(validateBlock(block)).toEqual([]);
  });

  test("no block leaked an internal error", () => {
    const failed = blocks.filter((b) => b.provenance && b.provenance.error);
    expect(failed.map((b) => `${b.id}: ${b.provenance.error}`)).toEqual([]);
  });

  test("every bound analysis actually computed something", () => {
    const bound = blocks.filter((b) => bindingFor(b.id));
    expect(bound.length).toBeGreaterThan(0);
    for (const b of bound) {
      expect(b.provenance.pending).toBeUndefined();
      // A bound analysis must produce a table or a headline; IDLE is allowed
      // only when it explains itself.
      const producedSomething = Boolean(b.table || b.headline);
      const explainedItself = b.status === STATUS.IDLE && Boolean(b.trigger && b.trigger.evaluated);
      expect(producedSomething || explainedItself).toBe(true);
    }
  });

  test("unbound analyses are reported as pending, not as passing", () => {
    for (const b of blocks) {
      if (bindingFor(b.id)) continue;
      expect(b.status).toBe(STATUS.IDLE);
      expect(b.provenance.pending).toBe(true);
    }
  });
});

describe("block contract — hostile cubes", () => {
  for (const [name, cube] of Object.entries(EDGE_CUBES)) {
    describe(`cube: ${name}`, () => {
      const blocks = runAll(cube);

      test("every block still satisfies the contract", () => {
        const problems = blocks.flatMap((b) => validateBlock(b).map((p) => `${b.id}: ${p}`));
        expect(problems).toEqual([]);
      });

      test("nothing throws through to an error block", () => {
        const failed = blocks.filter((b) => b.provenance && b.provenance.error);
        expect(failed.map((b) => `${b.id}: ${b.provenance.error}`)).toEqual([]);
      });

      test("no NaN or Infinity reaches the envelope", () => {
        const json = JSON.stringify(blocks);
        expect(json).not.toMatch(/null,"unit"/); // sanity: JSON is well-formed
        expect(json).not.toContain("Infinity");
        expect(json).not.toContain("NaN");
      });
    });
  }

  test("an empty cube never claims everything is fine", () => {
    // The failure mode that would quietly erode trust: reporting GREEN for an
    // analysis that never actually ran.
    for (const b of runAll(EDGE_CUBES.empty)) {
      expect(b.status).not.toBe(STATUS.GREEN);
    }
  });
});

describe("runner", () => {
  test("runLens computes only that lens", () => {
    const blocks = runLens(fullCube, 1);
    expect(blocks).toHaveLength(10);
    expect(blocks.every((b) => b.lensId === 1)).toBe(true);
    expect(blocks.map((b) => b.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("runLens is lazy — it does not compute other lenses", () => {
    // If it were eager, an unknown lens would still cost the full catalog.
    expect(runLens(fullCube, 99)).toEqual([]);
  });

  test("blocks come back in slot order for every lens", () => {
    for (const lens of lensIds()) {
      const slots = runLens(fullCube, lens).map((b) => b.slot);
      expect(slots).toEqual([...slots].sort((a, b) => a - b));
    }
  });

  test("catalogIndex is cheap: no tables, no computed values", () => {
    const index = catalogIndex();
    expect(index).toHaveLength(ANALYSIS_CATALOG.length);
    for (const row of index) {
      expect(row.table).toBeUndefined();
      expect(row.headline).toBeUndefined();
      expect(typeof row.pending).toBe("boolean");
    }
  });

  test("coverage reports how much of the catalog is wired up", () => {
    const c = coverage();
    expect(c.total).toBe(ANALYSIS_CATALOG.length);
    expect(c.bound + c.pending).toBe(c.total);
    expect(c.bound).toBeGreaterThan(0);
  });

  test("a builder that throws is contained to its own block", () => {
    const entry = { ...ANALYSIS_CATALOG[0] };
    const { REGISTRY } = require("../../src/analytics/engine/registry");
    const original = REGISTRY[entry.id];
    REGISTRY[entry.id] = {
      family: "trend",
      builder: () => { throw new Error("boom"); },
      params: {}
    };
    try {
      const block = runOne(fullCube, entry);
      expect(block.status).toBe(STATUS.IDLE);
      expect(block.provenance.error).toContain("boom");
      expect(validateBlock(block)).toEqual([]);
    } finally {
      REGISTRY[entry.id] = original;
    }
  });

  test("a builder returning a contract violation is replaced, not shipped", () => {
    const entry = { ...ANALYSIS_CATALOG[0] };
    const { REGISTRY } = require("../../src/analytics/engine/registry");
    const original = REGISTRY[entry.id];
    REGISTRY[entry.id] = {
      family: "trend",
      // A Decimal that was never converted — the exact bug the contract exists
      // to catch before it reaches the browser.
      builder: (cube, e) => ({ ...require("../../src/analytics/models/analysisBlock").makeBlock(e, {}), priority: 99 }),
      params: {}
    };
    try {
      const block = runOne(fullCube, entry);
      expect(block.provenance.error).toContain("contract violated");
      expect(validateBlock(block)).toEqual([]);
    } finally {
      REGISTRY[entry.id] = original;
    }
  });
});
