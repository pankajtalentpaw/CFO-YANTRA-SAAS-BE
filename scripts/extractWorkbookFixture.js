/**
 * Codegen: MIS05 workbook -> tests/analytics/fixtures/workbook.js
 *
 * The workbook's 156-row 01_RAW_DATA is the golden dataset for the analytics
 * layer, and its 02_MAIN_MIS pivot is the expected output. Transcribing 156
 * rows and 24 pivot rows by hand would introduce exactly the kind of error the
 * fixture exists to catch, so both are generated.
 *
 * Run:  node scripts/extractWorkbookFixture.js [path-to-workbook]
 *
 * Grain note: the workbook's "SubCategory" column is the Stock Group (see
 * 04_TALLY_DATA_MAPPING — "Stock Item's parent Stock Group"), which in a real
 * FACT_SALES row lives in `Category`, not `SubCategory`. The emitted rows use
 * the backend's field names so the fixture can be fed straight to the cube.
 */

const fs = require("fs");
const path = require("path");
const { readWorkbook } = require("./lib/xlsxReader");

const DEFAULT_WORKBOOK = "C:/Users/admin/Downloads/MIS05_DecisionIntelligence_v2 WITH 160 ANALYSIS.xlsx";
const OUT_PATH = path.join(__dirname, "..", "tests", "analytics", "fixtures", "workbook.js");

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

/** "Jan-25" -> { year: 2025, monthNum: 1 }. The workbook's only date format. */
function parseWorkbookMonth(label) {
  const m = String(label || "").trim().match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const monthNum = MONTH_ABBR.findIndex((a) => a.toLowerCase() === m[1].toLowerCase()) + 1;
  if (!monthNum) return null;
  return { year: 2000 + Number(m[2]), monthNum };
}

const num = (v) => {
  const n = Number(String(v == null ? "" : v).trim());
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------------ */

function extractFacts(sheet) {
  const rows = sheet.rows;
  // Row 4 is the header; data runs to the end of the sheet.
  const facts = [];

  for (let r = 5; r < rows.length; r++) {
    const cells = rows[r] || [];
    const rowId = num(cells[0]);
    const group = String(cells[1] || "").trim();
    const city = String(cells[2] || "").trim();
    const monthLabel = String(cells[3] || "").trim();
    const amount = num(cells[5]);

    if (!rowId || !group || !city || amount === null) continue;
    const parsed = parseWorkbookMonth(monthLabel);
    if (!parsed) continue;

    facts.push({
      RowID: String(rowId),
      // The workbook's SubCategory axis IS the Stock Group -> Category.
      Category: group,
      // Real rows carry a stock item here; the workbook has no item detail, so
      // it mirrors the group. Analytics never reads this field.
      SubCategory: group,
      City: city,
      Month: MONTH_NAMES[parsed.monthNum - 1],
      MonthNum: parsed.monthNum,
      SalesAmount: String(amount),
      _meta: {
        // Mid-month, so no timezone handling can shift it into a neighbour.
        voucherDate: `${parsed.year}-${String(parsed.monthNum).padStart(2, "0")}-15`,
        isCredit: false
      }
    });
  }
  return facts;
}

function extractMainMis(sheet) {
  const rows = sheet.rows;
  const header = rows[4] || [];
  const months = [];
  for (let c = 2; c < header.length; c++) {
    const label = String(header[c] || "").trim();
    if (!parseWorkbookMonth(label)) break;
    months.push(label);
  }

  const firstDerived = 2 + months.length;
  const combos = [];

  for (let r = 5; r < rows.length; r++) {
    const cells = rows[r] || [];
    const group = String(cells[0] || "").trim();
    const city = String(cells[1] || "").trim();
    if (!group || !city) continue;

    const monthly = {};
    months.forEach((label, i) => { monthly[label] = num(cells[2 + i]) || 0; });

    combos.push({
      subCategory: group,
      city,
      monthly,
      total: num(cells[firstDerived]) || 0,
      contributionPct: num(cells[firstDerived + 1]),
      rank: num(cells[firstDerived + 2]),
      topMonth: String(cells[firstDerived + 3] || "").trim() || null,
      topSharePct: num(cells[firstDerived + 4]),
      hhi: num(cells[firstDerived + 7]),
      diversificationScore: num(cells[firstDerived + 8])
    });
  }
  return { months, combos };
}

/* ------------------------------------------------------------------ */

function main() {
  const workbookPath = process.argv[2] || DEFAULT_WORKBOOK;
  if (!fs.existsSync(workbookPath)) {
    console.error(`Workbook not found: ${workbookPath}`);
    process.exit(1);
  }

  const wb = readWorkbook(workbookPath);
  const rawSheet = wb.sheets.find((s) => s.name === "01_RAW_DATA");
  const misSheet = wb.sheets.find((s) => s.name === "02_MAIN_MIS");
  if (!rawSheet || !misSheet) throw new Error("Workbook is missing 01_RAW_DATA or 02_MAIN_MIS");

  const facts = extractFacts(rawSheet);
  const mainMis = extractMainMis(misSheet);

  const grandTotal = facts.reduce((s, f) => s + Number(f.SalesAmount), 0);
  const pivotTotal = mainMis.combos.reduce((s, c) => s + c.total, 0);

  const cities = [...new Set(facts.map((f) => f.City))].sort();
  const groups = [...new Set(facts.map((f) => f.Category))].sort();

  const out = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by scripts/extractWorkbookFixture.js from
 * "MIS05_DecisionIntelligence_v2 WITH 160 ANALYSIS.xlsx".
 *
 * WORKBOOK_FACTS is 01_RAW_DATA shaped as FACT_SALES rows. The workbook's
 * "SubCategory" column is the parent Stock Group (04_TALLY_DATA_MAPPING), so it
 * is emitted as \`Category\` — the field the analytics cube reads.
 *
 * EXPECTED_MAIN_MIS is the 02_MAIN_MIS pivot the cube must reproduce.
 *
 *   facts:        ${facts.length} rows
 *   grand total:  ${grandTotal}
 *   pivot rows:   ${mainMis.combos.length} (${mainMis.months.length} months)
 *   pivot total:  ${pivotTotal}
 *   cities:       ${cities.join(", ")}
 *   stock groups: ${groups.join(", ")}
 */

const WORKBOOK_FACTS = [
${facts.map((f) => `  ${JSON.stringify(f)}`).join(",\n")}
];

const WORKBOOK_MONTHS = ${JSON.stringify(mainMis.months)};

const EXPECTED_MAIN_MIS = [
${mainMis.combos.map((c) => `  ${JSON.stringify(c)}`).join(",\n")}
];

const WORKBOOK_TOTALS = {
  grandTotal: ${grandTotal},
  factRowCount: ${facts.length},
  cities: ${JSON.stringify(cities)},
  stockGroups: ${JSON.stringify(groups)},
  months: ${mainMis.months.length}
};

module.exports = { WORKBOOK_FACTS, WORKBOOK_MONTHS, EXPECTED_MAIN_MIS, WORKBOOK_TOTALS };
`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, out, "utf8");

  console.log(`Fixture written -> ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log(`  facts        ${facts.length} rows, total ${grandTotal}`);
  console.log(`  pivot        ${mainMis.combos.length} combos, total ${pivotTotal}`);
  console.log(`  months       ${mainMis.months.length} (${mainMis.months[0]} .. ${mainMis.months[mainMis.months.length - 1]})`);
  console.log(`  cities       ${cities.join(", ")}`);
  console.log(`  stockGroups  ${groups.join(", ")}`);
  if (grandTotal !== pivotTotal) {
    console.error(`  WARNING: raw total ${grandTotal} != pivot total ${pivotTotal}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { extractFacts, extractMainMis, parseWorkbookMonth };
