/**
 * Peak and Trough Volatility Filters (Filters 15, 16) for Report #5.
 */

const { Decimal, toDecimal, toDecimalString } = require("../../../../../utils/financialDecimal");
const { THRESHOLDS } = require("../misReport5.types");

/**
 * Filter 15: Best & Worst Month by SubCategory (Peak & Trough Finder)
 * Answers: For each SubCategory, what was my best/worst month, and how big is the swing?
 * Peak-to-Trough Ratio >= 2.0 AMBER / >= 3.0 RED.
 */
function evaluateFilter15_PeakTroughSubCategory(cube) {
  const { subCategories, months, subCategoryMonthMatrix, subCategoryTotals } = cube;
  let redCount = 0;
  let amberCount = 0;
  let greenCount = 0;
  let mostVolatileProduct = null;
  let maxRatioFound = 0;

  const results = subCategories.map((subCat) => {
    let peakMonth = null;
    let peakAmount = new Decimal(0);
    let troughMonth = null;
    let troughAmount = null;

    for (const m of months) {
      const amt = (subCategoryMonthMatrix.get(subCat) && subCategoryMonthMatrix.get(subCat).get(m)) || new Decimal(0);
      if (amt.greaterThan(peakAmount) || peakMonth === null) {
        peakAmount = amt;
        peakMonth = m;
      }
      if (troughAmount === null || amt.lessThan(troughAmount)) {
        troughAmount = amt;
        troughMonth = m;
      }
    }

    if (troughAmount === null) troughAmount = new Decimal(0);

    const swing = peakAmount.minus(troughAmount);
    let ratio = 1.0;
    let ratioFormatted = "1.00x";

    if (troughAmount.isPositive()) {
      const r = peakAmount.dividedBy(troughAmount).toDecimalPlaces(2).toNumber();
      ratio = r;
      ratioFormatted = `${r.toFixed(2)}x`;
    } else if (peakAmount.isPositive()) {
      ratio = 999.99;
      ratioFormatted = "N/A (Trough is 0)";
    }

    let status = "GREEN";
    if (ratio >= THRESHOLDS.VOLATILITY_RATIO_RED) {
      status = "RED";
      redCount++;
    } else if (ratio >= THRESHOLDS.VOLATILITY_RATIO_AMBER) {
      status = "AMBER";
      amberCount++;
    } else {
      greenCount++;
    }

    if (ratio > maxRatioFound && ratio < 999) {
      maxRatioFound = ratio;
      mostVolatileProduct = { subCategory: subCat, ratio: ratioFormatted, status };
    }

    return {
      subCategory: subCat,
      peakMonth,
      peakAmount: toDecimalString(peakAmount),
      troughMonth,
      troughAmount: toDecimalString(troughAmount),
      swing: toDecimalString(swing),
      peakToTroughRatio: ratioFormatted,
      ratioNumeric: ratio,
      status
    };
  });

  // Sort by ratio numeric descending
  results.sort((a, b) => b.ratioNumeric - a.ratioNumeric);

  const summary = mostVolatileProduct
    ? `${mostVolatileProduct.subCategory} is ${mostVolatileProduct.status} (ratio ${mostVolatileProduct.ratio}) -- most volatile product (${redCount} RED, ${amberCount} AMBER, ${greenCount} GREEN)`
    : `${redCount} RED, ${amberCount} AMBER, ${greenCount} GREEN volatility profiles`;

  return {
    filterId: 15,
    filterName: "Best & Worst Month by SubCategory",
    ownerQuestion: "For each SubCategory, what was my best/worst month, and how big is the swing?",
    type: "Volatility",
    threshold: `Peak-to-Trough Ratio >=${THRESHOLDS.VOLATILITY_RATIO_AMBER} AMBER / >=${THRESHOLDS.VOLATILITY_RATIO_RED} RED`,
    summary,
    mostVolatileProduct,
    counts: { red: redCount, amber: amberCount, green: greenCount },
    data: results
  };
}

/**
 * Filter 16: Best & Worst Month by Month (Seasonality Volatility)
 * Answers: For each Month, what was my best/worst month, and how big is the swing?
 */
function evaluateFilter16_PeakTroughMonth(cube) {
  const { months, monthTotals } = cube;
  let peakMonth = null;
  let peakAmount = new Decimal(0);
  let troughMonth = null;
  let troughAmount = null;

  for (const m of months) {
    const amt = monthTotals.get(m) || new Decimal(0);
    if (amt.greaterThan(peakAmount) || peakMonth === null) {
      peakAmount = amt;
      peakMonth = m;
    }
    if (troughAmount === null || amt.lessThan(troughAmount)) {
      troughAmount = amt;
      troughMonth = m;
    }
  }

  if (troughAmount === null) troughAmount = new Decimal(0);
  const swing = peakAmount.minus(troughAmount);

  let ratio = 1.0;
  let ratioFormatted = "1.00x";
  if (troughAmount.isPositive()) {
    const r = peakAmount.dividedBy(troughAmount).toDecimalPlaces(2).toNumber();
    ratio = r;
    ratioFormatted = `${r.toFixed(2)}x`;
  }

  return {
    filterId: 16,
    filterName: "Best & Worst Month by Month",
    ownerQuestion: "For each Month, what was my best/worst month, and how big is the swing?",
    type: "Volatility",
    threshold: "N/A -- Table 2 structurally degenerate (Month is both row dim and breakdown axis)",
    summary: "See Sheet 07/13 for genuine month-level volatility instead",
    costOfInaction: "N/A",
    addressableOpportunity: "N/A",
    peakMonth,
    peakAmount: toDecimalString(peakAmount),
    troughMonth,
    troughAmount: toDecimalString(troughAmount),
    swing: toDecimalString(swing),
    peakToTroughRatio: ratioFormatted
  };
}

module.exports = {
  evaluateFilter15_PeakTroughSubCategory,
  evaluateFilter16_PeakTroughMonth
};
