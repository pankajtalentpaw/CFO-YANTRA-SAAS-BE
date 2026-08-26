const { buildMirrorModel } = require("./mirrorModel.factory");

const CostCategoryModel = buildMirrorModel("CostCategory", "CostCategory", "costcategories");

module.exports = CostCategoryModel;
