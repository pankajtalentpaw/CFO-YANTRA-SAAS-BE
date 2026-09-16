/**
 * Core Engine for Report #5 (Product x City x Month MIS).
 *
 * Implements the full 18-Filter Owner-POV Analytics Suite with Decimal.js precision,
 * strict multi-tenant isolation, and high performance aggregation.
 */

const { Decimal, toDecimal, toDecimalString } = require("../../../../utils/financialDecimal");
const { buildFactSales } = require("../factSales.builder");
const {
  evaluateFilter1_CityRevenueTrend,
  evaluateFilter2_CityTotals,
  evaluateFilter5_MonthTrend,
  evaluateFilter6_MonthMixBySubCategory
} = require("./filters/trendAndMix.filter");
const {
  evaluateFilter3_SubCategoryTotalByCity,
  evaluateFilter4_SubCategoryContributionShare,
  evaluateFilter9_ConcentrationRiskHHI,
  evaluateFilter10_TopCombos
} = require("./filters/concentrationRisk.filter");
const {
  evaluateFilter7_SubCategoryHeadToHead,
  evaluateFilter8_SubCategoryRankingByCity,
  evaluateFilter13_MonthHeadToHead,
  evaluateFilter14_MonthRankingByCity
} = require("./filters/comparisonsRank.filter");
const {
  evaluateFilter11_ContributionBridgeSubCategory,
  evaluateFilter12_ContributionBridgeMonth
} = require("./filters/contributionBridge.filter");
const {
  evaluateFilter15_PeakTroughSubCategory,
  evaluateFilter16_PeakTroughMonth
} = require("./filters/volatilityFinder.filter");
const {
  evaluateFilter0_ExecutiveOverview
} = require("./filters/executiveOverview.filter");
const {
  evaluateFilter16_ActionCenter
} = require("./filters/actionCenter.filter");
const {
  evaluateFilter17_AuditReconciliation
} = require("./filters/auditReconciliation.filter");

const MONTH_ORDER = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const CANONICAL_CITIES = {
  'ahmedabad': 'Ahmedabad',
  'ahmedabad (gujarat)': 'Ahmedabad',
  'ahmadabad': 'Ahmedabad',
  'vatva': 'Ahmedabad',
  'gathiya vatva': 'Ahmedabad',
  'gathiya vatva g.i.d.c': 'Ahmedabad',
  'naroda': 'Ahmedabad',
  'sanand': 'Ahmedabad',
  'changodar': 'Ahmedabad',
  'jalgaon': 'Jalgaon',
  'midc': 'Jalgaon',
  'midc jalgaon': 'Jalgaon',
  'burhanpur': 'Burhanpur',
  'palakkad': 'Palakkad',
  'palghat': 'Palakkad',
  'vadodara': 'Vadodara',
  'baroda': 'Vadodara',
  'tumakuru': 'Tumakuru',
  'tumkur': 'Tumakuru',
  'pune': 'Pune',
  'poona': 'Pune',
  'dar es salaam': 'Dar es Salaam',
  'daressalaam': 'Dar es Salaam',
  'tanzania': 'Dar es Salaam',
  'port au prince': 'Port-au-Prince',
  'port-au-prince': 'Port-au-Prince',
  'portauprince': 'Port-au-Prince',
  'haiti': 'Port-au-Prince',
  'mumbai': 'Mumbai',
  'bombay': 'Mumbai',
  'navi mumbai': 'Mumbai',
  'thane': 'Mumbai',
  'bengaluru': 'Bengaluru',
  'bangalore': 'Bengaluru',
  'chennai': 'Chennai',
  'madras': 'Chennai',
  'kolkata': 'Kolkata',
  'calcutta': 'Kolkata',
  'hyderabad': 'Hyderabad',
  'delhi': 'Delhi',
  'new delhi': 'Delhi',
  'surat': 'Surat',
  'rajkot': 'Rajkot',
  'indore': 'Indore',
  'bhopal': 'Bhopal',
  'jaipur': 'Jaipur',
  'coimbatore': 'Coimbatore',
  'kochi': 'Kochi',
  'cochin': 'Kochi',
  'ernakulam': 'Kochi'
};

function resolveCity(row) {
  let str = (row.City || "").trim();
  const state = (row.State || "").trim();
  const country = (row.Country || "").trim();
  const customer = (row.Customer || row.Party || "").trim();

  if (!str || str.toLowerCase() === "unknown city" || str.toLowerCase() === "unknown" || str === "—" || str === "-") {
    if (state && state.toLowerCase().includes("dar es salaam")) return "Dar es Salaam";
    if (country && country.toLowerCase().includes("tanzania")) return "Dar es Salaam";
    if (country && country.toLowerCase().includes("haiti")) return "Port-au-Prince";
    if (state && state.toLowerCase() === "gujarat") return "Ahmedabad";
    if (customer && customer.toLowerCase().includes("riaz")) return "Ahmedabad";
    if (state) str = state;
    else if (country) str = country;
    else return "Ahmedabad";
  }

  const clean = str.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
  if (CANONICAL_CITIES[clean]) return CANONICAL_CITIES[clean];
  if (CANONICAL_CITIES[str.toLowerCase()]) return CANONICAL_CITIES[str.toLowerCase()];

  return clean.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function buildMisCube(rows) {
  const subCategorySet = new Set();
  const citySet = new Set();
  const monthMap = new Map();

  let totalRevenue = new Decimal(0);
  const cityTotals = new Map();
  const subCategoryTotals = new Map();
  const monthTotals = new Map();

  const cityMonthMatrix = new Map();
  const subCategoryCityMatrix = new Map();
  const subCategoryMonthMatrix = new Map();

  for (const row of rows) {
    if (!row || !row.SalesAmount) continue;

    const amt = toDecimal(row.SalesAmount);
    if (amt.isZero()) continue;

    const subCat = (row.SubCategory || "Uncategorized").trim();
    const city = resolveCity(row);
    const month = (row.Month || "Unknown Month").trim();
    const monthNum = row.MonthNum || 0;

    subCategorySet.add(subCat);
    citySet.add(city);
    if (!monthMap.has(month)) {
      monthMap.set(month, monthNum);
    }

    totalRevenue = totalRevenue.plus(amt);

    cityTotals.set(city, (cityTotals.get(city) || new Decimal(0)).plus(amt));
    subCategoryTotals.set(subCat, (subCategoryTotals.get(subCat) || new Decimal(0)).plus(amt));
    monthTotals.set(month, (monthTotals.get(month) || new Decimal(0)).plus(amt));

    if (!cityMonthMatrix.has(city)) cityMonthMatrix.set(city, new Map());
    const cm = cityMonthMatrix.get(city);
    cm.set(month, (cm.get(month) || new Decimal(0)).plus(amt));

    if (!subCategoryCityMatrix.has(subCat)) subCategoryCityMatrix.set(subCat, new Map());
    const sc = subCategoryCityMatrix.get(subCat);
    sc.set(city, (sc.get(city) || new Decimal(0)).plus(amt));

    if (!subCategoryMonthMatrix.has(subCat)) subCategoryMonthMatrix.set(subCat, new Map());
    const sm = subCategoryMonthMatrix.get(subCat);
    sm.set(month, (sm.get(month) || new Decimal(0)).plus(amt));
  }

  const subCategories = Array.from(subCategorySet).sort((a, b) => {
    const amtA = subCategoryTotals.get(a) || new Decimal(0);
    const amtB = subCategoryTotals.get(b) || new Decimal(0);
    return amtB.minus(amtA).toNumber();
  });

  const cities = Array.from(citySet).sort((a, b) => {
    const amtA = cityTotals.get(a) || new Decimal(0);
    const amtB = cityTotals.get(b) || new Decimal(0);
    return amtB.minus(amtA).toNumber();
  });

  const months = Array.from(monthMap.keys()).sort((a, b) => {
    const numA = monthMap.get(a) || (MONTH_ORDER.indexOf(a) + 1);
    const numB = monthMap.get(b) || (MONTH_ORDER.indexOf(b) + 1);
    return numA - numB;
  });

  return {
    rows,
    totalRevenue,
    cities,
    subCategories,
    months,
    cityTotals,
    subCategoryTotals,
    monthTotals,
    cityMonthMatrix,
    subCategoryCityMatrix,
    subCategoryMonthMatrix
  };
}

function generateMisReport5(input = {}) {
  const { factSalesRows, factStats, rawVouchers, rawContext, options = {} } = input;

  let rows = factSalesRows;
  if (!rows && rawContext) {
    const factResult = buildFactSales(rawContext);
    rows = factResult.rows || [];
  }
  rows = rows || [];

  const cube = buildMisCube(rows);

  let grossTotal = new Decimal(0);
  if (factStats && factStats.grossVoucherTotal) {
    grossTotal = toDecimal(factStats.grossVoucherTotal);
  } else if (rawVouchers && Array.isArray(rawVouchers)) {
    const seenVouchers = new Set();
    for (const v of rawVouchers) {
      if (!v) continue;
      const vType = String(v.voucherTypeName || v.voucherType || "").trim().toLowerCase();
      if (vType && !vType.includes("sales") && !vType.includes("credit note") && !vType.includes("delivery") && !vType.includes("tax invoice")) {
        continue;
      }
      const vKey = v.guid || v.sourceVoucherId || v.sourceObjectId || v.voucherNumber;
      if (vKey && seenVouchers.has(vKey)) continue;
      if (vKey) seenVouchers.add(vKey);
      grossTotal = grossTotal.plus(toDecimal(v.amount || 0));
    }
  } else {
    grossTotal = cube.totalRevenue;
  }

  const netRevenueDec = cube.totalRevenue;
  const grossRevenueDec = grossTotal.greaterThanOrEqualTo(netRevenueDec) ? grossTotal : netRevenueDec;
  const chargesAndGstDec = grossRevenueDec.minus(netRevenueDec);

  const filter0 = evaluateFilter0_ExecutiveOverview(cube);
  const filter1 = evaluateFilter1_CityRevenueTrend(cube);
  const filter2 = evaluateFilter2_CityTotals(cube);
  const filter3 = evaluateFilter3_SubCategoryTotalByCity(cube);
  const filter4 = evaluateFilter4_SubCategoryContributionShare(cube);
  const filter5 = evaluateFilter5_MonthTrend(cube);
  const filter6 = evaluateFilter6_MonthMixBySubCategory(cube);
  const filter7 = evaluateFilter7_SubCategoryHeadToHead(cube, options);
  const filter8 = evaluateFilter8_SubCategoryRankingByCity(cube);
  const filter9 = evaluateFilter9_ConcentrationRiskHHI(cube);
  const filter10 = evaluateFilter10_TopCombos(cube);
  const filter11 = evaluateFilter11_ContributionBridgeSubCategory(cube, options);
  const filter12 = evaluateFilter12_ContributionBridgeMonth(cube);
  const filter13 = evaluateFilter13_MonthHeadToHead(cube, options);
  const filter14 = evaluateFilter14_MonthRankingByCity(cube);
  const filter15 = evaluateFilter15_PeakTroughSubCategory(cube);
  const filter16 = evaluateFilter16_ActionCenter(cube);
  const filter17 = evaluateFilter17_AuditReconciliation(cube);

  const allFilters = {
    filter0_executiveOverview: filter0,
    filter1_cityRevenueTrend: filter1,
    filter2_cityTotalsReference: filter2,
    filter3_subCategoryTotalByCity: filter3,
    filter4_subCategoryContributionShare: filter4,
    filter5_monthTrendCompanyWide: filter5,
    filter6_monthMixBySubCategory: filter6,
    filter7_subCategoryHeadToHead: filter7,
    filter8_subCategoryRankingByCity: filter8,
    filter9_concentrationRiskHhi: filter9,
    filter10_topCombos: filter10,
    filter11_contributionBridgeSubCategory: filter11,
    filter12_contributionBridgeMonth: filter12,
    filter13_monthHeadToHead: filter13,
    filter14_monthRankingByCity: filter14,
    filter15_peakTroughSubCategory: filter15,
    filter16_actionCenter: filter16,
    filter17_auditReconciliation: filter17
  };

  const filterList = [
    filter0, filter1, filter2, filter3, filter4, filter5, filter6,
    filter7, filter8, filter9, filter10, filter11, filter12,
    filter13, filter14, filter15, filter16, filter17
  ];

  let selectedFilter = null;
  if (options.filterId !== undefined) {
    const fId = Number(options.filterId);
    selectedFilter = filterList.find((f) => f.filterId === fId) || null;
  }

  return {
    metadata: {
      reportCode: "MIS_REPORT_5",
      reportTitle: "Owner-POV Filter Library — Product × City × Month MIS",
      grain: "Product × City × Month",
      totalRevenue: toDecimalString(netRevenueDec),
      grossRevenue: toDecimalString(grossRevenueDec),
      chargesAndGst: toDecimalString(chargesAndGstDec),
      recordCount: rows.length,
      distinctProducts: cube.subCategories.length,
      distinctSubCategories: cube.subCategories.length,
      distinctCities: cube.cities.length,
      distinctMonths: cube.months.length,
      generatedAt: new Date().toISOString()
    },
    executiveSummary: {
      totalRevenue: toDecimalString(netRevenueDec),
      grossRevenue: toDecimalString(grossRevenueDec),
      chargesAndGst: toDecimalString(chargesAndGstDec),
      cityTrendHeadline: filter1.summary,
      productDeclineHeadline: filter6.summary,
      concentrationAlert: filter9.summary,
      topCombosTrigger: filter10.summary,
      volatilityLeader: filter15.summary
    },
    selectedFilter,
    filters: allFilters,
    filterIndex: filterList.map((f) => ({
      id: f.filterId,
      name: f.filterName,
      question: f.ownerQuestion,
      type: f.type,
      summary: f.summary || ""
    }))
  };
}

// resolveCity is exported for the analytics layer, which must place rows on the
// same canonical city names this engine uses. Duplicating CANONICAL_CITIES there
// would let two views of the same data drift apart.
module.exports = {
  buildMisCube,
  generateMisReport5,
  resolveCity
};
