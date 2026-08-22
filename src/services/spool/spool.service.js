const fs = require("fs");
const path = require("path");
const { encryptSpoolChunk, decryptSpoolChunk } = require("./spool.crypto");
const { logger } = require("../../utils/logger");

const DEFAULT_SPOOL_DIR = path.resolve(process.cwd(), ".spool");

/**
 * Local filesystem encrypted spool queue service
 */
function ensureSpoolDir(spoolDir = DEFAULT_SPOOL_DIR) {
  if (!fs.existsSync(spoolDir)) {
    fs.mkdirSync(spoolDir, { recursive: true });
  }
}

/**
 * Enqueue a data chunk to encrypted local spool
 * @param {object} params
 * @returns {string} File path of written spool chunk
 */
function enqueueChunk({ runId, chunkId, companyId, payload, encryptionKey, spoolDir = DEFAULT_SPOOL_DIR }) {
  ensureSpoolDir(spoolDir);
  const encrypted = encryptSpoolChunk(payload, encryptionKey);

  const spoolRecord = {
    runId,
    chunkId,
    companyId,
    createdAt: new Date().toISOString(),
    status: "pending",
    retryCount: 0,
    ...encrypted
  };

  const filename = `${runId}_${chunkId}_${Date.now()}.spool.json`;
  const filePath = path.join(spoolDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(spoolRecord, null, 2), "utf8");
  logger.debug({ runId, chunkId, companyId, filePath }, "Chunk enqueued to encrypted spool");
  return filePath;
}

module.exports = {
  DEFAULT_SPOOL_DIR,
  ensureSpoolDir,
  enqueueChunk
};
