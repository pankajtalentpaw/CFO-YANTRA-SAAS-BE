const express = require("express");
const router = express.Router();
const syncController = require("../controllers/syncController");

router.get("/status", syncController.getSyncStatus);
router.post("/run", syncController.runSyncNow);
router.get("/companies", syncController.getMirroredCompanies);
router.get("/:companyId/counts", syncController.getMirrorCounts);
router.post("/tally-event", syncController.handleTallyWebhookEvent);
router.get("/tally-event", syncController.handleTallyWebhookEvent);

module.exports = router;

