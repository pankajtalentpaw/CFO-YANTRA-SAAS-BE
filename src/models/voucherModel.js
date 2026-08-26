const { buildMirrorModel } = require("./mirrorModel.factory");

/**
 * Vouchers are transactions rather than masters: same envelope, but queried by
 * date, so they get their own model and date index.
 */
const Voucher = buildMirrorModel("Voucher", "Voucher", "vouchers");

Voucher.schema.index({ companyId: 1, voucherDate: 1 });
Voucher.schema.index({ companyId: 1, sourceVoucherNumber: 1 });

module.exports = Voucher;
