const { encryptPayload, decryptPayload } = require("../../utils/encryption");
const { sha256 } = require("../../utils/checksum");

/**
 * Spool crypto wrapper to encrypt/decrypt JSON queue chunks
 */
function encryptSpoolChunk(chunkData, encryptionKey) {
  const jsonString = JSON.stringify(chunkData);
  const checksum = sha256(jsonString);
  const encrypted = encryptPayload(jsonString, encryptionKey);

  return {
    ...encrypted,
    checksum,
    createdAt: new Date().toISOString()
  };
}

function decryptSpoolChunk(spoolEnvelope, encryptionKey) {
  const decryptedBuffer = decryptPayload(
    spoolEnvelope.ciphertext,
    encryptionKey,
    spoolEnvelope.iv,
    spoolEnvelope.authTag
  );
  const jsonString = decryptedBuffer.toString("utf8");
  const computedChecksum = sha256(jsonString);

  if (computedChecksum !== spoolEnvelope.checksum) {
    throw new Error("Spool integrity failure: Checksum mismatch on decrypted chunk");
  }

  return JSON.parse(jsonString);
}

module.exports = {
  encryptSpoolChunk,
  decryptSpoolChunk
};
