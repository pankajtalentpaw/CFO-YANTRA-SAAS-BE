const { buildMirrorModel } = require("./mirrorModel.factory");

const StockGroupModel = buildMirrorModel("StockGroup", "StockGroup", "stockgroups");

module.exports = StockGroupModel;
