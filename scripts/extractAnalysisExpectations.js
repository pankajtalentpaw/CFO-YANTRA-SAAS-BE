/**
 * Codegen: MIS05 workbook -> tests/analytics/fixtures/workbookAnalyses.js
 *
 * The sibling script extractAnalysisCatalog.js deliberately takes only the
 * STATIC half of each analysis, because the catalog must not ship numbers that
 * were computed against one demo dataset. This script takes the other half, and
 * for the opposite reason: to TEST that our builders reproduce the workbook's
 * own arithmetic when fed the workbook's own 01_RAW_DATA.
 *
 * Nothing emitted here is ever loaded by src/. It is a test fixture only —
 * expected values for tests/analytics/workbookParity.test.js.
 *
 * Run:  node scripts/extractAnalysisExpectations.js [path-to-workbook]
 *
 * TWO ENVELOPE FORMATS. Sheets 09-14 carry "Current Value" / "Severity" /
 * "Trigger"; sheets 07-08 carry "Status" / "Trigger Point" / "Best" / "Worst"
 * and state no single current value. Both are extracted, tagged by `format`,
 * and the parity test asserts whichever fields the block actually has.
 */

const fs = require("fs");
const path = require("path");
const { readWorkbook } = require("./lib/xlsxReader");
const {
  findBlocks,
  parseHeading,
  attributeFilters,
  isExcelError,
  trimRow,
  SHEET_FILTERS,
  ENVELOPE_LABELS,
  TITLE_OVERRIDES
} = require("./extractAnalysisCatalog");

const DEFAULT_WORKBOOK = "C:/Users/admin/Downloads/MIS05_DecisionIntelligence_v2 WITH 160 ANALYSIS.xlsx";
const OUT_PATH = path.join(__dirname, "..", "tests", "analytics", "fixtures", "workbookAnalyses.js");

/* ------------------------------------------------------------------ */
/* Cell interpretation                                                 */
/* ------------------------------------------------------------------ */

/**
 * A cell's number, or null when it does not hold one.
 *
 * The workbook fills unavailable slots with prose — "N/A — all cities grew",
 * "Not calculable from available data" — so anything that is not cleanly
 * numeric is deliberately dropped rather than coerced. A NaN reaching the
 * fixture would assert against everything.
 */
function numeric(text) {
  if (text === undefined || text === null) return null;
  const s = String(text).trim();
  if (!s || isExcelError(s)) return null;
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  if (!s || isExcelError(s)) return null;
  return s;
}

/**
 * The workbook's trigger sentence as a tri-state.
 *
 * "GREEN SIGNAL" is its own case and NOT a fired trigger: the workbook uses it
 * where the test passing is good news (a city improving its rank), and our
 * blocks would report that as GREEN with nothing to act on. Reading it as
 * `fired` would invert the meaning of every such analysis.
 */
function triggerState(raw) {
  const s = text(raw);
  if (!s) return { fired: null, positive: false, text: null };
  const upper = s.toUpperCase();
  if (upper.startsWith("NOT TRIGGERED")) return { fired: false, positive: false, text: s };
  if (upper.startsWith("GREEN SIGNAL")) return { fired: false, positive: true, text: s };
  if (upper.startsWith("TRIGGERED")) return { fired: true, positive: false, text: s };
  return { fired: null, positive: false, text: s };
}

const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function severity(raw) {
  const s = text(raw);
  if (!s) return null;
  const upper = s.toUpperCase();
  return SEVERITIES.has(upper) ? upper : null;
}

/**
 * "P1 — IMMEDIATE" -> 1.
 *
 * The label after the dash is not used. The workbook has both "P1 — IMMEDIATE"
 * and "P1 — CRITICAL" for the same rank, which is exactly why analysisBlock.js
 * treats the integer as the source of truth and derives the label from it.
 */
function priorityRank(raw) {
  const s = text(raw);
  if (!s) return null;
  const m = s.match(/^P([1-5])\b/i);
  return m ? Number(m[1]) : null;
}

const STATUSES = new Set(["RED", "AMBER", "GREEN"]);

function status(raw) {
  const s = text(raw);
  if (!s) return null;
  const upper = s.toUpperCase();
  return STATUSES.has(upper) ? upper : null;
}

/* ------------------------------------------------------------------ */
/* Block reading                                                       */
/* ------------------------------------------------------------------ */

/**
 * Envelope fields of one block as { value, formula } pairs.
 *
 * Mirrors readBlock() in the catalog extractor, but keeps column B's formula
 * alongside its cached value so a parity failure can print the Excel source
 * that produced the number it disagrees with.
 */
function readBlockCells(rows, formulas, block) {
  const fields = {};

  for (let r = block.row + 1; r <= block.endRow; r++) {
    const cells = trimRow(rows[r]);
    if (!cells.length) continue;
    const label = cells[0].trim();
    if (!ENVELOPE_LABELS.has(label)) continue;

    // First writer wins: a few blocks repeat a label in their metric table
    // above the envelope, and the envelope copy is the one lower down.
    const value = cells.length >= 2 ? cells[1].trim() : "";
    const formula = ((formulas[r] || [])[1] || "").trim();
    if (fields[label] && !value) continue;
    fields[label] = { value, formula };
  }
  return fields;
}

const val = (f, label) => (f[label] ? f[label].value : null);
const formulaOf = (f, label) => (f[label] && f[label].formula ? f[label].formula : null);

/**
 * Turn one block's envelope into an expectation.
 *
 * `computable: false` marks the blocks the workbook itself declines to compute
 * — the degenerate-table structural notes, which state prose where a number
 * would go. The parity test asserts those return an honest non-numeric block
 * rather than inventing a figure.
 */
function toExpectation(block, sheetName, fields) {
  const isFormatA = Boolean(fields["Current Value"] || fields["Analysis ID"]);

  // Only format A states a trigger sentence. Format B's equivalent is `Status`
  // (RED/AMBER/GREEN), which is a different assertion — running it through
  // triggerState would report every legacy block's trigger as unresolvable.
  const trigger = isFormatA
    ? triggerState(val(fields, "Trigger"))
    : { fired: null, positive: false, text: null };

  const currentValue = numeric(val(fields, "Current Value"));
  const currentText = text(val(fields, "Current Value"));

  const id = `L${String(block.lensId).padStart(2, "0")}.A${String(block.slot).padStart(2, "0")}`;

  const expectation = {
    id,
    workbookId: text(val(fields, "Analysis ID")),
    sheet: sheetName,
    row: block.row,
    // Mirrors the catalog: where the workbook's heading did not name the
    // analysis it is overridden there, so the parity test compares like for
    // like. The original heading stays alongside it.
    title: TITLE_OVERRIDES[id] || block.title,
    workbookTitle: block.title,
    format: isFormatA ? "envelope" : "legacy",

    // Format A (sheets 09-14)
    currentValue,
    currentText: currentValue === null ? currentText : null,
    comparisonValue: numeric(val(fields, "Comparison Value")),
    variance: numeric(val(fields, "Variance / Growth")),
    severity: severity(val(fields, "Severity")),
    financialImpact: numeric(val(fields, "Financial Impact (\u20b9)")),
    coi: numeric(val(fields, "COI \u2014 Cost of Inaction (\u20b9)") || val(fields, "Cost of Inaction")),
    threeMonth: numeric(val(fields, "3-Month View") || val(fields, "3-Month Consequence")),
    sixMonth: numeric(val(fields, "6-Month View") || val(fields, "6-Month Consequence")),

    // Format B (sheets 07-08)
    status: isFormatA ? null : status(val(fields, "Status")),
    best: isFormatA ? null : text(val(fields, "Best")),
    worst: isFormatA ? null : text(val(fields, "Worst")),
    triggerRule: text(val(fields, "Trigger Point")),

    // Both
    triggerFired: trigger.fired,
    triggerPositive: trigger.positive,
    triggerText: trigger.text,
    priority: priorityRank(val(fields, "Priority")),

    formulas: {
      currentValue: formulaOf(fields, "Current Value"),
      trigger: formulaOf(fields, "Trigger") || formulaOf(fields, "Status"),
      severity: formulaOf(fields, "Severity"),
      priority: formulaOf(fields, "Priority"),
      financialImpact: formulaOf(fields, "Financial Impact (\u20b9)")
    }
  };

  // A block whose Current Value is prose with no formula behind it is one the
  // workbook decided could not be computed at this grain.
  expectation.computable = !(
    isFormatA
    && expectation.currentValue === null
    && !expectation.formulas.currentValue
  );

  return expectation;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function extract(workbookPath) {
  const wb = readWorkbook(workbookPath);
  const out = [];

  for (const sheet of wb.sheets) {
    const filters = SHEET_FILTERS[sheet.name];
    if (!filters) continue;

    const blocks = findBlocks(sheet.rows).map((block) => ({
      ...block,
      fields: readBlockCells(sheet.rows, sheet.formulas, block)
    }));

    // attributeFilters reads fields["Analysis ID"] as a plain string, but ours
    // are { value, formula } pairs. Flatten a copy for it.
    const forAttribution = blocks.map((b) => ({
      ...b,
      fields: Object.fromEntries(Object.entries(b.fields).map(([k, v]) => [k, v.value]))
    }));
    const attributed = attributeFilters(forAttribution, filters);

    attributed.forEach((block, i) => {
      out.push(toExpectation({ ...block, ...parseHeading(block.heading), lensId: block.lensId, slot: block.slot },
        sheet.name, blocks[i].fields));
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function render(expectations) {
  const stat = (predicate) => expectations.filter(predicate).length;

  const body = expectations
    .map((e) => `  ${JSON.stringify(e.id)}: ${JSON.stringify(e)}`)
    .join(",\n");

  return `/**
 * GENERATED FILE \u2014 do not edit by hand.
 *
 * Produced by scripts/extractAnalysisExpectations.js from
 * "MIS05_DecisionIntelligence_v2 WITH 160 ANALYSIS.xlsx".
 * Re-run that script to regenerate; hand edits will be lost.
 *
 * The workbook's own computed cells, keyed by analysis id. This is the expected
 * side of tests/analytics/workbookParity.test.js: feed the cube the workbook's
 * 01_RAW_DATA and every builder must land on these numbers.
 *
 * TEST FIXTURE ONLY. Nothing in src/ may import this \u2014 these values were
 * computed against one demo dataset and mean nothing for a real company.
 *
 *   ${expectations.length} analyses
 *   ${stat((e) => e.format === "envelope")} full envelope (sheets 09-14), ${stat((e) => e.format === "legacy")} legacy (sheets 07-08)
 *   ${stat((e) => e.currentValue !== null)} with a numeric Current Value
 *   ${stat((e) => e.severity !== null)} with a stated Severity
 *   ${stat((e) => e.priority !== null)} with a stated Priority
 *   ${stat((e) => e.triggerFired !== null)} with a resolvable Trigger
 *   ${stat((e) => !e.computable)} the workbook declines to compute
 */

const WORKBOOK_EXPECTATIONS = {
${body}
};

module.exports = { WORKBOOK_EXPECTATIONS };
`;
}

function main() {
  const workbookPath = process.argv[2] || DEFAULT_WORKBOOK;
  if (!fs.existsSync(workbookPath)) {
    console.error(`Workbook not found: ${workbookPath}`);
    console.error("Usage: node scripts/extractAnalysisExpectations.js [path-to-workbook]");
    process.exit(1);
  }

  const expectations = extract(workbookPath);

  const duplicates = expectations
    .map((e) => e.id)
    .filter((id, i, all) => all.indexOf(id) !== i);
  if (duplicates.length) {
    console.error(`Duplicate ids, attribution is wrong: ${[...new Set(duplicates)].join(", ")}`);
    process.exitCode = 1;
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, render(expectations), "utf8");

  const count = (predicate) => expectations.filter(predicate).length;
  console.log(`Extracted ${expectations.length} expectations -> ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log(`  envelope format   ${count((e) => e.format === "envelope")}  (sheets 09-14)`);
  console.log(`  legacy format     ${count((e) => e.format === "legacy")}  (sheets 07-08)`);
  console.log(`  numeric value     ${count((e) => e.currentValue !== null)}`);
  console.log(`  severity stated   ${count((e) => e.severity !== null)}`);
  console.log(`  priority stated   ${count((e) => e.priority !== null)}`);
  console.log(`  trigger resolved  ${count((e) => e.triggerFired !== null)}`);
  console.log(`  status stated     ${count((e) => e.status !== null)}  (legacy only)`);
  console.log(`  not computable    ${count((e) => !e.computable)}`);
}

if (require.main === module) main();

module.exports = { extract, numeric, triggerState, priorityRank, readBlockCells };
