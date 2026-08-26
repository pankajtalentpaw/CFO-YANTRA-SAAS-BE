"use strict";

const { z } = require("zod");
const { aiAnalysisService } = require("../ai");
const { logger } = require("../utils/logger");

const analyzeRequestSchema = z.object({
  customFocus: z.string().max(5000).optional(),
  forceOffline: z.boolean().optional()
});

const chatRequestSchema = z.object({
  question: z.string().min(1).max(10000),
  conversationHistory: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string()
  })).optional()
});

/**
 * Controller for AI Financial Analysis & CFO Assistant
 * Function-based handlers.
 */
function getStatus(req, res) {
  try {
    const status = aiAnalysisService.getStatus();
    return res.json({
      success: true,
      ...status
    });
  } catch (err) {
    logger.error({ err }, "Failed to get AI status");
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function analyzeCompany(req, res) {
  try {
    const { companyId } = req.params;
    const parsedBody = analyzeRequestSchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request payload",
        details: parsedBody.error.issues
      });
    }

    const result = await aiAnalysisService.generateExecutiveAudit(
      companyId,
      parsedBody.data
    );

    return res.json(result);
  } catch (err) {
    logger.error({ err, companyId: req.params.companyId }, "Failed to run AI analysis");
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

async function chatWithCfo(req, res) {
  try {
    const { companyId } = req.params;
    const parsedBody = chatRequestSchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid question payload",
        details: parsedBody.error.issues
      });
    }

    const result = await aiAnalysisService.chatWithCfo(
      companyId,
      parsedBody.data.question,
      { conversationHistory: parsedBody.data.conversationHistory }
    );

    return res.json(result);
  } catch (err) {
    logger.error({ err, companyId: req.params.companyId }, "Failed to run AI chat");
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

const aiController = {
  getStatus,
  analyzeCompany,
  chatWithCfo
};

module.exports = {
  getStatus,
  analyzeCompany,
  chatWithCfo,
  aiController
};
