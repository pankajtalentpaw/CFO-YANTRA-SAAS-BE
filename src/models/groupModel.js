const { buildMirrorModel } = require("./mirrorModel.factory");

const GroupModel = buildMirrorModel("Group", "Group", "groups");

module.exports = GroupModel;
