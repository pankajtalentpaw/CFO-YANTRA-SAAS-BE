const env = require("../config/env");
const { isConnected } = require("../config/db");
const { logger } = require("../utils/logger");
const { runSyncCycle } = require("../services/sync/syncEngine.service");

/**
 * The live auto-sync loop.
 *
 * TallyPrime offers no push or webhook channel - it only answers HTTP requests
 * - so "live" here means polling on an interval. What keeps that cheap is
 * change detection: each canonical record carries a parser checksum, and the
 * mirror only writes records whose checksum actually moved. A quiet company
 * therefore costs one read pass and zero writes.
 *
 * Two invariants:
 *   - Runs never overlap. TallyPrime serves one request at a time, so a slow
 *     cycle must not have a second one queued behind it.
 *   - A failure never stops the loop. The next tick simply tries again.
 */

let timer = null;
let startTimer = null;
let running = false;
let stopping = false;

const state = {
  enabled: false,
  running: false,
  startedAt: null,
  lastTickAt: null,
  lastResult: null,
  lastError: null,
  tickCount: 0,
  skippedOverlaps: 0
};

async function tick() {
  if (stopping) return;
  if (running) {
    // Previous cycle still working; skipping keeps pressure off TallyPrime.
    state.skippedOverlaps++;
    logger.debug("Sync tick skipped - previous cycle still running");
    return;
  }
  if (!isConnected()) {
    logger.debug("Sync tick skipped - local mirror not connected");
    return;
  }

  running = true;
  state.running = true;
  state.lastTickAt = new Date();
  state.tickCount++;

  try {
    const result = await runSyncCycle();
    state.lastResult = result;
    state.lastError = null;
  } catch (error) {
    state.lastError = error.message;
    logger.error({ error: error.message, stack: error.stack }, "Sync cycle failed - loop continues");
  } finally {
    running = false;
    state.running = false;
  }
}

function start() {
  if (!env.sync.enabled) {
    logger.info("Live auto-sync disabled (SYNC_ENABLED=false)");
    return false;
  }
  if (timer) return true;

  stopping = false;
  state.enabled = true;
  state.startedAt = new Date();

  // Let the server finish binding and the mirror finish connecting before the
  // first pull, so startup is not competing with a full extraction.
  startTimer = setTimeout(() => {
    tick();
    timer = setInterval(tick, env.sync.intervalMs);
    if (timer.unref) timer.unref();
  }, env.sync.startDelayMs);
  if (startTimer.unref) startTimer.unref();

  logger.info(
    { intervalMs: env.sync.intervalMs, startDelayMs: env.sync.startDelayMs, vouchers: env.sync.vouchers },
    "Live auto-sync started"
  );
  return true;
}

async function stop() {
  stopping = true;
  if (startTimer) { clearTimeout(startTimer); startTimer = null; }
  if (timer) { clearInterval(timer); timer = null; }
  state.enabled = false;
  logger.info("Live auto-sync stopped");
}

/** Run one cycle immediately, outside the schedule (used by POST /api/sync/run). */
async function triggerNow() {
  if (running) return { triggered: false, reason: "ALREADY_RUNNING" };
  await tick();
  return { triggered: true, result: state.lastResult };
}

function getState() {
  return {
    ...state,
    intervalMs: env.sync.intervalMs,
    configuredEnabled: env.sync.enabled,
    syncVouchers: env.sync.vouchers,
    syncVoucherEntries: env.sync.voucherEntries
  };
}

module.exports = { start, stop, tick, triggerNow, getState };
