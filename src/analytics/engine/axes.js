/**
 * Axis descriptors.
 *
 * The 160 analyses are not 160 different computations. "Latest-month growth
 * direction" is asked of cities in L01.A02 and of products in L06.A05; "peak to
 * current gap" of cities in L01.A04 and products in L06.A03. The maths is
 * identical and only the axis changes.
 *
 * So a builder is written once against an axis descriptor, and the registry
 * binds it to city / group / month / combo / salesman. That is what turns
 * ~5,000 lines of near-duplicate analysis code into ~25 builders.
 *
 * Every axis answers the same four questions: who are your members, what is one
 * member's series across the period axis, what is one member's total, and where
 * does clicking a member drill to.
 */

const { Decimal } = require("../compute/shared/money");

const ZERO = new Decimal(0);

/**
 * @typedef {object} Axis
 * @property {string}   key       identifier used by the registry
 * @property {string}   label     column heading ("City", "SubCategory", "Month")
 * @property {string}   noun      plural, for generated sentences ("cities")
 * @property {string}   drillType entity type the frontend modal expects
 * @property {function} members   (cube) -> [{ key, label }]
 * @property {function} series    (cube, memberKey) -> Decimal[] aligned to periods
 * @property {function} total     (cube, memberKey) -> Decimal
 */

/** City axis — the workbook's geographic lens. */
const city = {
  key: "city",
  label: "City",
  noun: "cities",
  drillType: "city",
  members: (cube) => cube.cities.map((name) => ({ key: name, label: name })),
  series: (cube, name) => cube.citySeries(name),
  total: (cube, name) => cube.cityTotal(name)
};

/**
 * Stock Group axis — what the workbook calls "SubCategory".
 *
 * 04_TALLY_DATA_MAPPING defines it as the stock item's parent Stock Group,
 * which in a FACT_SALES row is `Category`. The label stays "SubCategory"
 * because that is the term the report, the UI and the owner all use.
 */
const group = {
  key: "group",
  label: "SubCategory",
  noun: "products",
  drillType: "product",
  members: (cube) => cube.groups.map((name) => ({ key: name, label: name })),
  series: (cube, name) => cube.groupSeries(name),
  total: (cube, name) => cube.groupTotal(name)
};

/**
 * Month axis.
 *
 * A month has no series across months, so `series` returns the single period's
 * value positioned on the axis — enough for ranking and concentration analyses,
 * which is all the month axis is used for. Trend builders never bind to it.
 */
const period = {
  key: "period",
  label: "Month",
  noun: "months",
  drillType: "month",
  members: (cube) => cube.periods.map((p) => ({ key: p.key, label: p.label })),
  series: (cube, key) => cube.periodKeys.map((k) => (k === key ? cube.periodTotal(k) : ZERO)),
  total: (cube, key) => cube.periodTotal(key)
};

/**
 * Product x City combination axis.
 *
 * Members are the ACTIVE combos only. The full 24-cell matrix including zeroes
 * is reachable via cube.allCombos() for the coverage and completeness analyses;
 * ranking or concentrating over a dozen structural zeroes would just be noise.
 */
const combo = {
  key: "combo",
  label: "SubCategory x City",
  noun: "combinations",
  drillType: "product",
  members: (cube) => cube
    .allCombos()
    .filter((c) => c.isActive)
    .sort((a, b) => b.revenue.comparedTo(a.revenue))
    .map((c) => ({ key: `${c.city}||${c.group}`, label: `${c.group} x ${c.city}`, city: c.city, group: c.group })),
  series: (cube, key) => {
    const [cityName, groupName] = String(key).split("||");
    return cube.comboSeries(cityName, groupName);
  },
  total: (cube, key) => {
    const [cityName, groupName] = String(key).split("||");
    return cube.comboTotal(cityName, groupName);
  }
};

/**
 * Salesman axis.
 *
 * Depends on Tally cost centres being enabled; where they are not, every row
 * collapses to "Unattributed" and analyses bound to this axis correctly report
 * IDLE rather than inventing a distribution.
 */
const salesman = {
  key: "salesman",
  label: "Sales Manager",
  noun: "sales managers",
  drillType: "city",
  members: (cube) => cube.salesmen.map((name) => ({ key: name, label: name })),
  series: (cube, name) => cube.salesmanSeries(name),
  total: (cube, name) => cube.totals.bySalesman.get(name) || ZERO
};

const AXES = Object.freeze({ city, group, period, combo, salesman });

/** Look up an axis by registry key, failing loudly on a typo. */
function getAxis(key) {
  const axis = AXES[key];
  if (!axis) throw new Error(`Unknown axis "${key}" — expected one of ${Object.keys(AXES).join(", ")}`);
  return axis;
}

/**
 * Members with their series and totals already resolved, strongest first.
 *
 * Almost every builder starts here, so doing it once keeps them short and
 * guarantees they all agree on ordering and on excluding empty members.
 *
 * @param {object} cube
 * @param {Axis} axis
 * @param {object} [options]
 * @param {boolean} [options.includeEmpty=false] keep zero-revenue members
 */
function resolveMembers(cube, axis, options = {}) {
  const rows = axis.members(cube).map((m) => ({
    ...m,
    total: axis.total(cube, m.key),
    series: axis.series(cube, m.key)
  }));

  const kept = options.includeEmpty ? rows : rows.filter((r) => !r.total.isZero());
  return kept.sort((a, b) => {
    const cmp = b.total.comparedTo(a.total);
    return cmp !== 0 ? cmp : a.label.localeCompare(b.label);
  });
}

/** Drill-through descriptor for a member, consumed by the frontend modal. */
function drillFor(axis, member) {
  if (!member) return undefined;
  return { type: axis.drillType, name: member.group || member.label || member.key };
}

module.exports = { AXES, getAxis, resolveMembers, drillFor };
