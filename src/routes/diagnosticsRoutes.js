const express = require("express");
const router = express.Router();
const diagnosticsController = require("../controllers/diagnosticsController");

router.get("/", diagnosticsController.getDiagnostics);
router.get("/logs", diagnosticsController.getLogs);

module.exports = router;
