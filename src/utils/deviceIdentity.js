/**
 * Device Identity Management (Deferred to Cloud/Device Registration Phase)
 * 
 * Provides stable device fingerprinting for desktop bridge authentication.
 */

const crypto = require("crypto");
const os = require("os");

/**
 * Generate a deterministic hardware fingerprint hash
 * @returns {string} Device fingerprint hash
 */
function getDeviceFingerprint() {
  const cpus = os.cpus();
  const model = cpus.length > 0 ? cpus[0].model : "generic-cpu";
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();

  const rawId = `${hostname}|${platform}|${arch}|${model}`;
  return crypto.createHash("sha256").update(rawId).digest("hex");
}

module.exports = {
  getDeviceFingerprint
};
