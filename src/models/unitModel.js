const { buildMirrorModel } = require("./mirrorModel.factory");

const UnitModel = buildMirrorModel("Unit", "Unit", "units");

module.exports = UnitModel;
