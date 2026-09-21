/**
 * Tally availability breaker and request serializer.
 *
 * TallyPrime is a single-threaded desktop application. When it is busy with a
 * large query, or blocked by a modal dialog, it still accepts the TCP
 * connection on port 9000 and then answers nothing at all — so every request
 * costs a full timeout instead of failing fast.
 *
 * Two mechanisms keep that from reaching the user as a hung page:
 *
 *   1. Serialization. Only one request is in flight against Tally at a time.
 *      Concurrent queries are what push a single-threaded Tally into the
 *      blocked state in the first place, and a health probe firing during a
 *      voucher extraction used to double the wait for both.
 *
 *   2. A breaker. The first timeout marks Tally unavailable for a cooldown.
 *      While the breaker is open every call fails immediately with a typed
 *      error rather than waiting. Without it, one wedged Tally turned a single
 *      page load into minutes of stacked timeouts: the overview alone runs
 *      eight domain extractions, each preceded by its own discovery check.
 *
 * The breaker closes again on its own. A cheap heartbeat is always allowed
 * through, and one success resets everything — no restart, no manual step.
 */

const env = require("../../config/env");
const { logger } = require("../../utils/logger");

/** Cooldown ladder. A Tally that stays wedged is retried less and less often. */
const COOLDOWN_LADDER_MS = [5_000, 10_000, 20_000, 30_000];

/** Failures where the TCP connect itself never succeeded. */
const REFUSED_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND"]);

/**
 * Word the pause by what actually failed.
 *
 * A refused connect and a silent one are different faults with different
 * fixes. Telling someone to close a dialog when nothing is even listening
 * sends them hunting for a dialog that does not exist.
 *
 * The silent case has two causes that are indistinguishable over HTTP:
 * TallyPrime is blocked on a modal, or a second TallyPrime process already
 * owns the port and the visible one never bound it. Tally reports nothing at
 * all when that bind fails — it looks connected, and its Tally.NET "connected
 * for online access" line stays green because that is a different channel
 * entirely — so the port has to be named as a suspect or nobody checks it.
 */
function buildUnavailableMessage(retryInMs, lastFailureCode) {
  const seconds = Math.ceil(retryInMs / 1000);
  const target = `${env.tally.host}:${env.tally.port}`;

  if (REFUSED_CODES.has(lastFailureCode)) {
    return (
      `Nothing is listening on ${target}, so requests are paused for ${seconds}s. ` +
      "Open TallyPrime and enable F1: Help > Settings > Connectivity > " +
      "Client/Server configuration (TallyPrime acts as: Server)."
    );
  }

  return (
    `TallyPrime accepted the connection on ${target} but never answered, ` +
    `so requests are paused for ${seconds}s. Either a dialog is open in ` +
    "TallyPrime, or another TallyPrime process is holding the port and the " +
    "window you are looking at never bound it — check for a second tally.exe. " +
    "The connection retries automatically."
  );
}

/** Error thrown instead of waiting when Tally is known to be unavailable. */
class TallyUnavailableError extends Error {
  constructor(retryInMs, consecutiveFailures, lastFailureCode) {
    super(buildUnavailableMessage(retryInMs, lastFailureCode));
    this.name = "TallyUnavailableError";
    // Callers classify on `code`, exactly as they do for axios errors.
    this.code = "ETALLYUNAVAILABLE";
    this.isTallyUnavailable = true;
    this.retryInMs = retryInMs;
    this.consecutiveFailures = consecutiveFailures;
    // Which fault opened the breaker, so diagnostics can stay specific.
    this.lastFailureCode = lastFailureCode || null;
    this.responseTimeMs = 0;
  }
}

const state = {
  consecutiveFailures: 0,
  openedAt: null,
  cooldownMs: 0,
  lastFailureCode: null,
  lastSuccessAt: null
};

/** Errors that mean "Tally is not answering", as opposed to "Tally said no". */
function isAvailabilityFailure(error) {
  if (!error) return false;
  if (error.isTallyUnavailable) return false; // Already accounted for.
  const code = error.code || "";
  return (
    code === "ECONNABORTED" || // axios timeout
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ERR_CANCELED" ||
    /timeout/i.test(error.message || "")
  );
}

/** Milliseconds until the breaker allows traffic again. 0 when closed. */
function retryInMs() {
  if (state.openedAt === null) return 0;
  const elapsed = Date.now() - state.openedAt;
  return Math.max(0, state.cooldownMs - elapsed);
}

function isOpen() {
  return retryInMs() > 0;
}

/** Throw immediately when Tally is in cooldown. Called before every request. */
function assertAvailable() {
  const wait = retryInMs();
  if (wait > 0) throw new TallyUnavailableError(wait, state.consecutiveFailures, state.lastFailureCode);
}

function recordSuccess() {
  if (state.consecutiveFailures > 0 || state.openedAt !== null) {
    logger.info({ afterFailures: state.consecutiveFailures }, "TallyPrime is responding again");
  }
  state.consecutiveFailures = 0;
  state.openedAt = null;
  state.cooldownMs = 0;
  state.lastFailureCode = null;
  state.lastSuccessAt = Date.now();
}

/**
 * Record a failed call. Only availability failures open the breaker — a Tally
 * that answers with a TDL error is perfectly reachable and must stay callable.
 */
function recordFailure(error) {
  if (!isAvailabilityFailure(error)) return;

  state.consecutiveFailures += 1;
  state.lastFailureCode = error.code || "TIMEOUT";
  const step = Math.min(state.consecutiveFailures - 1, COOLDOWN_LADDER_MS.length - 1);
  state.cooldownMs = COOLDOWN_LADDER_MS[step];
  state.openedAt = Date.now();

  logger.warn(
    { code: state.lastFailureCode, consecutiveFailures: state.consecutiveFailures, cooldownMs: state.cooldownMs },
    "TallyPrime is not responding — pausing requests"
  );
}

/** Availability, for the status endpoint and diagnostics. */
function snapshot() {
  return {
    available: !isOpen(),
    consecutiveFailures: state.consecutiveFailures,
    retryInMs: retryInMs(),
    lastFailureCode: state.lastFailureCode,
    lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null
  };
}

/** Test seam: forget everything the breaker has learned. */
function reset() {
  state.consecutiveFailures = 0;
  state.openedAt = null;
  state.cooldownMs = 0;
  state.lastFailureCode = null;
  state.lastSuccessAt = null;
}

/** Longest a caller will queue for its turn before giving the slot up. */
const DEFAULT_MAX_WAIT_MS = 15_000;

/** Raised when the queue, not Tally, is what the caller is waiting on. */
class TallyBusyError extends Error {
  constructor(waitedMs) {
    super(
      `TallyPrime is still working on an earlier request (waited ${Math.round(waitedMs / 1000)}s). ` +
      "The request was not sent; try again in a moment."
    );
    this.name = "TallyBusyError";
    this.code = "ETALLYBUSY";
    this.isTallyBusy = true;
    this.responseTimeMs = waitedMs;
  }
}

/**
 * Run `fn` with exclusive access to Tally.
 *
 * The queue is a promise chain, so callers are served in arrival order and a
 * rejection never breaks the chain for whoever is behind it.
 *
 * Waiting is bounded. A caller that has queued for `maxWaitMs` gives up its
 * slot and is told Tally is busy, rather than sitting behind a long extraction
 * until the browser gives up first — an answer late enough to be discarded is
 * the same as no answer.
 */
let tail = Promise.resolve();

function runExclusive(fn, { maxWaitMs = DEFAULT_MAX_WAIT_MS } = {}) {
  const queuedAt = Date.now();
  let abandoned = false;
  let started = false;

  const turn = tail.then(run, run);
  function run() {
    // The slot was given up while waiting; do not dial Tally after the fact.
    if (abandoned) return Promise.reject(new TallyBusyError(Date.now() - queuedAt));
    started = true;
    return fn();
  }

  // Swallow on the chain with a polite breathing pause (100ms) so Tally's
  // single-threaded Windows event loop gets a break between consecutive queries.
  const MIN_GAP_MS = process.env.NODE_ENV === "test" ? 0 : 100;
  const gap = () => (MIN_GAP_MS > 0 ? new Promise((r) => setTimeout(r, MIN_GAP_MS)) : Promise.resolve());
  tail = turn.then(gap, gap);

  if (!maxWaitMs) return turn;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Only queueing is capped here. A request already on the wire keeps its
      // own transport timeout — cutting it off would waste work Tally is doing.
      if (started) return;
      abandoned = true;
      reject(new TallyBusyError(Date.now() - queuedAt));
    }, maxWaitMs);
    // Never hold the process open for a queue slot.
    if (typeof timer.unref === "function") timer.unref();

    turn.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

module.exports = {
  TallyUnavailableError,
  TallyBusyError,
  DEFAULT_MAX_WAIT_MS,
  assertAvailable,
  isOpen,
  isAvailabilityFailure,
  recordSuccess,
  recordFailure,
  retryInMs,
  runExclusive,
  snapshot,
  reset,
  COOLDOWN_LADDER_MS
};
