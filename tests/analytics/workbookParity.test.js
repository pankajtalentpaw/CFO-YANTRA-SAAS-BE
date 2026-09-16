/**
 * The A-to-Z check: every analysis against the workbook's own computed cells.
 *
 * MIS05_DecisionIntelligence_v2 is the specification for this layer. Its titles
 * are already generated into analysisCatalog.js, but until this file existed
 * nothing verified that our builders reproduce its ARITHMETIC — the registry is
 * hand-written, and a binding pointing at a plausible-but-wrong builder looks
 * exactly like a correct one from the outside.
 *
 * Both sides are generated from the workbook:
 *   fixtures/workbook.js          — 01_RAW_DATA, fed to the cube
 *   fixtures/workbookAnalyses.js  — each analysis's own computed envelope
 *
 * So this is a check against the spec, not against a previous run of our code.
 *
 * WHAT IS ASSERTED, AND WHY ONLY THIS
 *
 *   title          all 152, character for character.
 *   currentValue   wherever the workbook computes a number.
 *   trigger.fired  wherever the workbook's trigger resolves to a yes or no.
 *   status         consistent with the trigger — fired means AMBER or RED.
 *
 * Severity and priority are deliberately NOT asserted. The workbook assigns
 * both by hand, analysis by analysis, and contradicts itself doing it: the same
 * rank carries "P1 — IMMEDIATE" in one block and "P1 — CRITICAL" in another,
 * and several blocks hard-code a severity with no formula behind it at all.
 * analysisBlock.js derives both from the evaluated status instead, on purpose.
 * Asserting the workbook's labels here would lock that inconsistency in.
 *
 * DIVERGENCES
 *
 * Two lists below record every analysis that does not match, each with its
 * reason, and the test asserts the lists are EXACTLY the set that diverges. A
 * fix that is not removed from the list fails; a new divergence fails. Neither
 * can drift in silence.
 */

const { buildAnalyticsCube } = require("../../src/analytics/compute/shared/analyticsCube.builder");
const { runOne, ANALYSIS_CATALOG } = require("../../src/analytics/engine/runner");
const { STATUS } = require("../../src/analytics/models/analysisBlock");
const { WORKBOOK_FACTS } = require("./fixtures/workbook");
const { WORKBOOK_EXPECTATIONS } = require("./fixtures/workbookAnalyses");

const WINDOW = { fromDate: "20250101", toDate: "20260131" };

/**
 * Lenses 7 and 13 are the only parameterised analyses in the report: the owner
 * picks the two entities to compare from a dropdown. The workbook's own
 * selections sit in sheet 10 rows 5-6 and sheet 13 rows 5-6, and its numbers
 * are computed against them, so the same selections are supplied here.
 */
const WORKBOOK_SELECTION = (id) => {
  if (id.startsWith("L07.")) return { a: "Chair", b: "Sofa" };
  if (id.startsWith("L13.")) return { a: "Jan-25", b: "Jan-26" };
  return {};
};

/**
 * Cells where the WORKBOOK is wrong and our value is right.
 *
 * Every one was confirmed by recomputing the workbook's own formula against its
 * own data. These are not tolerated differences of opinion — they are arithmetic
 * the spreadsheet gets wrong, and matching them would make the product worse.
 */
const WORKBOOK_DEFECTS = {
  "L05.A05": "Envelope reads `N6+N7+N8+N9` — the latest month's revenue — where the title and the block's own metric table both compute the best-to-worst gap (65,500).",
  "L05.A06": "Envelope reads the raw 3-month total where the title asks for its SHARE of annual revenue. The block's own metric table carries the share.",
  "L05.A09": "Envelope reads the last quarter's total where the title asks for the trajectory across quarters.",
  "L07.A07": "Formula is `(B13+C13)`, a plain sum of the two totals, copy-pasted from sheet 13's Combined Period analysis. The title promises a revenue-weighted gap, which is what we compute.",
  "L10.A05": "`SUMPRODUCT((C17<>C18)*(C17<>C19)*(C17<>C20)*(C17<>C21))+1` tests only the FIRST row against the others, so it returns 1 whenever rank 1 repeats anywhere. The distinct city count across the top 5 is 3.",
  "L10.A06": "Same broken distinct-count formula as L10.A05, on the SubCategory column. The distinct product count across the top 5 is 3.",
  "L15.A04": "Sheet 14 cell E6 (Chair's worst-month revenue) is a stale blank, so the workbook's AVERAGE silently skips Chair. Recomputed from the workbook's own monthly grid, Chair's trough is 12,500 and the portfolio average over all six products is 1.9188.",
  "L15.A05": "The same blank E6 leaves Chair's ratio as the text \"N/A\", and Excel ranks text above every number, so `SUMPRODUCT((F6:F11>2)*1)` counts it as extreme. Only Shoes (3.32x) genuinely exceeds 2.0.",
  "L15.A06": "The same blank E6 makes Chair's trough read as zero, inflating the summed peak-to-trough gap by 12,500.",
  "L16.A03": "Formula is `STDEV(B..,N..)/AVERAGE(B..,N..)` — two months, not thirteen. The workbook flags this itself in L16.A10's structural note.",
  "L16.A04": "Formula takes MAX/MIN of the first and last month only, so it cannot see the real best (296,500) or worst (231,000) month. Same degenerate table as L16.A03.",
  "L16.A05": "`SUMPRODUCT((B6+..<AVERAGE(B..,N..))*1)` tests only January against a two-month average, so it can never exceed 1. Seven of the thirteen months are below the full-window average.",
  "L16.A07": "1 minus the two-month CV of L16.A03, and degenerate for the same reason."
};

/**
 * Divergences that are OURS, still open, and not yet reconciled.
 *
 * Listed so they are visible rather than quietly passing. Each is a real gap
 * between our builder and a workbook formula that is itself sound.
 */
const OPEN_GAPS = {
  "L05.A03": "Workbook reports the second-half to first-half ratio (1.089); we report the deviation from proportional. Same underlying comparison, different normalisation.",
  "L10.A04": "Workbook's `MAX((D17-D18)/D17,(D18-D19)/D18,(D21-D22)/D21)` skips the rank 3-4 and 4-5 pairs; ours sweeps every adjacent pair but currently reports a different aggregate.",
  "L10.A09": "Workbook counts the appearances of the most frequent city in the top 10; we report that count as a share.",
  "L10.A10": "Workbook sums the bottom three rows of the top-10 table; we measure everything outside the top 5.",
  "L05.A07": "Trigger only. Workbook fires on the count of positive month-on-month steps; ours fires on their consistency.",
  "L05.A11": "Trigger only. Workbook's cut-off for latest-vs-peak is looser than the shared PEAK_GAP bands.",
  "L06.A02": "Trigger only. Sheet 09 uses a single 10% cut-off on the product axis; we apply sheet 07's stated 5% AMBER / 10% RED rule on both axes.",
  "L06.A08": "Trigger only. Workbook fires on the largest product's share of revenue at a lower cut-off than SINGLE_ENTITY_DEPENDENCY.",
  "L06.A10": "Trigger only. Workbook fires when declining products outweigh growing ones by value; ours keys off the count.",
  "L07.A05": "Trigger only. Workbook fires when the widest city gap exceeds a fixed rupee figure.",
  "L13.A08": "Trigger only. Workbook fires whenever a shortfall exists; ours requires it to clear a share-of-revenue floor.",
  "L13.A09": "Trigger only. Workbook fires on a year-over-year decline between the two selected months specifically.",
  "L16.A02": "Trigger only. Workbook's monthly range cut-off is stated against its degenerate two-month table."
};

/* ------------------------------------------------------------------ */

const cube = buildAnalyticsCube(WORKBOOK_FACTS, WINDOW);
const entries = new Map(ANALYSIS_CATALOG.map((e) => [e.id, e]));
const ids = Object.keys(WORKBOOK_EXPECTATIONS).sort();

const blocks = new Map(
  ids.map((id) => [id, runOne(cube, entries.get(id) || id, { params: WORKBOOK_SELECTION(id) })])
);

/**
 * The layer rounds currency to 2dp and fractions to 6dp at the JSON boundary
 * (money.js), so a difference below half a paisa is that contract working, not
 * a disagreement about the maths.
 */
const matches = (actual, expected) => {
  if (actual === null || actual === undefined) return false;
  const diff = Math.abs(actual - expected);
  return diff <= 0.005 || diff / Math.max(Math.abs(actual), Math.abs(expected), 1e-12) <= 1e-6;
};

const valueChecked = ids.filter((id) => WORKBOOK_EXPECTATIONS[id].currentValue !== null);
const triggerChecked = ids.filter((id) => WORKBOOK_EXPECTATIONS[id].triggerFired !== null);

/** Both lists together: every id excused from a strict assertion. */
const excused = (id) => Boolean(WORKBOOK_DEFECTS[id] || OPEN_GAPS[id]);

describe("workbook parity — the 152 analyses against MIS05", () => {
  test("the fixture is the whole workbook", () => {
    expect(ids).toHaveLength(152);
    expect(valueChecked.length).toBeGreaterThanOrEqual(90);
    expect(triggerChecked.length).toBeGreaterThanOrEqual(90);
  });

  test("every analysis in the workbook has a catalog entry and a block", () => {
    const missing = ids.filter((id) => !entries.has(id));
    expect(missing).toEqual([]);

    const unbuilt = ids.filter((id) => {
      const b = blocks.get(id);
      return !b || (b.provenance && (b.provenance.pending || b.provenance.error));
    });
    expect(unbuilt).toEqual([]);
  });

  // The "same name" half of the request: titles must match the workbook's own
  // headings exactly, including punctuation and casing.
  test.each(ids)("%s carries the workbook's title", (id) => {
    expect(blocks.get(id).title).toBe(WORKBOOK_EXPECTATIONS[id].title);
  });

  /**
   * Eleven headings are overridden because the workbook never gave those
   * analyses a name that works for anyone but its own sample company — a
   * cross-reference ("See Sheet 07"), a name reused on two lenses, or a name
   * with the sample's own shape baked in ("13-Month", "the 6 Products",
   * "Jan-26 vs Jan-25").
   *
   * Pinned here so the list cannot quietly grow: an override is a deliberate
   * departure from the spec and each one has to be argued for.
   */
  test("only the eleven known analyses are renamed", () => {
    const renamed = ids.filter((id) => {
      const e = WORKBOOK_EXPECTATIONS[id];
      return e.workbookTitle && e.workbookTitle !== e.title;
    });

    expect(renamed.sort()).toEqual([
      "L01.A08", "L04.A08", "L05.A01", "L07.A01", "L07.A04", "L12.A01",
      "L13.A01", "L13.A04", "L14.A05", "L16.A01", "L16.A10"
    ]);
  });

  test("no two analyses share a title", () => {
    const seen = new Map();
    for (const entry of ANALYSIS_CATALOG) {
      if (!seen.has(entry.title)) seen.set(entry.title, []);
      seen.get(entry.title).push(entry.id);
    }
    const duplicates = [...seen.entries()].filter(([, list]) => list.length > 1);
    expect(duplicates).toEqual([]);
  });

  /**
   * Nothing static may name the workbook's own sample company.
   *
   * The workbook's prose is written ABOUT its sample data — "New Delhi is
   * unambiguously the highest-priority city", "Mobile generates ~35.7% of total
   * revenue", "Of the 4 cities...". Because most builders compute no actions of
   * their own, analysisBlock.js was falling back to those exact sentences and
   * printing them on real customers' reports. Extraction now drops them; this
   * is the guard that keeps them out.
   */
  test("no static text names the sample company or its shape", () => {
    const sampleEntity = /\b(Ahmedabad|Jaipur|Mumbai|New Delhi|Chair|Laptop|Mobile|Shirts|Shoes|Sofa)\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-2\d\b|₹\s?[\d,]+/;
    const sampleShape = /\b4 cities\b|\b6 products\b|\b13[-\s]month|\ball 6\b|\b24 (possible )?combinations\b/i;
    const fields = ["title", "question", "dimension", "narrative", "recommendedAction", "ownerAction", "salesManagerAction"];

    const offenders = [];
    for (const entry of ANALYSIS_CATALOG) {
      for (const field of fields) {
        const value = entry[field];
        if (typeof value !== "string") continue;
        if (sampleEntity.test(value) || sampleShape.test(value)) {
          offenders.push(`${entry.id}.${field}: ${value.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every analysis has a title that names it", () => {
    // A title that is a cross-reference or a page-layout note tells a reader
    // nothing about what the analysis measures.
    const unusable = ANALYSIS_CATALOG.filter((e) => (
      !e.title
      || e.title.length < 4
      || /^see sheet|^structural note$|^table \d/i.test(e.title)
    ));
    expect(unusable.map((e) => `${e.id}: ${e.title}`)).toEqual([]);
  });
});

describe("workbook parity — computed values", () => {
  const strict = valueChecked.filter((id) => !excused(id));

  test.each(strict)("%s reproduces the workbook's Current Value", (id) => {
    const expectation = WORKBOOK_EXPECTATIONS[id];
    const block = blocks.get(id);
    const actual = block.headline ? block.headline.value : null;

    // The Excel source is in the message so a failure is diagnosable without
    // opening the workbook.
    expect({
      id,
      title: expectation.title,
      actual,
      expected: expectation.currentValue,
      excel: expectation.formulas.currentValue
    }).toEqual({
      id,
      title: expectation.title,
      actual: matches(actual, expectation.currentValue) ? actual : expectation.currentValue,
      expected: expectation.currentValue,
      excel: expectation.formulas.currentValue
    });
  });
});

describe("workbook parity — triggers", () => {
  const strict = triggerChecked.filter((id) => !excused(id));

  test.each(strict)("%s fires when the workbook fires", (id) => {
    const expectation = WORKBOOK_EXPECTATIONS[id];
    const block = blocks.get(id);

    expect({
      id,
      fired: Boolean(block.trigger && block.trigger.fired),
      excel: expectation.formulas.trigger
    }).toEqual({
      id,
      fired: expectation.triggerFired,
      excel: expectation.formulas.trigger
    });
  });

  // Status and trigger must agree, whatever the threshold happens to be. This
  // is what stops a block reading GREEN while its own trigger has fired.
  test.each(triggerChecked)("%s keeps status consistent with its trigger", (id) => {
    const block = blocks.get(id);
    if (!block.trigger) return;
    if (block.status === STATUS.IDLE) return;

    if (block.trigger.fired) expect([STATUS.AMBER, STATUS.RED]).toContain(block.status);
    else expect(block.status).toBe(STATUS.GREEN);
  });
});

describe("workbook parity — the divergence lists are exact", () => {
  test("every listed workbook defect still diverges", () => {
    const reconciled = Object.keys(WORKBOOK_DEFECTS).filter((id) => {
      const e = WORKBOOK_EXPECTATIONS[id];
      const b = blocks.get(id);
      const valueAgrees = e.currentValue === null
        || matches(b.headline ? b.headline.value : null, e.currentValue);
      const triggerAgrees = e.triggerFired === null
        || Boolean(b.trigger && b.trigger.fired) === e.triggerFired;
      return valueAgrees && triggerAgrees;
    });

    // A defect that now agrees means the workbook was re-exported, or we have
    // started reproducing its error. Either way the entry must be revisited.
    expect(reconciled).toEqual([]);
  });

  test("every open gap still diverges", () => {
    const closed = Object.keys(OPEN_GAPS).filter((id) => {
      const e = WORKBOOK_EXPECTATIONS[id];
      const b = blocks.get(id);
      const valueAgrees = e.currentValue === null
        || matches(b.headline ? b.headline.value : null, e.currentValue);
      const triggerAgrees = e.triggerFired === null
        || Boolean(b.trigger && b.trigger.fired) === e.triggerFired;
      return valueAgrees && triggerAgrees;
    });

    // Closing a gap is good news — delete its entry so the list stays honest.
    expect(closed).toEqual([]);
  });

  test("no analysis diverges without being listed", () => {
    const unlisted = ids.filter((id) => {
      if (excused(id)) return false;
      const e = WORKBOOK_EXPECTATIONS[id];
      const b = blocks.get(id);
      if (e.currentValue !== null && !matches(b.headline ? b.headline.value : null, e.currentValue)) return true;
      if (e.triggerFired !== null && Boolean(b.trigger && b.trigger.fired) !== e.triggerFired) return true;
      return false;
    });

    expect(unlisted).toEqual([]);
  });
});
