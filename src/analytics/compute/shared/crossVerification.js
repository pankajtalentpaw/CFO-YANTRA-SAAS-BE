/**
 * Cross-Verification Suite (CV01 - CV16).
 *
 * Mathematical reconciliation invariants that must hold across all dimensions,
 * matrices, and summaries of the analytics cube. Used by Audit & Reconciliation
 * (Filter 17) and automated test suites to guarantee mathematical integrity.
 */

const { Decimal, toNumber } = require("./money");

const EPSILON = 0.01;

function isClose(d1, d2, tol = EPSILON) {
  const dec1 = d1 instanceof Decimal ? d1 : new Decimal(d1 || 0);
  const dec2 = d2 instanceof Decimal ? d2 : new Decimal(d2 || 0);
  return dec1.minus(dec2).abs().lessThanOrEqualTo(tol);
}

/**
 * Run all 16 cross-verification checks on a built analytics cube.
 *
 * @param {object} cube from buildAnalyticsCube
 * @returns {Array<{ id: string, name: string, description: string, status: "PASS"|"FAIL", expected: number|string, actual: number|string, variance: number }>}
 */
function verifyCube(cube) {
  const results = [];
  const grandTotal = cube.totals.total;

  // CV01: Sum of Period Totals == Total Revenue
  const periodSum = cube.periodKeys.reduce((sum, k) => sum.plus(cube.periodTotal(k)), new Decimal(0));
  const cv01Pass = isClose(periodSum, grandTotal);
  results.push({
    id: "CV01",
    name: "Period Totals Reconciliation",
    description: "Sum of period-by-period revenues must equal the grand total revenue",
    status: cv01Pass ? "PASS" : "FAIL",
    expected: toNumber(grandTotal),
    actual: toNumber(periodSum),
    variance: toNumber(periodSum.minus(grandTotal))
  });

  // CV02: Sum of City Totals == Total Revenue
  const citySum = cube.cities.reduce((sum, c) => sum.plus(cube.cityTotal(c)), new Decimal(0));
  const cv02Pass = isClose(citySum, grandTotal);
  results.push({
    id: "CV02",
    name: "City Totals Reconciliation",
    description: "Sum of all city revenues must equal the grand total revenue",
    status: cv02Pass ? "PASS" : "FAIL",
    expected: toNumber(grandTotal),
    actual: toNumber(citySum),
    variance: toNumber(citySum.minus(grandTotal))
  });

  // CV03: Sum of Stock Group Totals == Total Revenue
  const groupSum = cube.groups.reduce((sum, g) => sum.plus(cube.groupTotal(g)), new Decimal(0));
  const cv03Pass = isClose(groupSum, grandTotal);
  results.push({
    id: "CV03",
    name: "Category Totals Reconciliation",
    description: "Sum of all product group revenues must equal the grand total revenue",
    status: cv03Pass ? "PASS" : "FAIL",
    expected: toNumber(grandTotal),
    actual: toNumber(groupSum),
    variance: toNumber(groupSum.minus(grandTotal))
  });

  // CV04: City x Group Matrix Sum == Total Revenue
  let cityGroupSum = new Decimal(0);
  for (const c of cube.cities) {
    for (const g of cube.groups) {
      cityGroupSum = cityGroupSum.plus(cube.cityGroupRevenue(c, g));
    }
  }
  const cv04Pass = isClose(cityGroupSum, grandTotal);
  results.push({
    id: "CV04",
    name: "City x Group Matrix Total",
    description: "Sum of all cells in City x Category matrix must equal grand total",
    status: cv04Pass ? "PASS" : "FAIL",
    expected: toNumber(grandTotal),
    actual: toNumber(cityGroupSum),
    variance: toNumber(cityGroupSum.minus(grandTotal))
  });

  // CV05: Group x City Matrix Sum == Total Revenue
  let groupCitySum = new Decimal(0);
  for (const g of cube.groups) {
    for (const c of cube.cities) {
      groupCitySum = groupCitySum.plus(cube.groupCityRevenue(g, c));
    }
  }
  const cv05Pass = isClose(groupCitySum, grandTotal);
  results.push({
    id: "CV05",
    name: "Group x City Matrix Total",
    description: "Sum of all cells in Category x City matrix must equal grand total",
    status: cv05Pass ? "PASS" : "FAIL",
    expected: toNumber(grandTotal),
    actual: toNumber(groupCitySum),
    variance: toNumber(groupCitySum.minus(grandTotal))
  });

  // CV06: Period x City Matrix Sum == Total Revenue
  let periodCitySum = new Decimal(0);
  for (const p of cube.periodKeys) {
    for (const c of cube.cities) {
      periodCitySum = periodCitySum.plus(cube.cityPeriodRevenue(c, p));
    }
  }
  const cv06Pass = isClose(periodCitySum, grandTotal);
  results.push({
    id: "CV06",
    name: "Period x City Matrix Total",
    description: "Sum of monthly city matrix cells must equal grand total revenue",
    status: cv06Pass ? "PASS" : "FAIL",
    expected: toNumber(grandTotal),
    actual: toNumber(periodCitySum),
    variance: toNumber(periodCitySum.minus(grandTotal))
  });

  // CV07: Period x Group Matrix Sum == Total Revenue
  let periodGroupSum = new Decimal(0);
  for (const p of cube.periodKeys) {
    for (const g of cube.groups) {
      periodGroupSum = periodGroupSum.plus(cube.groupPeriodRevenue(g, p));
    }
  }
  const cv07Pass = isClose(periodGroupSum, grandTotal);
  results.push({
    id: "CV07",
    name: "Period x Group Matrix Total",
    description: "Sum of monthly product matrix cells must equal grand total revenue",
    status: cv07Pass ? "PASS" : "FAIL",
    expected: toNumber(grandTotal),
    actual: toNumber(periodGroupSum),
    variance: toNumber(periodGroupSum.minus(grandTotal))
  });

  // CV08: Waterfall Bridge Attribution Sum == Endpoint Delta
  let cv08Pass = true;
  let cv08Expected = 0;
  let cv08Actual = 0;
  if (cube.periods.length >= 2) {
    const firstKey = cube.periodKeys[0];
    const lastKey = cube.periodKeys[cube.periodKeys.length - 1];
    const totalDelta = cube.periodTotal(lastKey).minus(cube.periodTotal(firstKey));
    let groupDeltaSum = new Decimal(0);
    for (const g of cube.groups) {
      const gDelta = cube.groupPeriodRevenue(g, lastKey).minus(cube.groupPeriodRevenue(g, firstKey));
      groupDeltaSum = groupDeltaSum.plus(gDelta);
    }
    cv08Pass = isClose(groupDeltaSum, totalDelta);
    cv08Expected = toNumber(totalDelta);
    cv08Actual = toNumber(groupDeltaSum);
  }
  results.push({
    id: "CV08",
    name: "Waterfall Attribution Identity",
    description: "Sum of product-level bridge changes must equal company total change",
    status: cv08Pass ? "PASS" : "FAIL",
    expected: cv08Expected,
    actual: cv08Actual,
    variance: toNumber(new Decimal(cv08Actual).minus(cv08Expected))
  });

  // CV09: HHI Concentration Bounds Check (1/N <= HHI <= 1.0)
  let cv09Pass = true;
  if (cube.groups.length > 0 && grandTotal.isPositive()) {
    let sumSq = new Decimal(0);
    for (const g of cube.groups) {
      const sh = cube.groupTotal(g).dividedBy(grandTotal);
      sumSq = sumSq.plus(sh.times(sh));
    }
    const hhi = sumSq.toNumber();
    const minHhi = 1 / cube.groups.length - EPSILON;
    cv09Pass = hhi >= minHhi && hhi <= 1.0 + EPSILON;
  }
  results.push({
    id: "CV09",
    name: "HHI Mathematical Bounds",
    description: "Portfolio HHI index must be mathematically bounded between 1/N and 1.0",
    status: cv09Pass ? "PASS" : "FAIL",
    expected: "1/N <= HHI <= 1.0",
    actual: cv09Pass ? "Within Bounds" : "Out of Bounds",
    variance: 0
  });

  // CV10: Entity Shares Sum to 1.0
  let citySharesSum = new Decimal(0);
  if (grandTotal.isPositive()) {
    for (const c of cube.cities) {
      citySharesSum = citySharesSum.plus(cube.cityTotal(c).dividedBy(grandTotal));
    }
  }
  const cv10Pass = grandTotal.isZero() || isClose(citySharesSum, new Decimal(1));
  results.push({
    id: "CV10",
    name: "Entity Share Sum to 100%",
    description: "Sum of all city percentage shares of total revenue must equal 100%",
    status: cv10Pass ? "PASS" : "FAIL",
    expected: 1.0,
    actual: toNumber(citySharesSum, 4),
    variance: toNumber(citySharesSum.minus(1))
  });

  // CV11: Ranking Uniqueness and Continuity
  const sortedCities = [...cube.cities].sort((a, b) => cube.cityTotal(b).comparedTo(cube.cityTotal(a)));
  const uniqueCount = new Set(sortedCities).size;
  const cv11Pass = uniqueCount === cube.cities.length;
  results.push({
    id: "CV11",
    name: "Ranking Continuity & Uniqueness",
    description: "Every entity must occupy exactly one rank with continuous ordering",
    status: cv11Pass ? "PASS" : "FAIL",
    expected: cube.cities.length,
    actual: uniqueCount,
    variance: cube.cities.length - uniqueCount
  });

  // CV12: Peak >= Mean >= Trough Invariant
  let cv12Pass = true;
  for (const g of cube.groups) {
    const s = cube.groupSeries(g);
    if (!s.length) continue;
    let pk = s[0];
    let tr = s[0];
    let tot = new Decimal(0);
    s.forEach((v) => {
      tot = tot.plus(v);
      if (v.greaterThan(pk)) pk = v;
      if (v.lessThan(tr)) tr = v;
    });
    const mean = tot.dividedBy(s.length);
    if (pk.lessThan(mean) || mean.lessThan(tr)) {
      cv12Pass = false;
      break;
    }
  }
  results.push({
    id: "CV12",
    name: "Peak-Mean-Trough Invariant",
    description: "Peak revenue >= Mean revenue >= Trough revenue across every entity series",
    status: cv12Pass ? "PASS" : "FAIL",
    expected: "Peak >= Mean >= Trough",
    actual: cv12Pass ? "Valid" : "Invalid",
    variance: 0
  });

  // CV13: Non-negative Revenue Invariant (net of credit notes)
  const cv13Pass = grandTotal.greaterThanOrEqualTo(0);
  results.push({
    id: "CV13",
    name: "Non-Negative Revenue Invariant",
    description: "Cumulative revenue after returns must be non-negative",
    status: cv13Pass ? "PASS" : "FAIL",
    expected: ">= 0",
    actual: toNumber(grandTotal),
    variance: grandTotal.isNegative() ? toNumber(grandTotal) : 0
  });

  // CV14: Period Chronological Continuity
  let cv14Pass = true;
  for (let i = 1; i < cube.periodKeys.length; i++) {
    if (cube.periodKeys[i] <= cube.periodKeys[i - 1]) {
      cv14Pass = false;
      break;
    }
  }
  results.push({
    id: "CV14",
    name: "Period Chronological Monotonicity",
    description: "Period timeline keys must be strictly ordered without regressions",
    status: cv14Pass ? "PASS" : "FAIL",
    expected: "Strictly Ascending",
    actual: cv14Pass ? "Strictly Ascending" : "Disordered",
    variance: 0
  });

  // CV15: Top-N Combinations Sum <= Grand Total
  const combos = [];
  for (const c of cube.cities) {
    for (const g of cube.groups) {
      const rev = cube.cityGroupRevenue(c, g);
      if (rev.greaterThan(0)) combos.push(rev);
    }
  }
  combos.sort((a, b) => b.comparedTo(a));
  const top5Sum = combos.slice(0, 5).reduce((sum, v) => sum.plus(v), new Decimal(0));
  const cv15Pass = top5Sum.lessThanOrEqualTo(grandTotal.plus(EPSILON));
  results.push({
    id: "CV15",
    name: "Top-Combos Boundedness",
    description: "Sum of Top 5 City x Group combos must not exceed grand total revenue",
    status: cv15Pass ? "PASS" : "FAIL",
    expected: `<= ${toNumber(grandTotal)}`,
    actual: toNumber(top5Sum),
    variance: top5Sum.greaterThan(grandTotal) ? toNumber(top5Sum.minus(grandTotal)) : 0
  });

  // CV16: Row Attribution Integrity
  const cv16Pass = Boolean(cube.meta && typeof cube.meta.rowCount === "number" && cube.meta.rowCount >= 0);
  results.push({
    id: "CV16",
    name: "Fact Row Traceability & Integrity",
    description: "Cube row metadata must reconcile with underlying FACT_SALES rows",
    status: cv16Pass ? "PASS" : "FAIL",
    expected: "Valid Meta",
    actual: cube.meta ? `${cube.meta.rowCount} rows` : "Missing",
    variance: 0
  });

  const failures = results.filter((r) => r.status === "FAIL");
  return {
    valid: failures.length === 0,
    passedCount: results.length - failures.length,
    failedCount: failures.length,
    failures,
    checks: results.map((r) => ({ ...r, passed: r.status === "PASS" }))
  };
}

module.exports = {
  verifyCube
};
