const express = require("express");
const router = express.Router();
const tallyController = require("../controllers/tally.controller");
const factSalesController = require("../controllers/factSales.controller");

router.get("/health", tallyController.getHealth);
router.get("/status", tallyController.getStatus);
router.get("/capabilities", tallyController.getCapabilities);
router.get("/company", tallyController.getCompany);
router.get("/masters", tallyController.getMasters);
router.get("/transport", tallyController.getTransport);
router.get("/factsales", factSalesController.getFactSales);

module.exports = router;
