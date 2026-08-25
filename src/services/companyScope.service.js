/**
 * Company scope resolution and caching.
 *
 * Every company-scoped request resolves its companyId here first. A companyId
 * supplied by the frontend is never trusted: it must match a company actually
 * discovered in TallyPrime, otherwise the request is refused. This is the single
 * chokepoint that prevents cross-company access.
 */

const { sendXmlRequest } = require("../integrations/tally/transports/xml.transport");
const { parseCompanies } = require("../integrations/tally/tally.parser");
const { buildCompanyListRequest } = require("../integrations/tally/tally.requests");
const { ingestionError, classifyTransportFailure, INGESTION_ERROR_CODES } = require("../integrations/tally/sales/factSales.errors");
const mirror = require("./sync/mirror.service");

/** Short-lived cache so opening a company page does not re-query Tally per tab. */
const DEFAULT_TTL_MS = 30_000;

/**
 * Company discovery is cached far more briefly than domain data.
 *
 * Targeting SVCURRENTCOMPANY at a company that is no longer loaded in Tally
 * CRASHES TallyPrime (verified: the process died and restarted). A stale
 * discovery list is therefore not a cosmetic problem, so it is re-checked
 * almost every time — the request costs about 3ms.
 */
const DISCOVERY_TTL_MS = 2_000;
const cache = new Map();

/**
 * Read through a TTL cache.
 * @param {string} key Always company-scoped by the caller.
 * @param {Function} loader
 * @param {number} [ttlMs]
 */
async function cached(key, loader, ttlMs = DEFAULT_TTL_MS, { allowStale = false } = {}) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await loader();
  // Failures are never cached: a transient Tally timeout must not poison the
  // cache and make every later request fail until the TTL expires.
  if (isCacheable(value)) {
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  // Read paths that only display data would rather show the last known answer,
  // marked as stale, than an empty screen every time Tally blinks. Paths that
  // authorize access never opt in — see isCompanyStillOpen.
  if (allowStale && hit) {
    return { ...hit.value, stale: true, staleAt: new Date(hit.at).toISOString(), staleReason: value.error || null };
  }
  return value;
}

/** Only successful extractions are worth caching. */
function isCacheable(value) {
  if (!value || typeof value !== "object") return false;
  if (value.success === false) return false;
  if (value.available === false) return false;
  return true;
}

/** Drop cached data. Scoped to one company when a companyId is given. */
function invalidate(companyId) {
  if (!companyId) return cache.clear();
  for (const key of cache.keys()) {
    if (key.startsWith(`${companyId}::`)) cache.delete(key);
  }
}

/**
 * Discover the companies currently open in TallyPrime.
 * @param {object} [options]
 * @param {boolean} [options.fresh=false] Bypass the cache. Required by the
 *   safety gate: a stale list must never authorize a request against a company
 *   that has since been closed.
 */
async function listCompanies({ fresh = false, allowStale = false, force = false } = {}) {
  const load = async () => {
    const transportResult = await sendXmlRequest({ xml: buildCompanyListRequest(), force });
    if (!transportResult.success) {
      if (allowStale) {
        const hit = cache.get("__companies__");
        if (hit && hit.value && hit.value.companies && hit.value.companies.length > 0) {
          return { success: true, companies: hit.value.companies, source: "cache", stale: true };
        }
        const mirrored = await mirror.listCompanies();
        if (mirrored && mirrored.length > 0) {
          return { success: true, companies: mirrored, source: "mirror", stale: true };
        }
      }

      return {
        success: false,
        companies: [],
        error: ingestionError(classifyTransportFailure(transportResult), {
          source: "companyDiscovery",
          stage: "extract",
          message: transportResult.errorMessage || "Company discovery failed"
        })
      };
    }
    return { success: true, companies: parseCompanies(transportResult.parsedResponse) };
  };

  // A forced retry must not be answered from the cache it is trying to refresh.
  if (fresh || force) {
    // Never stale: this path exists to keep a closed company from being targeted.
    const value = await load();
    if (isCacheable(value)) cache.set("__companies__", { at: Date.now(), value });
    return value;
  }
  return cached("__companies__", load, DISCOVERY_TTL_MS, { allowStale });
}

/**
 * Confirm a company is still open in TallyPrime right now.
 * Called before any company-scoped extraction, because sending
 * SVCURRENTCOMPANY for a closed company crashes Tally.
 *
 * @param {object} company
 * @returns {Promise<boolean>}
 */
async function isCompanyStillOpen(company) {
  if (!company || !company.companyId) return false;
  // Deliberately uncached: this check exists to prevent a Tally crash, so a
  // cached "yes" from a moment ago is not good enough.
  const discovery = await listCompanies({ fresh: true });
  if (!discovery.success) return false;
  return discovery.companies.some((c) => c.companyId === company.companyId);
}

/**
 * Resolve a companyId to a discovered company.
 * Returns a typed failure rather than throwing so controllers stay thin.
 *
 * @param {string} companyId
 * @returns {Promise<{ok: true, company: object} | {ok: false, status: number, error: object}>}
 */
async function resolveCompany(companyId) {
  if (!companyId || typeof companyId !== "string") {
    return {
      ok: false,
      status: 400,
      error: ingestionError(INGESTION_ERROR_CODES.TALLY_COMPANY_NOT_FOUND, {
        companyId, source: "companyScope", stage: "validate", message: "companyId is required"
      })
    };
  }

  const discovery = await listCompanies();
  if (!discovery.success) {
    // TallyPrime is unreachable. If this company has already been mirrored we
    // can still identify it and serve mirrored data, which is the whole point
    // of keeping a local copy. Nothing is invented: a company absent from the
    // mirror still fails exactly as before.
    //
    // Resolving here is safe because it does not grant extraction rights - the
    // isCompanyStillOpen() gate still runs before any request reaches Tally,
    // so a closed company can never be targeted.
    const mirrored = await mirror.readCompany(companyId);
    if (mirrored) {
      return { ok: true, company: mirrored, source: "mirror" };
    }
    return { ok: false, status: 502, error: discovery.error };
  }

  // Match on the stable identity only — never on a display name.
  const company = discovery.companies.find((c) => c.companyId === companyId);
  if (!company) {
    return {
      ok: false,
      status: 404,
      error: ingestionError(INGESTION_ERROR_CODES.TALLY_COMPANY_NOT_FOUND, {
        companyId,
        source: "companyScope",
        stage: "validate",
        message: "Company is not open in TallyPrime or does not exist"
      })
    };
  }

  return { ok: true, company };
}

/**
 * Apply search, sort and pagination to an already company-scoped list.
 * Kept out of the extractors so every module paginates identically.
 *
 * @param {Array} records
 * @param {object} query
 * @param {number} [query.page=1]
 * @param {number} [query.limit=50]
 * @param {string} [query.search]
 * @param {string[]} [searchFields] Fields the search term is matched against
 */
function paginate(records, query = {}, searchFields = ["name"]) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 50));
  const search = (query.search || "").trim().toLowerCase();

  let filtered = records;
  if (search) {
    filtered = records.filter((record) =>
      searchFields.some((field) => {
        const value = field.split(".").reduce((acc, part) => (acc ? acc[part] : undefined), record);
        return value !== undefined && value !== null && String(value).toLowerCase().includes(search);
      })
    );
  }

  const total = filtered.length;
  const start = (page - 1) * limit;

  return {
    items: filtered.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
      hasMore: start + limit < total
    }
  };
}

module.exports = {
  isCacheable,
  isCompanyStillOpen,
  DISCOVERY_TTL_MS,
  listCompanies,
  resolveCompany,
  paginate,
  cached,
  invalidate,
  DEFAULT_TTL_MS
};
