const express = require("express");
const router = express.Router();
const c = require("../controllers/companies.controller");

// Company list and identity
router.get("/", c.getCompanies);
router.get("/:companyId", c.getCompany);
router.get("/:companyId/overview", c.getOverview);
router.get("/:companyId/readiness", c.getReadiness);

// Masters — every route below is company-scoped by the controller
router.get("/:companyId/ledgers", c.getLedgers);
router.get("/:companyId/ledgers/:ledgerId", c.getLedger);
router.get("/:companyId/groups", c.getGroups);
router.get("/:companyId/stock-items", c.getStockItems);
router.get("/:companyId/stock-items/:stockItemId", c.getStockItem);
router.get("/:companyId/stock-groups", c.getStockGroups);
router.get("/:companyId/cost-centres", c.getCostCentres);
router.get("/:companyId/godowns", c.getGodowns);
router.get("/:companyId/units", c.getUnits);
router.get("/:companyId/voucher-types", c.getVoucherTypes);
router.get("/:companyId/customers", c.getParties);
router.get("/:companyId/suppliers", c.getParties);

// Transactions
router.get("/:companyId/vouchers", c.getVouchers);
router.get("/:companyId/vouchers/:voucherId", c.getVoucher);

// Analysis — aggregates the cached register, never a second extraction
router.get("/:companyId/sales-analysis", c.getSalesAnalysis);
router.get("/:companyId/purchase-analysis", c.getPurchaseAnalysis);
router.get("/:companyId/dashboard", c.getDashboard);
router.get("/:companyId/reconciliation-report", c.getReconciliationReport);

module.exports = router;
