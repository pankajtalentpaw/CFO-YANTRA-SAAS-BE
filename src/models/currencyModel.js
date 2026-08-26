const { buildMirrorModel } = require("./mirrorModel.factory");

const CurrencyModel = buildMirrorModel("Currency", "Currency", "currencies");

module.exports = CurrencyModel;
