const { normalizeCanonicalVoucherType, classifyVoucherType } = require("../src/integrations/tally/canonical/voucherType.canonical");
const { normalizeCanonicalCostCategory, normalizeCanonicalCostCentre } = require("../src/integrations/tally/canonical/dimensions.canonical");
const { normalizeCanonicalCurrency, normalizeCanonicalUnit } = require("../src/integrations/tally/canonical/currency.canonical");
const {
  normalizeCanonicalStockGroup,
  normalizeCanonicalStockItem,
  normalizeCanonicalGodown
} = require("../src/integrations/tally/canonical/inventory.canonical");

describe("Additional Canonical Master Parsers", () => {
  describe("Voucher Types", () => {
    it("should normalize VoucherType and classify core type", () => {
      const raw = {
        NAME: "GST Tax Invoice",
        PARENT: "Sales",
        ABBREVIATION: "Inv",
        NUMBERINGMETHOD: "Automatic",
        ISOPTIONAL: "No"
      };

      const vch = normalizeCanonicalVoucherType(raw, { sourceCompanyId: "CMP_1" });
      expect(vch.name).toBe("GST Tax Invoice");
      expect(vch.parent).toBe("Sales");
      expect(vch.coreType).toBe("SALES");
      expect(vch.abbreviation).toBe("Inv");
      expect(vch.numberingMethod).toBe("Automatic");
      expect(vch.isOptional).toBe(false);
      expect(vch.checksum).toBeDefined();
    });

    it("should classify standard voucher types correctly", () => {
      expect(classifyVoucherType("Sales", "Sales")).toBe("SALES");
      expect(classifyVoucherType("Purchase Invoice", "Purchase")).toBe("PURCHASE");
      expect(classifyVoucherType("Bank Payment", "Payment")).toBe("PAYMENT");
      expect(classifyVoucherType("Cash Receipt", "Receipt")).toBe("RECEIPT");
      expect(classifyVoucherType("Journal", "Journal")).toBe("JOURNAL");
      expect(classifyVoucherType("Debit Note", "Debit Note")).toBe("DEBIT_NOTE");
      expect(classifyVoucherType("Credit Note", "Credit Note")).toBe("CREDIT_NOTE");
    });
  });

  describe("Cost Centres & Categories", () => {
    it("should normalize CostCategory and CostCentre", () => {
      const rawCat = {
        NAME: "Marketing Campaign",
        ALLOCATEREVENUE: "Yes",
        ALLOCATENONREVENUE: "No"
      };
      const cat = normalizeCanonicalCostCategory(rawCat, { sourceCompanyId: "CMP_1" });
      expect(cat.name).toBe("Marketing Campaign");
      expect(cat.allocateRevenue).toBe(true);
      expect(cat.allocateNonRevenue).toBe(false);

      const rawCC = {
        NAME: "North Zone Sales",
        CATEGORY: "Marketing Campaign",
        PARENT: "Primary"
      };
      const cc = normalizeCanonicalCostCentre(rawCC, { sourceCompanyId: "CMP_1" });
      expect(cc.name).toBe("North Zone Sales");
      expect(cc.category).toBe("Marketing Campaign");
      expect(cc.isPrimary).toBe(true);
    });
  });

  describe("Currencies & Units", () => {
    it("should normalize Currency and Unit", () => {
      const rawCur = {
        NAME: "INR",
        EXPANDEDSYMBOL: "₹",
        ORIGINALNAME: "Indian Rupee",
        DECIMALSYMBOL: "Paise",
        DECIMALPLACES: 2
      };
      const cur = normalizeCanonicalCurrency(rawCur, { sourceCompanyId: "CMP_1" });
      expect(cur.name).toBe("INR");
      expect(cur.symbol).toBe("₹");
      expect(cur.decimalPlaces).toBe(2);

      const rawUnit = {
        NAME: "NOS",
        ORIGINALNAME: "Numbers",
        ISSIMPLEUNIT: "Yes",
        DECIMALPLACES: 0
      };
      const unit = normalizeCanonicalUnit(rawUnit, { sourceCompanyId: "CMP_1" });
      expect(unit.name).toBe("NOS");
      expect(unit.originalName).toBe("Numbers");
      expect(unit.isSimpleUnit).toBe(true);
    });
  });

  describe("Inventory Masters", () => {
    it("should normalize StockGroup, StockItem, and Godown", () => {
      const stockGroup = normalizeCanonicalStockGroup({ NAME: "Electronics", PARENT: "Primary" });
      expect(stockGroup.name).toBe("Electronics");
      expect(stockGroup.isPrimary).toBe(true);

      const stockItem = normalizeCanonicalStockItem({
        NAME: "Laptop Pro 15",
        PARENT: "Electronics",
        BASEUNITS: "NOS",
        OPENINGBALANCE: 10,
        OPENINGVALUE: 650000,
        OPENINGRATE: 65000,
        HSNCODE: "84713010",
        GSTTYPEOFSUPPLY: "Goods"
      });
      expect(stockItem.name).toBe("Laptop Pro 15");
      expect(stockItem.openingBalance.quantity).toBe(10);
      expect(stockItem.openingBalance.value).toBe("650000.00");
      expect(stockItem.gst.hsnCode).toBe("84713010");

      const godown = normalizeCanonicalGodown({
        NAME: "Main Warehouse",
        ADDRESS: "Plot 12, MIDC Industrial Area",
        PINCODE: "400701"
      });
      expect(godown.name).toBe("Main Warehouse");
      expect(godown.address).toBe("Plot 12, MIDC Industrial Area");
    });
  });
});
