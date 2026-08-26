"use strict";

const axios = require("axios");

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 45000;
const OPENAI_API_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

/**
 * OpenAI API Client for Financial & CFO Decision Intelligence
 * Implemented with clean function-based architecture.
 */
function createOpenAiClient(apiKey = process.env.OPENAI_API_KEY) {
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const client = axios.create({
    baseURL: OPENAI_API_BASE,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json"
    }
  });

  function isConfigured() {
    return Boolean(apiKey && apiKey.trim().length > 5 && !apiKey.includes("your_openai_api_key"));
  }

  /**
   * Generates chat completion with structured financial responses
   */
  async function createChatCompletion({
    messages,
    temperature = 0.2,
    maxTokens = 2500,
    model: reqModel = model,
    responseFormat = null
  }) {
    if (!isConfigured()) {
      throw new Error("OPENAI_API_KEY is not configured in backend environment.");
    }

    const payload = {
      model: reqModel,
      messages,
      temperature,
      max_tokens: maxTokens
    };

    if (responseFormat) {
      payload.response_format = responseFormat;
    }

    try {
      const response = await client.post("/chat/completions", payload, {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`
        }
      });

      const choice = response.data?.choices?.[0];
      return {
        content: choice?.message?.content || "",
        role: choice?.message?.role || "assistant",
        usage: response.data?.usage,
        model: response.data?.model || reqModel
      };
    } catch (error) {
      if (error.response) {
        const errorData = error.response.data?.error || {};
        const message = errorData.message || `OpenAI API Error: HTTP ${error.response.status}`;
        const err = new Error(message);
        err.status = error.response.status;
        err.type = errorData.type;
        err.code = errorData.code;
        throw err;
      }
      throw error;
    }
  }

  return {
    apiKey,
    model,
    client,
    isConfigured,
    createChatCompletion
  };
}

const defaultClient = createOpenAiClient();

module.exports = {
  createOpenAiClient,
  OpenAiClient: createOpenAiClient,
  openaiClient: defaultClient,
  isConfigured: () => defaultClient.isConfigured(),
  createChatCompletion: (params) => defaultClient.createChatCompletion(params)
};
