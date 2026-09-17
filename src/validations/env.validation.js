const { z } = require("zod");

/**
 * Environment configuration validation schema.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  TALLY_HOST: z.string().min(1).default("127.0.0.1"),
  TALLY_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  TALLY_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  TALLY_PROBE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(4000),
  TALLY_COMPANY_NAME: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // ---- SQL Database Mirror ----
  DB_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .or(z.boolean())
    .transform((v) => v === true || v === "true"),
  MONGODB_ENABLED: z.enum(["true", "false"]).optional(), // legacy alias support

  DATABASE_URL: z
    .string()
    .min(1)
    .default("sqlite:./data/cfo_yantra.sqlite")
    .transform((val) => {
      let clean = val.trim();
      if (clean.startsWith("DATABASE_URL=")) {
        clean = clean.replace(/^DATABASE_URL=/, "").trim();
      }
      clean = clean.replace(/^["']|["']$/g, "");
      return clean;
    }),
  DB_DIALECT: z.enum(["postgres", "sqlite", "mysql"]).optional(),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),
  DB_LOGGING: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),

  // ---- Live auto-sync ----
  SYNC_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  SYNC_INTERVAL_MS: z.coerce.number().int().min(5000).max(86400000).default(60000),
  SYNC_START_DELAY_MS: z.coerce.number().int().min(0).max(600000).default(5000),
  SYNC_VOUCHERS: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  SYNC_VOUCHER_ENTRIES: z.enum(["true", "false"]).default("true").transform((v) => v === "true")
});

module.exports = {
  envSchema
};
