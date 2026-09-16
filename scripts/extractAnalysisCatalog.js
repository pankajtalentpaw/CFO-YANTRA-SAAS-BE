/**
 * Codegen: MIS05 workbook -> src/analytics/engine/analysisCatalog.js
 *
 * The workbook is the specification for the 160-analysis Decision Intelligence
 * layer. Every *computed* cell in it is a live Excel formula, so this script
 * deliberately extracts only the STATIC half of each analysis — the title, the
 * business question, the management narrative and the prescribed actions. The
 * numbers, triggers, severities and priorities are recomputed at runtime from
 * FACT_SALES and are not lifted from here.
 *
 * Run:  node scripts/extractAnalysisCatalog.js [path-to-workbook]
 *
 * The output is committed and hand-reviewed. This script stays in the repo so
 * the catalog can be regenerated if the workbook is revised — it must remain
 * safe to re-run, which is why it never emits compute-function bindings. Those
 * live in the hand-written engine/registry.js and would be clobbered.
 */

const fs = require("fs");
const path = require("path");
const { readWorkbook } = require("./lib/xlsxReader");

const DEFAULT_WORKBOOK = "C:/Users/admin/Downloads/MIS05_DecisionIntelligence_v2 WITH 160 ANALYSIS.xlsx";
const OUT_PATH = path.join(__dirname, "..", "src", "analytics", "engine", "analysisCatalog.js");

/**
 * Sheet -> the two filters it documents. Table 1 is always the odd-numbered
 * filter, Table 2 the even one. These filter numbers are also the lens ids used
 * by the existing MIS Report 5 engine (lens 0 and 17 have no workbook sheet).
 */
const SHEET_FILTERS = {
  "07_CITY_TREND_GROWTH": [1, 2],
  "08_SUBCATEGORY_PERFORMANCE": [3, 4],
  "09_MONTH_MIX": [5, 6],
  "10_SUBCATEGORY_VS_SUBCATEGORY": [7, 8],
  "11_RISK_TOPCOMBO": [9, 10],
  "12_CONTRIBUTION_BRIDGE": [11, 12],
  "13_MONTH_VS_MONTH": [13, 14],
  "14_PEAK_TROUGH_FINDER": [15, 16]
};

const FILTER_NAMES = {
  1: "City Revenue Trend",
  2: "City Totals vs Equal-Share Benchmark",
  3: "City-Product Dependency Risk",
  4: "Within-Product City Balance",
  5: "Company Monthly Trend",
  6: "SubCategory Month Mix & Decline",
  7: "SubCategory Head-to-Head",
  8: "SubCategory Ranking by City",
  9: "Concentration Risk (HHI)",
  10: "Top SubCategory x City Combos",
  11: "Contribution Bridge by SubCategory",
  12: "Contribution Bridge by Month",
  13: "Month Head-to-Head",
  14: "Month Ranking by City",
  15: "Peak & Trough by SubCategory",
  16: "Peak & Trough by Month"
};

/**
 * Column-A labels that mark an envelope field rather than a metric-table row.
 * Three envelope formats coexist in the workbook (sheets 09-14 use the newest,
 * 07-08 an older one, and the filter-level blocks a narrative one); this set is
 * the union of all three.
 */
const ENVELOPE_LABELS = new Set([
  // Format A - sheets 09-14
  "Analysis ID", "Business Question", "Dimension / Grain", "Current Value",
  "Comparison Value", "Variance / Growth", "Trigger", "Severity",
  "Red Flag / Green Signal", "Financial Impact (\u20b9)", "COI \u2014 Cost of Inaction (\u20b9)",
  "Recovery Opportunity", "ROI", "3-Month View", "6-Month View", "Priority",
  "Management Understanding", "Recommended Action", "Action Owner", "Decision Type",
  // Format B - sheets 07-08
  "Best", "Worst", "Trigger Point", "Status", "Red Flag", "Owner Action",
  "Sales Manager Action", "ROI / Recovery Opportunity", "Cost of Inaction",
  "3-Month Consequence", "6-Month Consequence",
  // Format C - filter-level narrative blocks
  "Cost of Inaction & ROI", "Management Interpretation", "What To Do Next"
]);

/**
 * Analyses the workbook never gave a usable NAME.
 *
 * Every title in the catalog is the workbook's own heading, with these seven
 * exceptions. They are overridden because the heading does not identify the
 * analysis, which matters the moment 161 of them are listed in one UI:
 *
 *   - "See Sheet 07" is a cross-reference, not a name.
 *   - "Structural Note" appears on two different lenses, and describes the
 *     workbook's page layout rather than anything computed.
 *   - "Head-to-Head Gap Analysis" and "Head-to-Head Gap Magnitude" each appear
 *     twice, once for SubCategories and once for Months, so neither can be told
 *     apart in a search result or a dashboard row.
 *
 * Each replacement names what the analysis ACTUALLY computes — the builder it
 * is bound to is quoted so the two can be checked against each other. The
 * original heading is preserved on every entry as `workbookTitle`, so nothing
 * is lost and the substitution stays auditable.
 */
const TITLE_OVERRIDES = {
  // trend.companyTrend — the company's revenue across every month.
  "L05.A01": "Company Monthly Revenue Trend",
  // comparison.headToHeadGap { mode: product | month }
  "L07.A01": "SubCategory Head-to-Head Gap Analysis",
  "L13.A01": "Month Head-to-Head Gap Analysis",
  // comparison.gapMagnitude { mode: product | month }
  "L07.A04": "SubCategory Head-to-Head Gap Magnitude",
  "L13.A04": "Month Head-to-Head Gap Magnitude",
  // contribution.monthlyBridgeOverview — month-by-month movement in company revenue.
  "L12.A01": "Monthly Contribution Bridge Overview",
  // volatility.monthlyStructuralOverview — the company's peak and trough months.
  "L16.A01": "Company Monthly Peak & Trough Overview",
  // contribution.structuralLimitation — what this dataset's shape rules out.
  "L16.A10": "Monthly Data Coverage & Analytical Limits",

  // These three bake the SAMPLE company's shape into the name. A customer with
  // eight months and nine products is not running a "13-Month Linear Trend"
  // across "the 6 Products", and their latest month is not January 2026.
  "L01.A08": "City Trend Slope Analysis (Linear Trend)",
  "L04.A08": "Product Revenue Parity — How Equal Are the Products?",
  "L14.A05": "Latest vs Earliest Month Rank Comparison"
};

/**
 * Business questions that state the sample company's cardinality.
 *
 * The question is printed on the card under the title, so "Of the 4 cities..."
 * is read by a customer with twelve. Each replacement asks the identical
 * question without fixing the count; the workbook's original is preserved on
 * the entry as `workbookQuestion`.
 */
const DIMENSION_OVERRIDES = {
  // The grain is "SubCategory by month", not "by thirteen months".
  "L06.A09": "SubCategory × Month Trend"
};

const QUESTION_OVERRIDES = {
  "L01.A05": "Has the revenue mix across cities shifted over the period? Which city gained share and which lost share?",
  "L01.A08": "What is the mathematical trend direction and magnitude for each city over the full period?",
  "L01.A10": "How many cities are growing and how many are declining? If more are declining than growing, the problem is systemic rather than localised.",
  "L02.A05": "Which cities grew and which declined over the period? Simple grow/decline classification.",
  "L04.A10": "Of all the possible city x product combinations, how many are active and generating revenue?",
  "L12.A02": "Is company-level monthly revenue trending up or down across the period?",
  "L12.A08": "Which city contributed most to the overall revenue change?",
  "L14.A02": "How does the latest month rank on average across all cities?",
  "L14.A05": "Did the latest month rank better or worse than the earliest month in each city?",
  "L16.A05": "How many months fall below the period average?"
};

/* ------------------------------------------------------------------ */
/* Demo-data prose                                                     */
/* ------------------------------------------------------------------ */

/**
 * The workbook's prose is written ABOUT the workbook's own sample company.
 *
 * "New Delhi is unambiguously the highest-priority city for direct
 * intervention" is a true sentence about the demo data and a false one about
 * every real customer — and because most builders compute no `actions` of their
 * own, analysisBlock.js was falling back to exactly these sentences and
 * printing them on real reports. A firm in Pune and Surat was being told to act
 * on New Delhi.
 *
 * So any static sentence naming the sample company's cities, products, months
 * or rupee figures is dropped at extraction. The vocabulary is read out of
 * 01_RAW_DATA rather than typed here, so it stays correct if the workbook is
 * ever re-exported with different sample data.
 *
 * Threshold language survives on purpose: "above the 75% watch threshold"
 * describes the rule, not the sample, and is true for everyone.
 */
function buildDemoVocabulary(wb) {
  const raw = wb.sheets.find((s) => s.name === "01_RAW_DATA");
  const tokens = new Set();
  const counts = { cities: 0, groups: 0, months: 0 };
  if (!raw) return { tokens, counts };

  const header = (raw.rows[4] || []).map((c) => String(c || "").trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cityCol = col("City");
  const groupCol = col("SubCategory");
  const monthCol = col("Month");

  const distinct = { cities: new Set(), groups: new Set(), months: new Set() };
  for (let r = 5; r < raw.rows.length; r++) {
    const cells = raw.rows[r] || [];
    for (const [c, bucket] of [[cityCol, "cities"], [groupCol, "groups"], [monthCol, "months"]]) {
      if (c < 0) continue;
      const value = String(cells[c] || "").trim();
      if (!value) continue;
      distinct[bucket].add(value);
      if (value.length > 2) tokens.add(value);
    }
  }

  counts.cities = distinct.cities.size;
  counts.groups = distinct.groups.size;
  counts.months = distinct.months.size;
  return { tokens, counts };
}

/**
 * True when a sentence is about the sample company rather than about the
 * analysis. Matches on whole words so a product called "Chair" cannot strip a
 * sentence containing "Chairman".
 */
function makeDemoDetector({ tokens, counts }) {
  const escaped = [...tokens].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const entity = escaped.length ? new RegExp(`\\b(?:${escaped.join("|")})\\b`) : null;

  // A rupee figure in STATIC prose can only have come from the sample data.
  const rupees = /\u20b9\s?[\d,]+/;

  // So can its shape. "With 4 cities, perfect balance = 0.25" is arithmetic
  // about the sample, and is simply wrong for a company with ten cities.
  const combos = counts.cities * counts.groups;
  const shape = new RegExp([
    `\\b${counts.cities}\\s+cities\\b`,
    `\\b${counts.groups}\\s+products\\b`,
    `\\b${counts.months}[-\\s]month`,
    `\\ball ${counts.groups}\\b`,
    `\\bthe ${counts.groups} products\\b`,
    `\\b${combos}\\s+(?:possible\\s+)?combinations\\b`,
    `\\bof ${counts.cities}\\s+cities\\b`,
    `\\bacross (?:all )?${counts.cities}\\b`
  ].join("|"), "i");

  return (text) => {
    if (!text) return false;
    if (rupees.test(text)) return true;
    if (shape.test(text)) return true;
    return Boolean(entity && entity.test(text));
  };
}

/** Cells Excel could not evaluate. They are workbook bugs, never spec. */
function isExcelError(value) {
  return typeof value === "string" && /^#(VALUE|REF|DIV\/0|N\/A|NAME|NULL|NUM)[!?]/.test(value.trim());
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text || isExcelError(text)) return null;
  return text;
}

function trimRow(row) {
  const cells = (row || []).map((c) => (c === undefined ? "" : String(c)));
  while (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells;
}

/* ------------------------------------------------------------------ */
/* Block discovery                                                     */
/* ------------------------------------------------------------------ */

/**
 * Split a sheet into analysis blocks. A block starts at a row whose first cell
 * begins with "ANALYSIS #" (a numbered analysis) or "ANALYSIS --" (the
 * filter-level narrative block) and runs to the row before the next one.
 */
function findBlocks(rows) {
  const starts = [];
  for (let r = 1; r < rows.length; r++) {
    const first = (rows[r] && rows[r][0] ? String(rows[r][0]) : "").trim();
    if (first.startsWith("ANALYSIS #") || first.startsWith("ANALYSIS --")) {
      starts.push({ row: r, heading: first });
    }
  }
  return starts.map((s, i) => ({
    ...s,
    endRow: i + 1 < starts.length ? starts[i + 1].row - 1 : rows.length - 1
  }));
}

/** Read the label/value pairs and the first metric-table header out of one block. */
function readBlock(rows, block) {
  const fields = {};
  const tableHeaders = [];

  for (let r = block.row + 1; r <= block.endRow; r++) {
    const cells = trimRow(rows[r]);
    if (!cells.length) continue;
    const label = cells[0].trim();

    if (ENVELOPE_LABELS.has(label)) {
      // The narrative-format labels are section headings whose text sits on the
      // NEXT row rather than beside them.
      if (cells.length >= 2 && cells[1].trim()) {
        fields[label] = cells[1].trim();
      } else {
        const next = trimRow(rows[r + 1]);
        if (next.length === 1 && next[0].trim()) fields[label] = next[0].trim();
      }
      continue;
    }

    // Anything else with 3+ populated cells and no numbers is a metric-table
    // header row. We keep the first one purely as an implementation reference.
    if (!tableHeaders.length && cells.length >= 3 && cells.every((c) => c.trim() && !/^-?[\d.]+$/.test(c.trim()))) {
      tableHeaders.push(...cells.map((c) => c.trim()));
    }
  }
  return { fields, tableHeaders };
}

/** "ANALYSIS #4: Peak-to-Current Revenue Gap" -> { slot: 4, title: "Peak-to..." } */
function parseHeading(heading) {
  const numbered = heading.match(/^ANALYSIS\s+#(\d+)\s*:\s*(.+)$/);
  if (numbered) return { slot: Number(numbered[1]), title: numbered[2].trim() };

  // "ANALYSIS -- TABLE 1 (Filter 1): Consecutive Decline & Trend Momentum"
  const table = heading.match(/^ANALYSIS\s+--\s+TABLE\s+(\d+)\s*\(Filter\s+(\d+)\)\s*:\s*(.+)$/i);
  if (table) {
    return { slot: 1, title: table[3].trim(), tableNo: Number(table[1]), filterNo: Number(table[2]) };
  }
  return { slot: null, title: heading.replace(/^ANALYSIS\s*(--|#)?\s*/i, "").trim() };
}

/* ------------------------------------------------------------------ */
/* Filter attribution                                                  */
/* ------------------------------------------------------------------ */

/**
 * Assign each numbered block to its filter.
 *
 * Sheets 09-14 state it outright via "Analysis ID" (e.g. F09-A02). Sheets 07-08
 * do not, so we rely on layout: both filter-level blocks come first, then the
 * numbered blocks appear as two consecutive runs — the Table 1 filter's run
 * followed by the Table 2 filter's. The boundary is wherever the "#N" counter
 * stops increasing.
 */
function attributeFilters(blocks, [oddFilter, evenFilter]) {
  let run = 0;
  let previousSlot = Infinity;

  return blocks.map((block) => {
    const parsed = parseHeading(block.heading);

    if (parsed.filterNo) {
      // A filter-level block names its own filter; it is that filter's slot 1.
      return { ...block, ...parsed, lensId: parsed.filterNo, slot: 1 };
    }

    const declaredId = block.fields["Analysis ID"];
    if (declaredId) {
      const m = declaredId.match(/^F(\d+)-A(\d+)$/i);
      if (m) return { ...block, ...parsed, lensId: Number(m[1]), slot: Number(m[2]) };
    }

    if (parsed.slot !== null && parsed.slot <= previousSlot) run++;
    previousSlot = parsed.slot === null ? previousSlot : parsed.slot;
    return { ...block, ...parsed, lensId: run <= 1 ? oddFilter : evenFilter };
  });
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function extract(workbookPath) {
  const wb = readWorkbook(workbookPath);
  const isDemoProse = makeDemoDetector(buildDemoVocabulary(wb));
  const entries = [];
  let dropped = 0;

  /** Keep a sentence only if it is about the analysis, not the sample company. */
  const generic = (value) => {
    const text = clean(value);
    if (!text) return null;
    if (isDemoProse(text)) { dropped++; return null; }
    return text;
  };

  for (const sheet of wb.sheets) {
    const filters = SHEET_FILTERS[sheet.name];
    if (!filters) continue;

    const raw = findBlocks(sheet.rows).map((block) => ({ ...block, ...readBlock(sheet.rows, block) }));
    const flat = raw.map((b) => ({ ...b, fields: b.fields }));
    const attributed = attributeFilters(flat, filters);

    for (const block of attributed) {
      const f = block.fields;
      const id = `L${String(block.lensId).padStart(2, "0")}.A${String(block.slot).padStart(2, "0")}`;
      entries.push({
        id,
        lensId: block.lensId,
        lensName: FILTER_NAMES[block.lensId] || null,
        slot: block.slot,
        title: TITLE_OVERRIDES[id] || block.title,
        // The workbook's own heading, kept whenever it was replaced above.
        workbookTitle: TITLE_OVERRIDES[id] ? block.title : undefined,
        question: QUESTION_OVERRIDES[id] || clean(f["Business Question"]),
        workbookQuestion: QUESTION_OVERRIDES[id] ? clean(f["Business Question"]) : undefined,
        dimension: DIMENSION_OVERRIDES[id] || clean(f["Dimension / Grain"]),
        // Narrative and actions are shown verbatim on a real company's report,
        // so anything written about the sample company is dropped rather than
        // shipped. Builders compute their own from live data.
        narrative: generic(f["Management Understanding"] || f["Management Interpretation"]),
        recommendedAction: generic(f["Recommended Action"] || f["What To Do Next"]),
        ownerAction: generic(f["Owner Action"]),
        salesManagerAction: generic(f["Sales Manager Action"]),
        actionOwner: clean(f["Action Owner"]),
        decisionType: clean(f["Decision Type"]),
        // Reference only. Format B states the rule ("Gap > 20% = AMBER"); format A
        // states the already-evaluated outcome. Real thresholds are authored in
        // engine/triggerThresholds.js, never parsed out of these strings.
        sourceTrigger: clean(f["Trigger Point"] || f["Trigger"]),
        sourceTableHeaders: block.tableHeaders.length ? block.tableHeaders : null,
        source: "workbook",
        provenance: { sheet: sheet.name, row: block.row, workbookId: clean(f["Analysis ID"]) }
      });
    }
  }

  entries.sort((a, b) => (a.lensId - b.lensId) || (a.slot - b.slot));
  entries.demoProseDropped = dropped;
  return entries;
}

function render(entries) {
  const byLens = new Map();
  for (const e of entries) {
    if (!byLens.has(e.lensId)) byLens.set(e.lensId, []);
    byLens.get(e.lensId).push(e);
  }

  const summary = [...byLens.entries()]
    .map(([lens, list]) => ` *   L${String(lens).padStart(2, "0")}  ${String(list.length).padStart(2)} analyses  ${FILTER_NAMES[lens]}`)
    .join("\n");

  const body = [...byLens.entries()].map(([lens, list]) => {
    const header = `  // ${"-".repeat(74)}\n  // Lens ${lens} \u2014 ${FILTER_NAMES[lens]}\n  // ${"-".repeat(74)}`;
    return `${header}\n${list.map((e) => `  ${JSON.stringify(e)}`).join(",\n")}`;
  }).join(",\n\n");

  return `/**
 * GENERATED FILE \u2014 do not edit by hand.
 *
 * Produced by scripts/extractAnalysisCatalog.js from
 * "MIS05_DecisionIntelligence_v2 WITH 160 ANALYSIS.xlsx".
 * Re-run that script to regenerate; hand edits will be lost.
 *
 * This is the STATIC half of each analysis only \u2014 titles, questions and the
 * management narrative. Seven titles are overridden where the workbook's own
 * heading did not name the analysis (a cross-reference, or a name reused on two
 * lenses); those entries carry the original as \`workbookTitle\`. Every number, trigger, severity and priority is
 * recomputed at runtime from FACT_SALES; nothing numeric is lifted from the
 * workbook. Compute-function bindings live in the hand-written registry.js.
 *
 * Extracted: ${entries.length} analyses across ${byLens.size} lenses.
${summary}
 */

const ANALYSIS_CATALOG = [
${body}
];

module.exports = { ANALYSIS_CATALOG };
`;
}

function main() {
  const workbookPath = process.argv[2] || DEFAULT_WORKBOOK;
  if (!fs.existsSync(workbookPath)) {
    console.error(`Workbook not found: ${workbookPath}`);
    console.error("Usage: node scripts/extractAnalysisCatalog.js [path-to-workbook]");
    process.exit(1);
  }

  const entries = extract(workbookPath);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, render(entries), "utf8");

  const byLens = new Map();
  for (const e of entries) byLens.set(e.lensId, (byLens.get(e.lensId) || 0) + 1);

  console.log(`Extracted ${entries.length} analyses -> ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log(`  dropped ${entries.demoProseDropped} sentences written about the workbook's sample company`);
  for (let lens = 1; lens <= 16; lens++) {
    const n = byLens.get(lens) || 0;
    const gap = n < 10 ? `  <-- ${10 - n} short of the 10-slot grid` : "";
    console.log(`  L${String(lens).padStart(2, "0")}  ${String(n).padStart(2)}  ${FILTER_NAMES[lens]}${gap}`);
  }
}

if (require.main === module) main();

// Block discovery and the sheet/lens maps are shared with
// extractAnalysisExpectations.js, which reads the same blocks for their
// computed values rather than their prose.
module.exports = {
  extract,
  findBlocks,
  readBlock,
  parseHeading,
  attributeFilters,
  isExcelError,
  clean,
  trimRow,
  SHEET_FILTERS,
  FILTER_NAMES,
  ENVELOPE_LABELS,
  TITLE_OVERRIDES,
  QUESTION_OVERRIDES,
  DIMENSION_OVERRIDES
};
