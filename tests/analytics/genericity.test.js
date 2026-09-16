/**
 * The layer must work for ANY company, not just the one in the workbook.
 *
 * Everything else in this suite runs against MIS05's own sample data, which is
 * exactly the shape that hides shape-dependent bugs: thirteen months, four
 * cities, six products. Several real defects only appear when those numbers
 * change, and all of them shipped:
 *
 *   - The workbook's prose is written ABOUT its sample company. Because most
 *     builders compute no `actions` of their own, analysisBlock.js fell back to
 *     sentences like "New Delhi is unambiguously the highest-priority city" and
 *     printed them on real customers' reports.
 *   - HHI's floor is 1/N, so the workbook's 0.15/0.25 cut-offs — set against
 *     thirteen months — marked every perfectly balanced four-city book as RED.
 *   - A trend threshold in rupees ("losing > ₹500/month") is a tenth of a
 *     percent to a company turning over ₹5 crore a month and a tenth of the
 *     whole business to a shop turning over ₹50,000.
 *   - An empty book reported eight RED analyses, computing a trend slope of
 *     zero and a growth-offset ratio of 100% from nothing at all.
 *
 * So this file runs the whole catalog against companies that share nothing with
 * the workbook and asserts the layer behaves.
 */

const { buildAnalyticsCube } = require("../../src/analytics/compute/shared/analyticsCube.builder");
const { runAll, ANALYSIS_CATALOG } = require("../../src/analytics/engine/runner");
const { validateBlock, STATUS } = require("../../src/analytics/models/analysisBlock");
const { evaluate } = require("../../src/analytics/engine/triggerEvaluator");
const stats = require("../../src/analytics/compute/shared/stats");
const { Decimal } = require("../../src/analytics/compute/shared/money");

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

/**
 * A synthetic ledger with none of the workbook's names.
 *
 * Deliberately uneven: one city trends down, some combinations stop trading
 * part-way through, and the scale is a parameter — a layer that only works on
 * a tidy full matrix is not one that works.
 */
function makeLedger({ cities, groups, months, scale = 1 }) {
  const facts = [];
  let id = 0;
  cities.forEach((city, ci) => {
    groups.forEach((group, gi) => {
      for (let m = 0; m < months; m++) {
        if ((ci + gi) % 4 === 3 && m > months / 2) continue;
        const base = (1 + ci) * (2 + gi) * 100000 * scale;
        const drift = 1 - (ci === 1 ? m * 0.08 : -m * 0.03);
        facts.push({
          RowID: String(++id),
          Category: group,
          SubCategory: group,
          City: city,
          Month: MONTH_NAMES[m % 12],
          MonthNum: (m % 12) + 1,
          SalesAmount: String(Math.round(base * Math.max(drift, 0.05))),
          _meta: { voucherDate: `2024-${String((m % 12) + 1).padStart(2, "0")}-15`, isCredit: false }
        });
      }
    });
  });
  return facts;
}

const SHAPES = [
  {
    name: "a different company entirely",
    cities: ["Pune", "Surat", "Kochi"],
    groups: ["Cement", "Steel", "Paint", "Tiles"],
    months: 8,
    window: { fromDate: "20240101", toDate: "20240831" }
  },
  {
    name: "the smallest book that can still be compared",
    cities: ["Pune", "Surat"],
    groups: ["Cement", "Steel"],
    months: 2,
    window: { fromDate: "20240101", toDate: "20240229" }
  },
  {
    name: "one city, one product, one month",
    cities: ["Pune"],
    groups: ["Cement"],
    months: 1,
    window: { fromDate: "20240101", toDate: "20240131" }
  },
  {
    name: "twelve cities, nine products, at crore scale",
    cities: ["Pune", "Surat", "Kochi", "Indore", "Nagpur", "Patna", "Bhopal", "Kanpur", "Ranchi", "Rajkot", "Trichy", "Guwahati"],
    groups: ["Cement", "Steel", "Paint", "Tiles", "Pipes", "Glass", "Wood", "Wire", "Sand"],
    months: 8,
    scale: 40,
    window: { fromDate: "20240101", toDate: "20240831" }
  }
];

/** Names, months and figures that belong to the workbook's sample company. */
const SAMPLE_COMPANY = [
  "Ahmedabad", "Jaipur", "Mumbai", "New Delhi", "Delhi",
  "Chair", "Laptop", "Mobile", "Shirts", "Shoes", "Sofa",
  "Puja", "Amit", "Neha", "Party F",
  "Jan-25", "Feb-25", "Mar-25", "Sep-25", "Dec-25", "Jan-26",
  "53,000", "5,500", "112,500", "102,000"
];

/** Every string a reader could see on a block. */
function visibleStrings(block) {
  const out = [];
  const walk = (value) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk({
    title: block.title,
    question: block.question,
    dimension: block.dimension,
    narrative: block.narrative,
    redFlag: block.redFlag,
    trigger: block.trigger,
    headline: block.headline,
    actions: block.actions,
    costOfInaction: block.costOfInaction,
    horizon: block.horizon,
    table: block.table ? { columns: block.table.columns, note: block.table.note } : null
  });
  return out;
}

describe.each(SHAPES)("every analysis, against $name", (shape) => {
  const cube = buildAnalyticsCube(makeLedger(shape), shape.window);
  const blocks = runAll(cube);

  test("the cube is the shape the scenario describes", () => {
    expect(cube.cities).toHaveLength(shape.cities.length);
    expect(cube.groups).toHaveLength(shape.groups.length);
  });

  test("every analysis computes, none is pending and none throws", () => {
    expect(blocks).toHaveLength(ANALYSIS_CATALOG.length);
    const unbuilt = blocks
      .filter((b) => b.provenance && (b.provenance.pending || b.provenance.error))
      .map((b) => `${b.id}: ${b.provenance.error || "pending"}`);
    expect(unbuilt).toEqual([]);
  });

  test("every block satisfies the contract", () => {
    const problems = blocks
      .map((b) => ({ id: b.id, issues: validateBlock(b) }))
      .filter((r) => r.issues.length)
      .map((r) => `${r.id}: ${r.issues.join("; ")}`);
    expect(problems).toEqual([]);
  });

  test("nothing on screen mentions the workbook's sample company", () => {
    const leaks = [];
    for (const block of blocks) {
      for (const text of visibleStrings(block)) {
        const token = SAMPLE_COMPANY.find((t) => text.includes(t));
        if (token) leaks.push(`${block.id} leaked "${token}": ${text.slice(0, 90)}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  test("no number renders as NaN, Infinity or undefined", () => {
    const bad = [];
    for (const block of blocks) {
      for (const text of visibleStrings(block)) {
        if (/NaN|Infinity|undefined/.test(text)) bad.push(`${block.id}: ${text.slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("a book with no revenue is unassessable, not alarming", () => {
  const cube = buildAnalyticsCube([], { fromDate: "20240101", toDate: "20240831" });
  const blocks = runAll(cube);

  test("every analysis reports IDLE rather than a verdict", () => {
    const judged = blocks.filter((b) => b.status !== STATUS.IDLE).map((b) => `${b.id}: ${b.status}`);
    expect(judged).toEqual([]);
  });

  test("each says why, and none claims a trigger fired", () => {
    for (const block of blocks) {
      expect(block.trigger.fired).toBe(false);
      expect(block.trigger.evaluated).toMatch(/NOT ASSESSED/);
    }
  });
});

describe("thresholds do not depend on how big or how varied a company is", () => {
  /**
   * HHI's floor is 1/N. Judged against a fixed cut-off, a perfectly balanced
   * book was called concentrated purely for having few members — two even
   * months score 0.5 and were RED.
   */
  test.each([2, 3, 4, 6, 12, 13, 24, 50])(
    "a perfectly even spread over %i members reads as balanced",
    (memberCount) => {
      const even = Array.from({ length: memberCount }, () => new Decimal(100));
      const multiple = stats.concentrationMultiple(stats.hhi(even), memberCount);
      expect(evaluate(multiple, "HHI").status).toBe(STATUS.GREEN);
    }
  );

  test("total concentration reads as concentrated at any member count", () => {
    for (const memberCount of [4, 13, 50]) {
      const allInOne = Array.from({ length: memberCount }, (_, i) => new Decimal(i === 0 ? 100 : 0));
      const multiple = stats.concentrationMultiple(stats.hhi(allInOne), memberCount);
      expect(evaluate(multiple, "HHI").status).toBe(STATUS.RED);
    }
  });

  /**
   * The same proportional decline must read the same whatever the turnover.
   * The workbook states this rule in rupees, which cannot be true for both a
   * corner shop and a crore-a-month distributor.
   */
  test.each([50000, 1000000, 50000000])(
    "a 1%-a-month decline is judged the same at an average month of %i",
    (averageMonth) => {
      const slopeShare = new Decimal(averageMonth * 0.01).dividedBy(averageMonth);
      expect(evaluate(slopeShare, "NEGATIVE_SLOPE").status).toBe(STATUS.RED);
    }
  );

  test("a negligible proportional decline is not flagged at any scale", () => {
    for (const averageMonth of [50000, 1000000, 50000000]) {
      const slopeShare = new Decimal(averageMonth * 0.001).dividedBy(averageMonth);
      expect(evaluate(slopeShare, "NEGATIVE_SLOPE").status).toBe(STATUS.GREEN);
    }
  });
});
