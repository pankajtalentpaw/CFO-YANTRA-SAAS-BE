const express = require("express");
const router = express.Router();

const tallyRoutes = require("./tallyRoutes");
const companiesRoutes = require("./companiesRoutes");
const diagnosticsRoutes = require("./diagnosticsRoutes");
const syncRoutes = require("./syncRoutes");
const cloudRoutes = require("./cloudRoutes");
const authRoutes = require("./authRoutes");

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
router.use("/auth", authRoutes);
router.use("/tally", tallyRoutes);
router.use("/companies", companiesRoutes);
router.use("/diagnostics", diagnosticsRoutes);
router.use("/sync", syncRoutes);
router.use("/cloud", cloudRoutes);

module.exports = router;
