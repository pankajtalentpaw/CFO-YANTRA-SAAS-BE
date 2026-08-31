const { z } = require("zod");

/**
 * AI analysis and CFO Assistant chat validation schemas.
 */

const analyzeRequestSchema = z.object({
  customFocus: z.string().max(5000).optional(),
  forceOffline: z.boolean().optional()
});

const chatRequestSchema = z.object({
  question: z.string().max(10000).optional(),
  filterId: z.union([z.number(), z.string()]).optional(),
  filterName: z.string().max(200).optional(),
  conversationHistory: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string()
  })).optional()
}).refine((data) => data.question || data.filterId !== undefined, {
  message: "Either question or filterId must be provided"
});

module.exports = {
  analyzeRequestSchema,
  chatRequestSchema
};
