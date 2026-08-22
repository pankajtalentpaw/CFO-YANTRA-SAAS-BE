const express = require("express");
const router = express.Router();

const tallyRoutes = require("./tally.routes");
const companiesRoutes = require("./companies.routes");
const diagnosticsRoutes = require("./diagnostics.routes");
const syncRoutes = require("./sync.routes");
const cloudRoutes = require("./cloud.routes");

// Health
router.get("/health", (req, res) => {
  res.json({
    status: "HEALTHY",
    service: "cfo-yantra-backend",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// Mounted Routes
router.use("/tally", tallyRoutes);
router.use("/companies", companiesRoutes);
router.use("/diagnostics", diagnosticsRoutes);
router.use("/sync", syncRoutes);
router.use("/cloud", cloudRoutes);

module.exports = router;
