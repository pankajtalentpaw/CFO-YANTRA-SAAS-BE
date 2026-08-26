const { buildMirrorModel } = require("./mirrorModel.factory");

const StockCategoryModel = buildMirrorModel("StockCategory", "StockCategory", "stockcategories");

module.exports = StockCategoryModel;
