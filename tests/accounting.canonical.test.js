const {
  normalizeCanonicalGroup,
  normalizeCanonicalLedger,
  classifyLedger
} = require("../src/integrations/tally/canonical/accounting.canonical");

describe("Canonical Accounting Parsers (Groups & Ledgers)", () => {
  describe("Groups", () => {
    it("should normalize raw Tally Group correctly", () => {
      const raw = {
        NAME: "Current Assets",
        GUID: "grp-12345",
        PARENT: "Primary",
        ISADDABLE: "Yes",
        ISREVENUE: "No",
        ISDEEMEDPOSITIVE: "Yes"
      };

      const group = normalizeCanonicalGroup(raw, { sourceCompanyId: "CMP_1" });
      expect(group.name).toBe("Current Assets");
      expect(group.parent).toBe("Primary");
      expect(group.isPrimary).toBe(true);
      expect(group.isRevenue).toBe(false);
      expect(group.isDeemedPositive).toBe(true);
      expect(group.sourceObjectId).toBe("grp-12345");
      expect(group.checksum).toBeDefined();
    });
  });

  describe("Ledgers", () => {
    it("should normalize raw Ledger with Debit opening balance", () => {
      const raw = {
        NAME: "HDFC Bank Account",
        GUID: "led-hdfc-01",
        PARENT: "Bank Accounts",
        OPENINGBALANCE: 154000.5,
        ISBILLWISEON: "No",
        ISCOSTCENTRESON: "No"
      };

      const ledger = normalizeCanonicalLedger(raw, { sourceCompanyId: "CMP_1" });
      expect(ledger.name).toBe("HDFC Bank Account");
      expect(ledger.classification).toBe("BANK");
      expect(ledger.openingBalance.amount).toBe("154000.50");
      expect(ledger.openingBalance.isDebit).toBe(true);
      expect(ledger.openingBalance.formatted).toBe("154000.50 Dr");
    });

    it("should normalize raw Ledger with Credit opening balance formatted string", () => {
      const raw = {
        NAME: "Acme Supplies Ltd",
        GUID: "led-acme-02",
        PARENT: "Sundry Creditors",
        OPENINGBALANCE: "75000.00 Cr",
        ISBILLWISEON: "Yes",
        PARTYGSTIN: "27AAACA1234A1Z5"
      };

      const ledger = normalizeCanonicalLedger(raw, { sourceCompanyId: "CMP_1" });
      expect(ledger.name).toBe("Acme Supplies Ltd");
      expect(ledger.classification).toBe("SUNDRY_CREDITOR");
      expect(ledger.openingBalance.amount).toBe("75000.00");
      expect(ledger.openingBalance.isDebit).toBe(false);
      expect(ledger.openingBalance.formatted).toBe("75000.00 Cr");
      expect(ledger.billWise.enabled).toBe(true);
      expect(ledger.taxation.partyGstin).toBe("27AAACA1234A1Z5");
    });

    it("should handle Unicode ledger names, leading/trailing spaces, and duplicate names under different groups", () => {
      const raw1 = {
        NAME: "   रोहित ट्रेडर्स (Rohit Traders)   ",
        PARENT: "Sundry Debtors",
        OPENINGBALANCE: 0
      };

      const raw2 = {
        NAME: "   रोहित ट्रेडर्स (Rohit Traders)   ",
        PARENT: "Sundry Creditors",
        OPENINGBALANCE: 0
      };

      const l1 = normalizeCanonicalLedger(raw1, { sourceCompanyId: "CMP_1" });
      const l2 = normalizeCanonicalLedger(raw2, { sourceCompanyId: "CMP_1" });

      expect(l1.name).toBe("रोहित ट्रेडर्स (Rohit Traders)");
      expect(l2.name).toBe("रोहित ट्रेडर्स (Rohit Traders)");
      expect(l1.classification).toBe("SUNDRY_DEBTOR");
      expect(l2.classification).toBe("SUNDRY_CREDITOR");
      // Distinct parents must produce distinct sourceObjectIds
      expect(l1.sourceObjectId).not.toBe(l2.sourceObjectId);
    });
  });

  describe("classifyLedger", () => {
    it("should accurately classify standard accounting groups", () => {
      expect(classifyLedger("Bank Accounts", "SBI")).toBe("BANK");
      expect(classifyLedger("Cash-in-hand", "Petty Cash")).toBe("CASH");
      expect(classifyLedger("Sundry Debtors", "Customer A")).toBe("SUNDRY_DEBTOR");
      expect(classifyLedger("Sundry Creditors", "Vendor B")).toBe("SUNDRY_CREDITOR");
      expect(classifyLedger("Duties & Taxes", "CGST")).toBe("TAX");
      expect(classifyLedger("Direct Expenses", "Freight")).toBe("EXPENSE");
      expect(classifyLedger("Sales Accounts", "Domestic Sales")).toBe("INCOME");
    });
  });
});
