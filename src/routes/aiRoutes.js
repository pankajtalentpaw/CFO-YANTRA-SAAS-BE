"use strict";

const express = require("express");
const { aiController } = require("../controllers/aiController");

const router = express.Router({ mergeParams: true });

// Status of OpenAI integration
router.get("/status", aiController.getStatus);

// Generate Comprehensive Virtual CFO Audit
router.post("/analyze", aiController.analyzeCompany);

// Interactive CFO Q&A
router.post("/chat", aiController.chatWithCfo);

module.exports = {
  aiRoutes: router
};
