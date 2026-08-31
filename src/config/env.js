const dotenv = require("dotenv");
const { envSchema } = require("../validations");

// Load .env file
dotenv.config();

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