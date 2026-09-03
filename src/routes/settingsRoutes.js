const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/settingsController");

router.get("/tally", settingsController.getTallySettings);
router.post("/tally", settingsController.updateTallySettings);
router.post("/tally/test", settingsController.testTallyConnection);

module.exports = router;
