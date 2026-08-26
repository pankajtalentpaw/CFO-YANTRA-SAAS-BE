const fs = require('fs');
const filePath = 'C:/Users/admin/Desktop/CFO PROJECT/backend/src/integrations/tally/sales/misReport5/filters/concentrationRisk.filter.js';
let content = fs.readFileSync(filePath, 'utf8');

const updatedFilter3 = `
function evaluateFilter3_SubCategoryTotalByCity(cube) {
  const { cities, subCategories, subCategoryCityMatrix, cityTotals } = cube;
  let singleProductDependencyCount = 0;

  const cityBreakdown = cities.map((city) => {
    const cityTotal = cityTotals.get(city) || new Decimal(0);
    let maxSubCat = null;
    let maxSubCatAmt = new Decimal(0);

    const subCatEntries = subCategories
      .map((subCat) => {
        const amt = (subCategoryCityMatrix.get(subCat) && subCategoryCityMatrix.get(subCat).get(city)) || new Decimal(0);
        if (amt.greaterThan(maxSubCatAmt)) {
          maxSubCatAmt = amt;
          maxSubCat = subCat;
        }
        const share = cityTotal.isZero()
          ? 0
          : amt.times(100).dividedBy(cityTotal).toDecimalPlaces(2).toNumber();

        return {
          subCategory: subCat,
          revenue: toDecimalString(amt),
          rawRevenue: amt.toNumber(),
          sharePercent: share
        };
      })
      .filter((entry) => entry.rawRevenue > 0)
      .sort((a, b) => b.rawRevenue - a.rawRevenue);

    const dominantShare = cityTotal.isZero()
      ? 0
      : maxSubCatAmt.times(100).dividedBy(cityTotal).toDecimalPlaces(2).toNumber();

    const isSingleProductDependent = dominantShare >= THRESHOLDS.SINGLE_PRODUCT_DEPENDENCY_THRESHOLD * 100;
    if (isSingleProductDependent) singleProductDependencyCount++;

    return {
      city,
      cityTotal: toDecimalString(cityTotal),
      activeProductsCount: subCatEntries.length,
      subCategories: subCatEntries,
      dominantSubCategory: maxSubCat,
      dominantSharePercent: dominantShare,
      isSingleProductDependent
    };
  });

  return {
    filterId: 3,
    filterName: "Product-wise Total by City",
    ownerQuestion: "Which Product gave me how much revenue, by City?",
    type: "Product",
    threshold: "75% single-product dependency threshold",
    summary: \`\${singleProductDependencyCount} of \${cities.length} Cities have >75% single-product dependency (\${singleProductDependencyCount === 0 ? "all diversified" : "concentrated"})\`,
    singleProductDependentCities: singleProductDependencyCount,
    data: cityBreakdown
  };
}
`;

const updatedFilter4 = `
function evaluateFilter4_SubCategoryContributionShare(cube) {
  const { subCategories, cities, subCategoryCityMatrix, subCategoryTotals } = cube;
  let overConcentratedCount = 0;

  const results = subCategories.map((subCat) => {
    const total = subCategoryTotals.get(subCat) || new Decimal(0);
    let dominantCity = null;
    let dominantCityAmt = new Decimal(0);

    const cityShares = cities
      .map((city) => {
        const amt = (subCategoryCityMatrix.get(subCat) && subCategoryCityMatrix.get(subCat).get(city)) || new Decimal(0);
        if (amt.greaterThan(dominantCityAmt)) {
          dominantCityAmt = amt;
          dominantCity = city;
        }
        const share = total.isZero()
          ? 0
          : amt.times(100).dividedBy(total).toDecimalPlaces(2).toNumber();

        return {
          city,
          revenue: toDecimalString(amt),
          rawRevenue: amt.toNumber(),
          sharePercent: share
        };
      })
      .filter((entry) => entry.rawRevenue > 0)
      .sort((a, b) => b.rawRevenue - a.rawRevenue);

    const maxShare = total.isZero()
      ? 0
      : dominantCityAmt.times(100).dividedBy(total).toDecimalPlaces(2).toNumber();

    const isOverConcentrated = maxShare >= THRESHOLDS.DOMINANT_CITY_SHARE_THRESHOLD * 100;
    if (isOverConcentrated) overConcentratedCount++;

    return {
      subCategory: subCat,
      totalRevenue: toDecimalString(total),
      dominantCity,
      dominantCitySharePercent: maxShare,
      activeCitiesCount: cityShares.length,
      isOverConcentrated,
      cityShares
    };
  });

  return {
    filterId: 4,
    filterName: "Product Contribution % Share",
    ownerQuestion: "Out of every City's total, what % came from each Product?",
    type: "Product",
    threshold: "75% single-city concentration threshold",
    summary: \`\${overConcentratedCount} of \${subCategories.length} Products rely on a single city for >75% of their revenue\`,
    overConcentratedSubCategories: overConcentratedCount,
    data: results
  };
}
`;

// Replace functions in file
content = content.replace(/function evaluateFilter3_SubCategoryTotalByCity\(cube\) \{[\s\S]*?\n\}/, updatedFilter3.trim());
content = content.replace(/function evaluateFilter4_SubCategoryContributionShare\(cube\) \{[\s\S]*?\n\}/, updatedFilter4.trim());

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated concentrationRisk.filter.js');
