/**
 * The period axis for the analytics cube.
 *
 * FACT_SALES carries `Month` ("January") and `MonthNum` (1-12) with no year, so
 * a window that crosses a year boundary — the workbook's Jan-25 through Jan-26
 * is exactly that — would collapse the two Januaries into one bucket. It also
 * carries `_meta.voucherDate`, a real ISO date, which is where the year lives.
 *
 * Two things matter here and both are load-bearing for the 160 analyses:
 *
 *   1. Periods are year-aware, keyed "YYYY-MM" so lexicographic order is
 *      chronological order. (Same convention as computeHistoricalBenchmarkData
 *      in companyData.service.js, which already slices dates to 7 chars.)
 *
 *   2. The axis is DENSE. A month with no sales must still appear, as a zero.
 *      A sparse axis silently breaks decline streaks, regresses slope over the
 *      wrong x-spacing, hides troughs from peak/trough, and makes contribution
 *      bridges net to the wrong total — every one of them failing quietly.
 *
 * This module does not touch deriveMonth or the FACT_SALES row contract; the
 * legacy 18-filter engine keeps its own month handling.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const MONTH_NAME_TO_NUM = new Map(MONTH_NAMES.map((name, i) => [name.toLowerCase(), i + 1]));

/**
 * Upper bound on axis length, so a bad date in the data can never make the
 * engine enumerate centuries of empty months. 50 years of monthly periods.
 */
const MAX_PERIODS = 600;

/** Year used when no row in the set carries a real date. See resolveRowPeriod. */
const SYNTHETIC_YEAR = 1900;

/* ------------------------------------------------------------------ */
/* Ordinals                                                            */
/* ------------------------------------------------------------------ */

/** (2025, 1) -> 24300. A dense integer so period arithmetic is plain +/-. */
function toOrdinal(year, monthNum) {
  return year * 12 + (monthNum - 1);
}

function fromOrdinal(ordinal) {
  return { year: Math.floor(ordinal / 12), monthNum: (ordinal % 12) + 1 };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Accepts the two date shapes this codebase actually produces:
 * ISO "2025-01-17" (from _meta.voucherDate) and compact "20250117" (from the
 * fromDate/toDate query params). Returns null on anything else.
 */
function parseDateParts(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { year: value.getUTCFullYear(), monthNum: value.getUTCMonth() + 1 };
  }

  const text = String(value).trim();
  if (!text) return null;

  let m = text.match(/^(\d{4})-(\d{2})/);
  if (!m) m = text.match(/^(\d{4})(\d{2})\d{2}$/);
  if (!m) return null;

  const year = Number(m[1]);
  const monthNum = Number(m[2]);
  if (!year || monthNum < 1 || monthNum > 12) return null;
  return { year, monthNum };
}

/** Month name or number, however the row happens to spell it. */
function parseMonthNum(row) {
  const num = Number(row && row.MonthNum);
  if (Number.isInteger(num) && num >= 1 && num <= 12) return num;

  const name = row && row.Month ? String(row.Month).trim().toLowerCase() : "";
  if (MONTH_NAME_TO_NUM.has(name)) return MONTH_NAME_TO_NUM.get(name);

  const abbr = MONTH_ABBR.findIndex((a) => a.toLowerCase() === name.slice(0, 3));
  return abbr >= 0 && name ? abbr + 1 : null;
}

/* ------------------------------------------------------------------ */
/* Period objects                                                      */
/* ------------------------------------------------------------------ */

/** Build the period descriptor the rest of the analytics layer passes around. */
function makePeriod(year, monthNum, index) {
  return {
    key: `${String(year).padStart(4, "0")}-${String(monthNum).padStart(2, "0")}`,
    label: `${MONTH_ABBR[monthNum - 1]}-${String(year % 100).padStart(2, "0")}`,
    monthName: MONTH_NAMES[monthNum - 1],
    monthNum,
    year,
    index
  };
}

/* ------------------------------------------------------------------ */
/* Row resolution                                                      */
/* ------------------------------------------------------------------ */

/**
 * The fallback ladder. Rows from the live pipeline always carry
 * `_meta.voucherDate`; hand-written test fixtures and the legacy engine's rows
 * do not, and must degrade rather than throw.
 *
 *   1. _meta.voucherDate            -> the real year
 *   2. MonthNum + modalYear         -> the year most rows in this set agree on
 *   3. MonthNum + SYNTHETIC_YEAR    -> MonthNum alone orders the axis, which is
 *                                      byte-identical to the legacy behaviour
 *
 * Steps 2 and 3 are counted, never guessed at silently.
 */
function resolveRowPeriod(row, modalYear) {
  if (!row) return null;

  const dated = parseDateParts(row._meta && row._meta.voucherDate);
  if (dated) return { ...dated, fallback: false };

  const monthNum = parseMonthNum(row);
  if (!monthNum) return null;

  return { year: modalYear === null ? SYNTHETIC_YEAR : modalYear, monthNum, fallback: true };
}

/** The year the majority of dated rows fall in, or null when none are dated. */
function findModalYear(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    const parts = parseDateParts(row && row._meta && row._meta.voucherDate);
    if (parts) counts.set(parts.year, (counts.get(parts.year) || 0) + 1);
  }
  if (!counts.size) return null;

  let best = null;
  let bestCount = -1;
  for (const [year, count] of counts) {
    if (count > bestCount || (count === bestCount && year < best)) {
      best = year;
      bestCount = count;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Axis                                                                */
/* ------------------------------------------------------------------ */

/**
 * Build the dense period axis.
 *
 * The requested window wins over the data: asking for 13 months whose final
 * month happens to have no sales must still return 13 periods, otherwise the
 * report silently answers a different question than the one asked. Where no
 * window is given, the axis spans the data's own min..max, still gap-filled.
 *
 * @param {Array<object>} rows        FACT_SALES rows
 * @param {object} [options]
 * @param {string} [options.fromDate] "YYYYMMDD" or ISO
 * @param {string} [options.toDate]
 * @returns {{ periods: object[], periodIndex: Map<string, object>, meta: object }}
 */
function buildPeriodAxis(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const modalYear = findModalYear(list);

  let dataMin = null;
  let dataMax = null;
  let periodsFromFallback = 0;
  let unresolvedRows = 0;

  for (const row of list) {
    const resolved = resolveRowPeriod(row, modalYear);
    if (!resolved) {
      unresolvedRows++;
      continue;
    }
    if (resolved.fallback) periodsFromFallback++;

    const ordinal = toOrdinal(resolved.year, resolved.monthNum);
    if (dataMin === null || ordinal < dataMin) dataMin = ordinal;
    if (dataMax === null || ordinal > dataMax) dataMax = ordinal;
  }

  const requestedFrom = parseDateParts(options.fromDate);
  const requestedTo = parseDateParts(options.toDate);
  const windowMin = requestedFrom ? toOrdinal(requestedFrom.year, requestedFrom.monthNum) : null;
  const windowMax = requestedTo ? toOrdinal(requestedTo.year, requestedTo.monthNum) : null;

  // The window is the anchor where given; the data fills in whichever end is not.
  let start = windowMin !== null ? windowMin : dataMin;
  let end = windowMax !== null ? windowMax : dataMax;

  // A window that excludes all the data would produce an axis of pure zeroes
  // with the real rows dropped, which is worse than widening to include them.
  if (start !== null && dataMin !== null && dataMin < start) start = dataMin;
  if (end !== null && dataMax !== null && dataMax > end) end = dataMax;

  if (start === null || end === null || end < start) {
    return {
      periods: [],
      periodIndex: new Map(),
      meta: {
        periodsFromFallback,
        unresolvedRows,
        legacyMonthCollision: false,
        truncated: false,
        requestedRange: { fromDate: options.fromDate || null, toDate: options.toDate || null }
      }
    };
  }

  const truncated = end - start + 1 > MAX_PERIODS;
  if (truncated) end = start + MAX_PERIODS - 1;

  const periods = [];
  const periodIndex = new Map();
  for (let ordinal = start, i = 0; ordinal <= end; ordinal++, i++) {
    const { year, monthNum } = fromOrdinal(ordinal);
    const period = makePeriod(year, monthNum, i);
    periods.push(period);
    periodIndex.set(period.key, period);
  }

  // True when the axis holds the same calendar month twice — the exact case the
  // legacy 18 filters merge into one bucket. Surfaced so the UI can say so.
  const monthNames = new Set();
  let legacyMonthCollision = false;
  for (const p of periods) {
    if (monthNames.has(p.monthName)) {
      legacyMonthCollision = true;
      break;
    }
    monthNames.add(p.monthName);
  }

  return {
    periods,
    periodIndex,
    meta: {
      periodsFromFallback,
      unresolvedRows,
      legacyMonthCollision,
      truncated,
      requestedRange: { fromDate: options.fromDate || null, toDate: options.toDate || null }
    }
  };
}

/** The period key for one row, or null when it cannot be placed on the axis. */
function rowPeriodKey(row, modalYear) {
  const resolved = resolveRowPeriod(row, modalYear);
  if (!resolved) return null;
  return `${String(resolved.year).padStart(4, "0")}-${String(resolved.monthNum).padStart(2, "0")}`;
}

module.exports = {
  MONTH_NAMES,
  MONTH_ABBR,
  MAX_PERIODS,
  SYNTHETIC_YEAR,
  toOrdinal,
  fromOrdinal,
  parseDateParts,
  parseMonthNum,
  makePeriod,
  resolveRowPeriod,
  findModalYear,
  buildPeriodAxis,
  rowPeriodKey
};
