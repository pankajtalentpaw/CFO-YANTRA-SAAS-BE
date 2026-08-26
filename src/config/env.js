const dotenv = require("dotenv");
const { z } = require("zod");

// Load .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TALLY_HOST: z.string().min(1).default("127.0.0.1"),
  TALLY_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  TALLY_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  // Health probes must answer well inside the frontend's patience, so they get
  // their own budget rather than the full data-extraction timeout.
  TALLY_PROBE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(4000),
  TALLY_COMPANY_NAME: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // ---- Local MongoDB mirror -------------------------------------------------
  // The mirror is optional by design. With it off, or unreachable, every read
  // falls back to live TallyPrime extraction exactly as before.
  MONGODB_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/cfo_yantra"),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(3000),

  // ---- Live auto-sync -------------------------------------------------------
  // TallyPrime has no push/webhook channel, so "live" means polling on an
  // interval with checksum-based change detection.
  SYNC_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  SYNC_INTERVAL_MS: z.coerce.number().int().min(5000).max(86400000).default(60000),
  SYNC_START_DELAY_MS: z.coerce.number().int().min(0).max(600000).default(5000),
  // Vouchers are the heavy part of a company. Ledger/inventory entries are
  // opt-in because pulling them holds TallyPrime for much longer per tick.
  SYNC_VOUCHERS: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  SYNC_VOUCHER_ENTRIES: z.enum(["true", "false"]).default("true").transform((v) => v === "true")
});

let parsedEnv;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  // Fail fast with a clear diagnostic, without exposing process.env contents.
  const issues = error.issues || [{ path: ["?"], message: error.message }];
  console.error("");
  console.error("CRITICAL: Invalid environment configuration in backend/.env");
  console.error("");
  for (const issue of issues) {
    console.error(`  ${Array.isArray(issue.path) ? issue.path.join(".") : issue.path}: ${issue.message}`);
  }
  console.error("");
  console.error("Fix backend/.env and start the server again.");
  console.error("Expected: TALLY_HOST, TALLY_PORT (1-65535), TALLY_TIMEOUT_MS (100-120000), TALLY_PROBE_TIMEOUT_MS (100-30000), LOG_LEVEL.");
  console.error("");

  // Under test, surface the problem without killing the runner.
  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
    throw error;
  }
  process.exit(1);
}

module.exports = {
  nodeEnv: parsedEnv.NODE_ENV,
  tally: {
    host: parsedEnv.TALLY_HOST,
    port: parsedEnv.TALLY_PORT,
    timeoutMs: parsedEnv.TALLY_TIMEOUT_MS,
    probeTimeoutMs: parsedEnv.TALLY_PROBE_TIMEOUT_MS,
    companyName: parsedEnv.TALLY_COMPANY_NAME
  },
  logLevel: parsedEnv.LOG_LEVEL,
  mongo: {
    enabled: parsedEnv.MONGODB_ENABLED,
    uri: parsedEnv.MONGODB_URI,
    serverSelectionTimeoutMs: parsedEnv.MONGODB_SERVER_SELECTION_TIMEOUT_MS
  },
  sync: {
    enabled: parsedEnv.SYNC_ENABLED,
    intervalMs: parsedEnv.SYNC_INTERVAL_MS,
    startDelayMs: parsedEnv.SYNC_START_DELAY_MS,
    vouchers: parsedEnv.SYNC_VOUCHERS,
    voucherEntries: parsedEnv.SYNC_VOUCHER_ENTRIES
  }
};