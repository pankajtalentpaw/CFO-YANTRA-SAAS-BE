const Company = require("./companyModel");
const SyncState = require("./syncStateModel");
const Voucher = require("./voucherModel");
const Ledger = require("./ledgerModel");
const Group = require("./groupModel");
const StockItem = require("./stockItemModel");
const StockGroup = require("./stockGroupModel");
const StockCategory = require("./stockCategoryModel");
const Unit = require("./unitModel");
const Godown = require("./godownModel");
const CostCentre = require("./costCentreModel");
const CostCategory = require("./costCategoryModel");
const VoucherType = require("./voucherTypeModel");
const Currency = require("./currencyModel");
const { buildMirrorSchema, buildMirrorModel } = require("./mirrorModel.factory");

/**
 * Mirror collections, one per canonical domain.
 *
 * The keys match the DOMAINS map in companyData.service exactly, so the sync
 * engine and the DB-first read path can both address a domain by the same name
 * the live extraction path already uses.
 */
const DOMAIN_MODELS = {
  ledgers: Ledger,
  groups: Group,
  stockItems: StockItem,
  stockGroups: StockGroup,
  stockCategories: StockCategory,
  units: Unit,
  godowns: Godown,
  costCentres: CostCentre,
  costCategories: CostCategory,
  voucherTypes: VoucherType,
  currencies: Currency
};

const DOMAIN_NAMES = Object.keys(DOMAIN_MODELS);

module.exports = {
  Company,
  SyncState,
  Voucher,
  Ledger,
  Group,
  StockItem,
  StockGroup,
  StockCategory,
  Unit,
  Godown,
  CostCentre,
  CostCategory,
  VoucherType,
  Currency,
  DOMAIN_MODELS,
  DOMAIN_NAMES,
  buildMirrorSchema,
  buildMirrorModel
};
