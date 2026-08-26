const express = require("express");
const router = express.Router();
const syncController = require("../controllers/syncController");

router.get("/status", syncController.getSyncStatus);
router.post("/run", syncController.runSyncNow);
router.get("/companies", syncController.getMirroredCompanies);
router.get("/:companyId/counts", syncController.getMirrorCounts);

module.exports = router;
