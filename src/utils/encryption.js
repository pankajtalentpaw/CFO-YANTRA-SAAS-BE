const crypto = require("crypto");
const { SECURITY } = require("../constants");

/**
 * AES-256-GCM payload encryption for local encrypted spool
 * @param {string|Buffer} plaintext
 * @param {Buffer|string} key - 32-byte key
 * @returns {{ ciphertext: string, iv: string, authTag: string }}
 */
function encryptPayload(plaintext, key) {
  const secretKey = typeof key === "string" ? Buffer.from(key, "hex") : key;
  if (secretKey.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes (256 bits)");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(SECURITY.DEFAULT_CIPHER, secretKey, iv);
  
  const buffer = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), "utf8");
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex")
  };
}

/**
 * AES-256-GCM payload decryption
 * @param {string} ciphertextHex
 * @param {Buffer|string} key - 32-byte key
 * @param {string} ivHex
 * @param {string} authTagHex
 * @returns {Buffer}
 */
function decryptPayload(ciphertextHex, key, ivHex, authTagHex) {
  const secretKey = typeof key === "string" ? Buffer.from(key, "hex") : key;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv(SECURITY.DEFAULT_CIPHER, secretKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = {
  encryptPayload,
  decryptPayload
};
