const { buildMirrorModel } = require("./mirrorModel.factory");

const VoucherTypeModel = buildMirrorModel("VoucherType", "VoucherType", "vouchertypes");

module.exports = VoucherTypeModel;
