/**
 * Secret management module
 * 
 * Provides safe in-memory credential storage and retrieval without leaking secrets.
 */

const inMemoryStore = new Map();

function setSecret(key, value) {
  if (!key || typeof key !== "string") {
    throw new Error("Secret key must be a non-empty string");
  }
  inMemoryStore.set(key, value);
}

function getSecret(key) {
  return inMemoryStore.get(key) || null;
}

function hasSecret(key) {
  return inMemoryStore.has(key);
}

function clearSecrets() {
  inMemoryStore.clear();
}

module.exports = {
  setSecret,
  getSecret,
  hasSecret,
  clearSecrets
};
