const crypto = require("crypto");

/**
 * Calculate SHA-256 hash of a string or Buffer
 * @param {string|Buffer} content
 * @returns {string} Hex SHA-256 digest
 */
function sha256(content) {
  if (typeof content !== "string" && !Buffer.isBuffer(content)) {
    throw new TypeError("sha256 requires a string or Buffer argument");
  }
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Deterministically serialize an object to JSON with sorted keys
 * @param {any} obj
 * @returns {string}
 */
function canonicalJsonString(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonString).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonString(obj[key])}`);
  return `{${pairs.join(",")}}`;
}

/**
 * Generate a deterministic SHA-256 checksum for a structured record or object
 * @param {object} record
 * @returns {string} Hex SHA-256 digest
 */
function recordChecksum(record) {
  const canonical = canonicalJsonString(record);
  return sha256(canonical);
}

module.exports = {
  sha256,
  canonicalJsonString,
  recordChecksum
};
