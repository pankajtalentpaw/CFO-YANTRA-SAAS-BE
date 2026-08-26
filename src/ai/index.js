"use strict";

const { OpenAiClient, openaiClient } = require("./openai.client");
const { aiAnalysisService, AiAnalysisService } = require("./services/aiAnalysis.service");
const { buildFinancialContext } = require("./formatters/financialContext.builder");
const { EXECUTIVE_CFO_SYSTEM_PROMPT } = require("./prompts/executiveCfo.prompt");

module.exports = {
  OpenAiClient,
  openaiClient,
  aiAnalysisService,
  AiAnalysisService,
  buildFinancialContext,
  EXECUTIVE_CFO_SYSTEM_PROMPT
};
