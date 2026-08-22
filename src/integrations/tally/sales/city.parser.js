/**
 * City extraction from Tally's ADDRESS.LIST free text.
 *
 * Tally imposes no address format, so this is a heuristic and says so: every
 * result carries a confidence and the raw address. When the city cannot be
 * determined the answer is null — never a guess.
 */

/** Tokens that identify a line as something other than a city. */
const NON_CITY_PATTERNS = [
  /^\d+$/,                        // bare numbers
  /^[\d\W]+$/,                    // punctuation/number only
  /\b(p\.?o\.?\s*box|pin|pincode|phone|tel|mob|mobile|email|e-mail|gstin|fax)\b/i,
  /\b(plot|flat|floor|room|survey|khasra|block\s*no|door\s*no|h\.?no)\b/i,
  /^(india|bharat)$/i
];

/** Trailing PIN code, optionally prefixed, e.g. "Mumbai - 400001" or "PIN 400001". */
const PIN_SUFFIX = /[\s,-]*(?:pin(?:code)?\s*[:.-]?\s*)?\b\d{6}\b\s*$/i;

/**
 * Flatten whatever shape the caller has into an array of trimmed text lines.
 * @param {string|string[]|object} address
 * @returns {string[]}
 */
function toLines(address) {
  if (!address) return [];
  const flat = Array.isArray(address) ? address : [address];
  return flat
    .map((line) => {
      if (typeof line === "string") return line;
      if (line && typeof line === "object") return line["#text"] || line.ADDRESS || "";
      return "";
    })
    .flatMap((line) => String(line).split(/[\n\r]+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Strip a trailing pin code and tidy separators. */
function cleanCandidate(line) {
  return line
    .replace(PIN_SUFFIX, "")
    .replace(/[,;\-\s]+$/, "")
    .replace(/^[,;\-\s]+/, "")
    .trim();
}

/** A city name is short, mostly alphabetic, and not an obvious street line. */
function looksLikeCity(candidate) {
  if (!candidate || candidate.length < 2 || candidate.length > 40) return false;
  if (NON_CITY_PATTERNS.some((p) => p.test(candidate))) return false;
  if (!/[a-z]/i.test(candidate)) return false;
  if (/\d/.test(candidate)) return false;          // street lines usually carry numbers
  return candidate.split(/\s+/).length <= 4;
}

/**
 * Parse a city from a free-text Tally address.
 *
 * @param {string|string[]|object} address Raw ADDRESS.LIST value
 * @param {object} [options]
 * @param {string|null} [options.knownState] Ledger's LEDSTATENAME. Address lines
 *   matching it are skipped, since a state line is not a city.
 * @returns {{city: string|null, confidence: "high"|"medium"|"low"|"none", rawAddress: string|null, reason?: string}}
 */
function parseCity(address, options = {}) {
  const knownState = (options.knownState || "").trim().toLowerCase();
  const isState = (candidate) => {
    const value = candidate.trim().toLowerCase();
    if (knownState.length > 0 && value === knownState) return true;
    return /^(india|bharat)$/i.test(value);
  };

  /**
   * Address lines often pack several parts into one comma-separated line
   * ("RAIPUR, CHHATTISGARH, INDIA"). Scan segments right-to-left so the state
   * and country are stepped over and the city is reached.
   */
  const segmentsOf = (line) => line.split(",").map((part) => part.trim()).filter(Boolean).reverse();
  const cityFromLine = (line) => {
    for (const segment of segmentsOf(line)) {
      const candidate = cleanCandidate(segment);
      if (looksLikeCity(candidate) && !isState(candidate)) return candidate;
    }
    return null;
  };
  const lines = toLines(address);
  const rawAddress = lines.length > 0 ? lines.join(", ") : null;

  if (lines.length === 0) {
    return { city: null, confidence: "none", rawAddress: null, reason: "ADDRESS_EMPTY" };
  }

  // A line ending in a PIN code is the strongest signal Tally addresses give.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!PIN_SUFFIX.test(lines[i])) continue;
    const candidate = cityFromLine(lines[i].replace(PIN_SUFFIX, ""));
    if (candidate) return { city: candidate, confidence: "high", rawAddress };
  }

  // Otherwise prefer the last city-shaped line: Indian addresses run
  // street -> area -> city, so the city sits near the end.
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = cityFromLine(lines[i]);
    if (candidate) {
      return { city: candidate, confidence: lines.length > 1 ? "medium" : "low", rawAddress };
    }
  }

  return { city: null, confidence: "none", rawAddress, reason: "CITY_NOT_PARSEABLE" };
}

module.exports = { parseCity };
