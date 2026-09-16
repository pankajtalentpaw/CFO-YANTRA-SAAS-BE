/**
 * Runs the catalog against a cube.
 *
 * Two properties matter more than anything else here:
 *
 *   1. LAZINESS. runLens filters the registry by lens before computing
 *      anything, so asking for lens 9 computes 10 analyses and not 160. That is
 *      the whole reason the API is per-lens; the existing report5 engine
 *      computes all 18 of its filters unconditionally on every request.
 *
 *   2. CONTAINMENT. One analysis throwing must not take down the other nine.
 *      Every call is wrapped, and every result is validated against the block
 *      contract before it can leave — a block that violates the contract is
 *      replaced by an honest IDLE rather than shipped to a frontend that will
 *      render it wrong.
 */

const { ANALYSIS_CATALOG: WORKBOOK_CATALOG } = require("./analysisCatalog");
const { DESIGNED_ANALYSES } = require("./designedAnalyses");
const { bindingFor, coverage } = require("./registry");
const { STATUS, SEVERITY, makeBlock, validateBlock } = require("../models/analysisBlock");

/**
 * The complete catalog: the 152 extracted from the workbook plus the 9 slots it
 * left empty, authored in designedAnalyses.js. Sorted by lens and slot so the
 * report always reads in grid order.
 */
const ANALYSIS_CATALOG = [...WORKBOOK_CATALOG, ...DESIGNED_ANALYSES]
  .sort((a, b) => (a.lensId - b.lensId) || (a.slot - b.slot));

/** Catalog entries by lens, computed once at load. */
const BY_LENS = ANALYSIS_CATALOG.reduce((map, entry) => {
  if (!map.has(entry.lensId)) map.set(entry.lensId, []);
  map.get(entry.lensId).push(entry);
  return map;
}, new Map());

for (const list of BY_LENS.values()) list.sort((a, b) => a.slot - b.slot);

/** A block for an analysis that has no builder yet. Honest, not silent. */
function pendingBlock(entry) {
  return makeBlock(entry, {
    status: STATUS.IDLE,
    severity: SEVERITY.LOW,
    priority: 5,
    trigger: {
      rule: entry.sourceTrigger || null,
      evaluated: "NOT ASSESSED: this analysis is catalogued but not yet computed",
      fired: false
    },
    provenance: { pending: true }
  });
}

/**
 * A block for an analysis run against a book with no revenue at all.
 *
 * Several builders will happily evaluate a degenerate metric on an empty cube —
 * a trend slope of zero, "100% of months carry no revenue", a growth-offset
 * ratio of 100% because both sides are nothing — and report RED off the back of
 * it. A company with no transactions in the window is not in crisis; it is
 * unassessable, and IDLE is the state that says so.
 *
 * Guarded here rather than in each builder so it cannot be forgotten by the
 * next one added.
 */
function emptyBookBlock(entry) {
  return makeBlock(entry, {
    status: STATUS.IDLE,
    severity: SEVERITY.LOW,
    priority: 5,
    trigger: {
      rule: entry.sourceTrigger || null,
      evaluated: "NOT ASSESSED: no revenue recorded in this period",
      fired: false
    },
    provenance: { reason: "no revenue in the selected window", emptyBook: true }
  });
}

/** A block for an analysis whose builder threw. */
function failedBlock(entry, error) {
  return makeBlock(entry, {
    status: STATUS.IDLE,
    severity: SEVERITY.LOW,
    priority: 5,
    trigger: { rule: null, evaluated: "NOT ASSESSED: this analysis could not be computed", fired: false },
    provenance: { error: error && error.message ? error.message : String(error) }
  });
}

/**
 * Compute one analysis.
 *
 * Never throws. A builder that blows up, or returns something the contract
 * rejects, degrades to an IDLE block carrying the reason.
 */
function runOne(cube, entryOrId, context = {}) {
  const entry = typeof entryOrId === "string"
    ? (ANALYSIS_CATALOG.find((e) => e.id === entryOrId) || { id: entryOrId, title: entryOrId, lensId: 0, slot: 1 })
    : entryOrId;

  if (!entry || !entry.id) return failedBlock({ id: "L00.A00", title: "Unknown", lensId: 0, slot: 0 }, new Error("Invalid entry"));

  const binding = bindingFor(entry.id);
  if (!binding || typeof binding.builder !== "function") return pendingBlock(entry);

  // Nothing can be judged from an empty book, and a metric computed over
  // nothing is not evidence of a problem.
  if (cube && cube.totals && cube.totals.total && cube.totals.total.isZero && cube.totals.total.isZero()) {
    return emptyBookBlock(entry);
  }

  let block;
  try {
    block = binding.builder(cube, { ...entry, family: binding.family }, { ...binding.params, ...context.params });
  } catch (error) {
    return failedBlock(entry, error);
  }

  const problems = validateBlock(block);
  if (problems.length) {
    return failedBlock(entry, new Error(`block contract violated: ${problems.join("; ")}`));
  }
  return block;
}

/**
 * Every analysis for one lens.
 *
 * @param {object} cube    from buildAnalyticsCube
 * @param {number} lensId  0-17
 * @param {object} [context] extra params merged over the registry's own
 * @returns {object[]} blocks in slot order
 */
function runLens(cube, lensId, context = {}) {
  const entries = BY_LENS.get(Number(lensId)) || [];
  return entries.map((entry) => runOne(cube, entry, context));
}

/**
 * Every analysis in the catalog.
 *
 * The dashboards need this — they rank across all 160 rather than within one
 * lens — and so does the export path. Nothing on the page-load path calls it.
 */
function runAll(cube, context = {}) {
  return ANALYSIS_CATALOG.map((entry) => runOne(cube, entry, context));
}

/**
 * The catalog without computing anything: titles, questions and lens grouping.
 * Cheap enough to load on every page for badges and counts.
 */
function catalogIndex() {
  return ANALYSIS_CATALOG.map((entry) => ({
    id: entry.id,
    lensId: entry.lensId,
    lensName: entry.lensName,
    slot: entry.slot,
    title: entry.title,
    question: entry.question,
    dimension: entry.dimension,
    source: entry.source,
    pending: !bindingFor(entry.id)
  }));
}

/** Lens ids present in the catalog, ascending. */
function lensIds() {
  return [...BY_LENS.keys()].sort((a, b) => a - b);
}

/** Entries for one lens, uncomputed. */
function lensEntries(lensId) {
  return BY_LENS.get(Number(lensId)) || [];
}

module.exports = {
  runOne,
  runLens,
  runAll,
  catalogIndex,
  lensIds,
  lensEntries,
  coverage: () => coverage(ANALYSIS_CATALOG),
  ANALYSIS_CATALOG
};
