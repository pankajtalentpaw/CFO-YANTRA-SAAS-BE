const { buildMirrorModel } = require("./mirrorModel.factory");

const CostCentreModel = buildMirrorModel("CostCentre", "CostCentre", "costcentres");

module.exports = CostCentreModel;
