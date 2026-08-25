const { buildMirrorModel } = require("./mirrorModel.factory");
const Company = require("./Company");
const SyncState = require("./SyncState");

/**
 * Mirror collections, one per canonical domain.
 *
 * The keys match the DOMAINS map in companyData.service exactly, so the sync
 * engine and the DB-first read path can both address a domain by the same name
 * the live extraction path already uses.
 */
const DOMAIN_MODELS = {
  ledgers: buildMirrorModel("Ledger", "Ledger", "ledgers"),
  groups: buildMirrorModel("Group", "Group", "groups"),
  stockItems: buildMirrorModel("StockItem", "StockItem", "stockitems"),
  stockGroups: buildMirrorModel("StockGroup", "StockGroup", "stockgroups"),
  stockCategories: buildMirrorModel("StockCategory", "StockCategory", "stockcategories"),
  units: buildMirrorModel("Unit", "Unit", "units"),
  godowns: buildMirrorModel("Godown", "Godown", "godowns"),
  costCentres: buildMirrorModel("CostCentre", "CostCentre", "costcentres"),
  costCategories: buildMirrorModel("CostCategory", "CostCategory", "costcategories"),
  voucherTypes: buildMirrorModel("VoucherType", "VoucherType", "vouchertypes"),
  currencies: buildMirrorModel("Currency", "Currency", "currencies")
};

// Vouchers are transactions rather than masters: same envelope, but queried by
// date, so they get their own model and date index.
const Voucher = buildMirrorModel("Voucher", "Voucher", "vouchers");
// Index the fields the canonical voucher actually carries: `voucherDate` and
// `sourceVoucherNumber`. The previous `date`/`voucherNumber` pair existed on no
// voucher document, so the register's date-window read was unindexed as well as
// unmatched.
Voucher.schema.index({ companyId: 1, voucherDate: 1 });
Voucher.schema.index({ companyId: 1, sourceVoucherNumber: 1 });

module.exports = {
  Company,
  SyncState,
  Voucher,
  DOMAIN_MODELS,
  DOMAIN_NAMES: Object.keys(DOMAIN_MODELS)
};
