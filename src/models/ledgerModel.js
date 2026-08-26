const { buildMirrorModel } = require("./mirrorModel.factory");

const LedgerModel = buildMirrorModel("Ledger", "Ledger", "ledgers");

module.exports = LedgerModel;
