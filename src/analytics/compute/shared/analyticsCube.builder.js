/**
 * The analytics cube: FACT_SALES rows -> dense, year-aware, Stock-Group-grained
 * aggregates that the 160 analyses read.
 *
 * Deliberately separate from buildMisCube in misReport5.engine.js. That cube
 * serves the legacy 18 filters and cannot change without rippling through their
 * tests, and the frontend. This one differs in three ways
 * that the workbook spec requires:
 *
 *   1. GRAIN. The workbook's "SubCategory" axis is the parent Stock Group
 *      (04_TALLY_DATA_MAPPING: "Stock Item's parent Stock Group"), which in a
 *      FACT_SALES row is `Category`. The legacy cube groups by `SubCategory`,
 *      the stock ITEM. Same source rows, different axis; both are kept, with
 *      the item axis available for drill-down only.
 *
 *   2. PERIODS. Dense and year-aware — see period.js. The legacy cube keys
 *      months by bare name, so a 13-month window merges its two Januaries.
 *
 *   3. RETURNS. Credit notes are netted off rather than added. The canonical
 *      parser stores inventory amounts as magnitudes and keeps the sign in
 *      `isCredit` (salesVoucher.canonical.js), and the builder does not apply
 *      it — so sales returns currently inflate revenue. 05_TALLY_EXTRACTION_SPEC
 *      requires "net off Returns", so this cube applies the flag.
 *
 * Both directions of every two-dimension matrix are built explicitly. The
 * citySubCategoryMatrix bug in the legacy filters exists precisely because one
 * direction was assumed to imply the other.
 */

const { Decimal, toDecimal } = require("./money");
const { buildPeriodAxis, findModalYear, resolveRowPeriod } = require("./period");
const { resolveCity } = require("../../../integrations/tally/sales/misReport5/misReport5.engine");

const UNCATEGORISED = "Uncategorised";
const UNATTRIBUTED = "Unattributed";

/* ------------------------------------------------------------------ */
/* Map helpers                                                         */
/* ------------------------------------------------------------------ */

function addTo(map, key, amount) {
  map.set(key, (map.get(key) || new Decimal(0)).plus(amount));
}

function addToNested(map, outerKey, innerKey, amount) {
  if (!map.has(outerKey)) map.set(outerKey, new Map());
  addTo(map.get(outerKey), innerKey, amount);
}

/** Read a nested matrix cell, always as a Decimal. Missing means zero, not undefined. */
function cell(matrix, outerKey, innerKey) {
  const inner = matrix.get(outerKey);
  if (!inner) return new Decimal(0);
  return inner.get(innerKey) || new Decimal(0);
}

/** Descending by total, then alphabetical, so ordering is stable across runs. */
function sortByTotal(totals) {
  return [...totals.keys()].sort((a, b) => {
    const cmp = totals.get(b).comparedTo(totals.get(a));
    return cmp !== 0 ? cmp : a.localeCompare(b);
  });
}

/* ------------------------------------------------------------------ */
/* Row reading                                                         */
/* ------------------------------------------------------------------ */

/**
 * The signed amount for one row.
 *
 * `SalesAmount` is a decimal STRING holding a magnitude. Whether it was a
 * credit — a sales return — is recorded separately, either on the row's _meta
 * or on the row itself depending on which path produced it.
 */
function signedAmount(row) {
  const magnitude = toDecimal(row.SalesAmount || 0);
  const isCredit = Boolean((row._meta && row._meta.isCredit) || row.isCredit);
  return isCredit ? magnitude.negated() : magnitude;
}

function labelOf(value, fallback) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || fallback;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<object>} rows FACT_SALES rows
 * @param {object} [options]
 * @param {string} [options.fromDate] "YYYYMMDD" — anchors the period axis
 * @param {string} [options.toDate]
 * @param {boolean} [options.netReturns=true] apply isCredit as a negative
 */
function buildAnalyticsCube(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const netReturns = options.netReturns !== false;

  const axis = buildPeriodAxis(list, options);
  const modalYear = findModalYear(list);

  const cityTotals = new Map();
  const groupTotals = new Map();
  const itemTotals = new Map();
  const periodTotals = new Map();
  const salesmanTotals = new Map();
  const customerTotals = new Map();

  const cityPeriod = new Map();
  const groupPeriod = new Map();
  const cityGroup = new Map();
  const groupCity = new Map();
  const salesmanPeriod = new Map();
  const customerPeriod = new Map();
  const cityGroupPeriod = new Map(); // "city||group" -> period -> amount
  const groupItem = new Map();

  let total = new Decimal(0);
  let rowsCounted = 0;
  let rowsOffAxis = 0;
  let creditRows = 0;
  let creditAmount = new Decimal(0);

  for (const row of list) {
    if (!row) continue;

    const resolved = resolveRowPeriod(row, modalYear);
    if (!resolved) {
      rowsOffAxis++;
      continue;
    }
    const periodKey = `${String(resolved.year).padStart(4, "0")}-${String(resolved.monthNum).padStart(2, "0")}`;
    if (!axis.periodIndex.has(periodKey)) {
      // Only reachable when the axis was truncated by MAX_PERIODS.
      rowsOffAxis++;
      continue;
    }

    const raw = signedAmount(row);
    if (raw.isNegative()) {
      creditRows++;
      creditAmount = creditAmount.plus(raw.abs());
    }
    const amount = netReturns ? raw : raw.abs();
    if (amount.isZero()) continue;

    const city = resolveCity(row);
    const group = labelOf(row.Category, UNCATEGORISED);
    const item = labelOf(row.SubCategory, UNCATEGORISED);
    const salesman = labelOf(row.Salesman, UNATTRIBUTED);
    const customer = labelOf(row.Customer, UNATTRIBUTED);

    total = total.plus(amount);
    rowsCounted++;

    addTo(cityTotals, city, amount);
    addTo(groupTotals, group, amount);
    addTo(itemTotals, item, amount);
    addTo(periodTotals, periodKey, amount);
    addTo(salesmanTotals, salesman, amount);
    addTo(customerTotals, customer, amount);

    addToNested(cityPeriod, city, periodKey, amount);
    addToNested(groupPeriod, group, periodKey, amount);
    addToNested(cityGroup, city, group, amount);
    addToNested(groupCity, group, city, amount);
    addToNested(salesmanPeriod, salesman, periodKey, amount);
    addToNested(customerPeriod, customer, periodKey, amount);
    addToNested(cityGroupPeriod, `${city}||${group}`, periodKey, amount);
    addToNested(groupItem, group, item, amount);
  }

  // Every period on the axis gets an entry, including the empty ones. Analyses
  // read these as series and must not have to distinguish "zero" from "absent".
  for (const period of axis.periods) {
    if (!periodTotals.has(period.key)) periodTotals.set(period.key, new Decimal(0));
  }

  const cities = sortByTotal(cityTotals);
  const groups = sortByTotal(groupTotals);
  const items = sortByTotal(itemTotals);
  const salesmen = sortByTotal(salesmanTotals);
  const customers = sortByTotal(customerTotals);

  const cube = {
    periods: axis.periods,
    periodIndex: axis.periodIndex,
    periodKeys: axis.periods.map((p) => p.key),

    cities,
    groups,
    items,
    salesmen,
    customers,

    totals: {
      total,
      byCity: cityTotals,
      byGroup: groupTotals,
      byItem: itemTotals,
      byPeriod: periodTotals,
      bySalesman: salesmanTotals,
      byCustomer: customerTotals
    },

    matrix: {
      cityPeriod,
      groupPeriod,
      cityGroup,
      groupCity,
      salesmanPeriod,
      customerPeriod,
      cityGroupPeriod,
      groupItem
    },

    meta: {
      rowCount: list.length,
      rowsCounted,
      rowsOffAxis,
      creditRows,
      creditAmount,
      netReturns,
      periodsFromFallback: axis.meta.periodsFromFallback,
      unresolvedRows: axis.meta.unresolvedRows,
      legacyMonthCollision: axis.meta.legacyMonthCollision,
      truncated: axis.meta.truncated,
      requestedRange: axis.meta.requestedRange
    }
  };

  return attachAccessors(cube);
}

/* ------------------------------------------------------------------ */
/* Accessors                                                           */
/* ------------------------------------------------------------------ */

/**
 * Series readers, bound to the cube.
 *
 * Every analysis works on series aligned to the period axis, so these return a
 * dense array of length periods.length with zeroes for empty periods. Without
 * that, streaks and regressions silently skip months.
 */
function attachAccessors(cube) {
  const keys = cube.periodKeys;

  const seriesFrom = (matrix, entity) => keys.map((k) => cell(matrix, entity, k));

  return Object.assign(cube, {
    /** Company revenue per period. */
    companySeries() {
      return keys.map((k) => cube.totals.byPeriod.get(k) || new Decimal(0));
    },
    citySeries(city) {
      return seriesFrom(cube.matrix.cityPeriod, city);
    },
    groupSeries(group) {
      return seriesFrom(cube.matrix.groupPeriod, group);
    },
    salesmanSeries(salesman) {
      return seriesFrom(cube.matrix.salesmanPeriod, salesman);
    },
    /** One product-city combo across the period axis. */
    comboSeries(city, group) {
      return seriesFrom(cube.matrix.cityGroupPeriod, `${city}||${group}`);
    },
    /** Revenue for one city x group pair over the whole window. */
    comboTotal(city, group) {
      return cell(cube.matrix.cityGroup, city, group);
    },
    cityTotal(city) {
      return cube.totals.byCity.get(city) || new Decimal(0);
    },
    groupTotal(group) {
      return cube.totals.byGroup.get(group) || new Decimal(0);
    },
    periodTotal(periodKey) {
      return cube.totals.byPeriod.get(periodKey) || new Decimal(0);
    },
    cityPeriodRevenue(city, periodKey) {
      return cell(cube.matrix.cityPeriod, city, periodKey);
    },
    groupPeriodRevenue(group, periodKey) {
      return cell(cube.matrix.groupPeriod, group, periodKey);
    },
    cityGroupRevenue(city, group) {
      return cell(cube.matrix.cityGroup, city, group);
    },
    groupCityRevenue(group, city) {
      return cell(cube.matrix.groupCity, group, city);
    },
    periodCityTotal(periodKey, city) {
      return cell(cube.matrix.cityPeriod, city, periodKey);
    },
    periodGroupTotal(periodKey, group) {
      return cell(cube.matrix.groupPeriod, group, periodKey);
    },
    /** Groups that actually sold in a city, strongest first. */
    activeGroupsInCity(city) {
      const inner = cube.matrix.cityGroup.get(city);
      if (!inner) return [];
      return [...inner.entries()]
        .filter(([, v]) => !v.isZero())
        .sort((a, b) => b[1].comparedTo(a[1]))
        .map(([k]) => k);
    },
    /** Cities a group actually sold in, strongest first. */
    activeCitiesForGroup(group) {
      const inner = cube.matrix.groupCity.get(group);
      if (!inner) return [];
      return [...inner.entries()]
        .filter(([, v]) => !v.isZero())
        .sort((a, b) => b[1].comparedTo(a[1]))
        .map(([k]) => k);
    },
    /**
     * Every city x group combination, including the zero ones.
     *
     * The workbook's pivot is 6 groups x 4 cities = 24 rows even though only 12
     * have revenue, and its cross-verification counts depend on that. Analyses
     * that need only live combos filter on `isActive`.
     */
    allCombos() {
      const out = [];
      for (const group of cube.groups) {
        for (const city of cube.cities) {
          const revenue = cell(cube.matrix.cityGroup, city, group);
          out.push({ city, group, revenue, isActive: !revenue.isZero() });
        }
      }
      return out;
    }
  });
}

module.exports = { buildAnalyticsCube, cell, UNCATEGORISED, UNATTRIBUTED };
