/**
 * The AnalysisBlock contract.
 *
 * All 160 analyses return this one shape. That is what makes the layer
 * tractable: the frontend has a single card component and a single table
 * renderer, and adding analysis 161 costs no frontend code at all.
 *
 * Two fields carry the design:
 *
 *   - `table.columns` is DATA, not code. The renderer maps over the columns the
 *     API sent and formats each cell by the declared `format`. Nothing on the
 *     client switches on which analysis it is looking at.
 *
 *   - `id` is a stable "L<lens>.A<slot>" that never gets renumbered, so deep
 *     links, saved preferences and tests survive reordering the catalog.
 *
 * Everything here is JSON-safe. Decimals are converted at this boundary and
 * nowhere else; upstream of makeBlock the whole layer stays in Decimal.
 */

const { toNumber, toFraction } = require("../compute/shared/money");

/** Traffic light. IDLE means "not enough data to judge", never "fine". */
const STATUS = Object.freeze({
  GREEN: "GREEN",
  AMBER: "AMBER",
  RED: "RED",
  IDLE: "IDLE"
});

/** The workbook's severity vocabulary, verbatim. */
const SEVERITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL"
});

/**
 * Priority 1..5 as an integer so dashboards can sort on it. The workbook's
 * label strings ("P1 — IMMEDIATE") are derived from it for display, rather
 * than being the source of truth — sorting on prose is how P1 — CRITICAL and
 * P1 — IMMEDIATE ended up as two different things in the spreadsheet.
 */
const PRIORITY_LABELS = Object.freeze({
  1: "P1 — IMMEDIATE",
  2: "P2 — HIGH",
  3: "P3 — MEDIUM",
  4: "P4 — LOW",
  5: "P5 — MONITOR"
});

/** Which compute family an analysis belongs to; mirrors compute/<family>/. */
const FAMILY = Object.freeze({
  TREND: "trend",
  CONCENTRATION: "concentration",
  COMPARISON: "comparison",
  CONTRIBUTION: "contribution",
  VOLATILITY: "volatility",
  COVERAGE: "coverage"
});

/** How the frontend renders a cell. Adding one here requires a renderer case. */
const FORMAT = Object.freeze({
  CURRENCY: "currency",
  PERCENT: "percent",
  PP: "pp",
  NUMBER: "number",
  RATIO: "ratio",
  MONTH: "month",
  TEXT: "text",
  STATUS: "status"
});

const VALID_STATUSES = new Set(Object.values(STATUS));
const VALID_SEVERITIES = new Set(Object.values(SEVERITY));
const VALID_FORMATS = new Set(Object.values(FORMAT));
const VALID_FAMILIES = new Set(Object.values(FAMILY));

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

/** Drop undefined so the JSON envelope stays tight and diffable. */
function compact(object) {
  const out = {};
  for (const [k, v] of Object.entries(object)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Assemble a block. Callers pass Decimals freely; this is where they become
 * numbers.
 *
 * @param {object} catalogEntry the static half, from analysisCatalog.js
 * @param {object} computed     the runtime half
 */
function makeBlock(catalogEntry, computed = {}) {
  const {
    status = STATUS.IDLE,
    severity = SEVERITY.LOW,
    priority = 4,
    trigger = null,
    redFlag = null,
    headline = null,
    table = null,
    narrative = null,
    actions = null,
    costOfInaction = null,
    horizon = null,
    provenance = {}
  } = computed;

  return compact({
    id: catalogEntry.id,
    lensId: catalogEntry.lensId,
    slot: catalogEntry.slot,
    title: catalogEntry.title,
    question: catalogEntry.question || null,
    family: catalogEntry.family || null,
    dimension: catalogEntry.dimension || null,

    status,
    severity,
    priority,
    priorityLabel: PRIORITY_LABELS[priority] || PRIORITY_LABELS[4],

    trigger,
    redFlag,
    headline,
    table,

    // Narrative falls back to the workbook's own text when a builder has no
    // data-specific interpretation to offer. Never LLM-generated: these 160
    // must be deterministic and reproducible for audit.
    narrative: narrative || catalogEntry.narrative || null,
    actions: actions || defaultActions(catalogEntry),

    costOfInaction,
    horizon,

    provenance: {
      source: catalogEntry.source || "workbook",
      derived: catalogEntry.source === "designed" || undefined,
      ...provenance
    }
  });
}

/** The catalog's own prescribed actions, when a builder computes none. */
function defaultActions(catalogEntry) {
  const owner = [];
  const salesManager = [];

  if (catalogEntry.ownerAction) owner.push({ text: catalogEntry.ownerAction, horizon: "3M" });
  else if (catalogEntry.recommendedAction && catalogEntry.actionOwner !== "Sales Manager") {
    owner.push({ text: catalogEntry.recommendedAction, horizon: "3M" });
  }

  if (catalogEntry.salesManagerAction) salesManager.push({ text: catalogEntry.salesManagerAction, horizon: "3M" });
  else if (catalogEntry.recommendedAction && catalogEntry.actionOwner === "Sales Manager") {
    salesManager.push({ text: catalogEntry.recommendedAction, horizon: "3M" });
  }

  return { owner, salesManager };
}

/** A headline metric: the one number the card leads with. */
function makeHeadline({ label, value, formatted, unit = null, delta = null, deltaFormatted = null }) {
  return compact({
    label,
    value: value === null || value === undefined ? null : value,
    valueFormatted: formatted || null,
    unit,
    delta: delta === null || delta === undefined ? null : delta,
    deltaFormatted
  });
}

/**
 * A metric table. `columns` declares the shape; `rows` are plain objects keyed
 * by column key. `_status` tints a row, `_drill` makes its first cell a
 * drill-through into the existing entry detail modal.
 */
function makeTable({ columns, rows, totalsRow = null, note = null }) {
  return compact({
    columns: columns.map((c) => compact({
      key: c.key,
      label: c.label,
      align: c.align || (c.format === FORMAT.TEXT || c.format === FORMAT.MONTH ? "left" : "right"),
      format: c.format || FORMAT.TEXT
    })),
    rows,
    totalsRow,
    note
  });
}

/** Cost of inaction, with the basis spelled out so it can be argued with. */
function makeCostOfInaction({ amount, formatted, basis, horizonMonths = 3 }) {
  return compact({
    amount: toNumber(amount),
    amountFormatted: formatted || null,
    basis: basis || null,
    horizonMonths
  });
}

/* ------------------------------------------------------------------ */
/* Contract enforcement                                                */
/* ------------------------------------------------------------------ */

/**
 * Assert a block satisfies the contract, returning the problems rather than
 * throwing so a whole-registry sweep can report every offender at once.
 *
 * This is the load-bearing test for the layer: 160 hand-written analyses stay
 * honest because every one of them is run through this.
 */
function validateBlock(block) {
  const problems = [];
  const fail = (msg) => problems.push(msg);

  if (!block || typeof block !== "object") return ["block is not an object"];

  if (!/^L\d{2}\.A\d{2}$/.test(block.id || "")) fail(`id "${block.id}" is not L<nn>.A<nn>`);
  if (!Number.isInteger(block.lensId) || block.lensId < 0 || block.lensId > 17) fail(`lensId ${block.lensId} out of range 0-17`);
  if (!Number.isInteger(block.slot) || block.slot < 1) fail(`slot ${block.slot} is not a positive integer`);
  if (!block.title) fail("title is empty");

  if (!VALID_STATUSES.has(block.status)) fail(`status "${block.status}" is not a valid status`);
  if (!VALID_SEVERITIES.has(block.severity)) fail(`severity "${block.severity}" is not a valid severity`);
  if (!Number.isInteger(block.priority) || block.priority < 1 || block.priority > 5) fail(`priority ${block.priority} out of range 1-5`);
  if (block.family && !VALID_FAMILIES.has(block.family)) fail(`family "${block.family}" is not a known family`);

  if (block.headline) {
    if (!block.headline.label) fail("headline has no label");
    assertJsonSafe(block.headline.value, "headline.value", fail);
  }

  if (block.table) {
    const { columns, rows } = block.table;
    if (!Array.isArray(columns) || !columns.length) fail("table has no columns");
    else {
      for (const c of columns) {
        if (!c.key) fail("a table column has no key");
        if (!VALID_FORMATS.has(c.format)) fail(`column "${c.key}" has unknown format "${c.format}"`);
      }
    }
    if (!Array.isArray(rows)) fail("table.rows is not an array");
    else {
      const keys = new Set((columns || []).map((c) => c.key));
      rows.forEach((row, i) => {
        for (const [k, v] of Object.entries(row)) {
          if (k.startsWith("_")) continue;
          if (!keys.has(k)) fail(`row ${i} has key "${k}" with no matching column`);
          assertJsonSafe(v, `row ${i}.${k}`, fail);
        }
      });
    }
  }

  if (block.costOfInaction) assertJsonSafe(block.costOfInaction.amount, "costOfInaction.amount", fail);
  if (block.actions) {
    if (!Array.isArray(block.actions.owner)) fail("actions.owner is not an array");
    if (!Array.isArray(block.actions.salesManager)) fail("actions.salesManager is not an array");
  }

  return problems;
}

/** No Decimals, NaN or Infinity may cross the JSON boundary. */
function assertJsonSafe(value, path, fail) {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} is ${value}`);
    return;
  }
  if (value && typeof value === "object" && typeof value.toFixed === "function" && typeof value.dividedBy === "function") {
    fail(`${path} is a Decimal that was never converted for JSON`);
    return;
  }
  fail(`${path} is a ${typeof value}, which is not JSON-safe here`);
}

/** Throwing form, for use inside builders during development. */
function assertBlockShape(block) {
  const problems = validateBlock(block);
  if (problems.length) {
    throw new Error(`Block ${block && block.id} violates the contract:\n  - ${problems.join("\n  - ")}`);
  }
  return block;
}

module.exports = {
  STATUS,
  SEVERITY,
  FAMILY,
  FORMAT,
  PRIORITY_LABELS,
  makeBlock,
  makeHeadline,
  makeTable,
  makeCostOfInaction,
  validateBlock,
  assertBlockShape,
  toNumber,
  toFraction
};
