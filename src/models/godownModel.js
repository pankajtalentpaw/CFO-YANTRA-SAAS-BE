const { buildMirrorModel } = require("./mirrorModel.factory");

const GodownModel = buildMirrorModel("Godown", "Godown", "godowns");

module.exports = GodownModel;
