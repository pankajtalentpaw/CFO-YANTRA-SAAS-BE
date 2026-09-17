/**
 * Test environment isolation.
 *
 * The mirror tests are real database tests: they connect, sync and — in
 * beforeEach — truncate every table so each case starts clean. Nothing scoped
 * them to a test database, so they ran against whatever DATABASE_URL the
 * developer's .env pointed at, which is the live local mirror. Running the
 * suite therefore deleted every mirrored company, voucher and master on the
 * machine. Tally can refill it, but a test run must never be the thing that
 * empties it.
 *
 * Pinning the URL here, before any module reads config/env, keeps the suite on
 * a private in-memory database. dotenv does not overwrite variables that are
 * already set, so this wins over .env.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "sqlite::memory:";
process.env.DB_ENABLED = "true";
process.env.DB_LOGGING = "false";
