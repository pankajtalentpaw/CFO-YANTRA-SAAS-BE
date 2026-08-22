/**
 * Field Coverage Engine
 * Computes exact coverage metrics across all extracted master fields
 */

function calculateFieldCoverage(masters) {
  const coverage = {};

  function recordField(entityType, fieldName, value, isSupported = true) {
    const key = `${entityType}.${fieldName}`;
    if (!coverage[key]) {
      coverage[key] = {
        entity: entityType,
        field: fieldName,
        requested: 0,
        populated: 0,
        nullCount: 0,
        absent: 0,
        unsupported: 0,
        parseFailed: 0
      };
    }

    coverage[key].requested += 1;

    if (!isSupported) {
      coverage[key].unsupported += 1;
      return;
    }

    if (value === undefined) {
      coverage[key].absent += 1;
    } else if (value === null || value === "") {
      coverage[key].nullCount += 1;
    } else {
      coverage[key].populated += 1;
    }
  }

  // 1. Company Coverage
  if (masters.company) {
    const c = masters.company;
    recordField("Company", "displayName", c.displayName);
    recordField("Company", "legalName", c.legalName);
    recordField("Company", "guid", c.guid);
    recordField("Company", "masterId", c.masterId);
    recordField("Company", "alterId", c.alterId);
    recordField("Company", "financialYearBeginning", c.financialYearBeginning);
    recordField("Company", "booksFrom", c.booksFrom);
    recordField("Company", "baseCurrency", c.baseCurrency);
    recordField("Company", "country", c.country);
    recordField("Company", "state", c.state);
    recordField("Company", "gstin", c.gstRegistration ? c.gstRegistration.gstin : null);
    recordField("Company", "pan", c.pan);
    recordField("Company", "cin", c.cin);
  }

  // 2. Groups Coverage
  (masters.groups || []).forEach((g) => {
    recordField("Group", "name", g.name);
    recordField("Group", "sourceObjectId", g.sourceObjectId);
    recordField("Group", "parent", g.parent);
    recordField("Group", "isAddable", g.isAddable);
    recordField("Group", "isRevenue", g.isRevenue);
    recordField("Group", "isDeemedPositive", g.isDeemedPositive);
    recordField("Group", "affectsGrossProfit", g.affectsGrossProfit);
  });

  // 3. Ledgers Coverage
  (masters.ledgers || []).forEach((l) => {
    recordField("Ledger", "name", l.name);
    recordField("Ledger", "sourceObjectId", l.sourceObjectId);
    recordField("Ledger", "parent", l.parent);
    recordField("Ledger", "classification", l.classification);
    recordField("Ledger", "openingBalance", l.openingBalance ? l.openingBalance.amount : null);
    recordField("Ledger", "billWise", l.billWise ? l.billWise.enabled : null);
    recordField("Ledger", "costCentres", l.costCentres ? l.costCentres.enabled : null);
    recordField("Ledger", "partyGstin", l.taxation ? l.taxation.partyGstin : null);
    recordField("Ledger", "taxType", l.taxation ? l.taxation.taxType : null);
    recordField("Ledger", "isActive", l.isActive);
  });

  // 4. VoucherTypes Coverage
  (masters.voucherTypes || []).forEach((v) => {
    recordField("VoucherType", "name", v.name);
    recordField("VoucherType", "sourceObjectId", v.sourceObjectId);
    recordField("VoucherType", "parent", v.parent);
    recordField("VoucherType", "abbreviation", v.abbreviation);
    recordField("VoucherType", "coreType", v.coreType);
    recordField("VoucherType", "numberingMethod", v.numberingMethod);
    recordField("VoucherType", "isActive", v.isActive);
    recordField("VoucherType", "isOptional", v.isOptional);
  });

  // 5. CostCentres Coverage
  (masters.costCentres || []).forEach((cc) => {
    recordField("CostCentre", "name", cc.name);
    recordField("CostCentre", "sourceObjectId", cc.sourceObjectId);
    recordField("CostCentre", "parent", cc.parent);
    recordField("CostCentre", "category", cc.category);
  });

  // 6. StockItems Coverage
  (masters.stockItems || []).forEach((item) => {
    recordField("StockItem", "name", item.name);
    recordField("StockItem", "sourceObjectId", item.sourceObjectId);
    recordField("StockItem", "parent", item.parent);
    recordField("StockItem", "category", item.category);
    recordField("StockItem", "baseUnits", item.baseUnits);
    recordField("StockItem", "openingBalance", item.openingBalance ? item.openingBalance.quantity : null);
    recordField("StockItem", "openingValue", item.openingBalance ? item.openingBalance.value : null);
    recordField("StockItem", "gstTypeOfSupply", item.gst ? item.gst.typeOfSupply : null);
    recordField("StockItem", "hsnCode", item.gst ? item.gst.hsnCode : null);
  });

  // 7. Currencies Coverage
  (masters.currencies || []).forEach((cur) => {
    recordField("Currency", "name", cur.name);
    recordField("Currency", "symbol", cur.symbol);
    recordField("Currency", "decimalSymbol", cur.decimalSymbol);
    recordField("Currency", "decimalPlaces", cur.decimalPlaces);
  });

  // 8. Units Coverage
  (masters.units || []).forEach((u) => {
    recordField("Unit", "name", u.name);
    recordField("Unit", "originalName", u.originalName);
    recordField("Unit", "isSimpleUnit", u.isSimpleUnit);
    recordField("Unit", "decimalPlaces", u.decimalPlaces);
  });

  // 9. Godowns Coverage
  (masters.godowns || []).forEach((g) => {
    recordField("Godown", "name", g.name);
    recordField("Godown", "parent", g.parent);
    recordField("Godown", "address", g.address);
    recordField("Godown", "pinCode", g.pinCode);
  });

  return {
    totalFieldsEvaluated: Object.keys(coverage).length,
    fields: coverage
  };
}

module.exports = {
  calculateFieldCoverage
};
