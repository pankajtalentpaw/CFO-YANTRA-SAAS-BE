const fs = require("fs");
const path = require("path");
const { logger } = require("../utils/logger");

/**
 * Clean up uploaded or expired spool files older than retentionMs
 * @param {string} spoolDir
 * @param {number} retentionMs
 * @returns {number} Count of removed files
 */
function cleanupSpool(spoolDir, retentionMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(spoolDir)) {
    return 0;
  }

  const now = Date.now();
  const files = fs.readdirSync(spoolDir);
  let removedCount = 0;

  for (const file of files) {
    if (!file.endsWith(".spool.json")) continue;
    const filePath = path.join(spoolDir, file);
    try {
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > retentionMs) {
        fs.unlinkSync(filePath);
        removedCount++;
      }
    } catch (err) {
      logger.warn({ filePath, error: err.message }, "Failed to clean up spool file");
    }
  }

  return removedCount;
}

module.exports = {
  cleanupSpool
};
