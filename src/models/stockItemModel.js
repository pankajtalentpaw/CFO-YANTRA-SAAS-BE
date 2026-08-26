const { buildMirrorModel } = require("./mirrorModel.factory");

const StockItemModel = buildMirrorModel("StockItem", "StockItem", "stockitems");

module.exports = StockItemModel;
