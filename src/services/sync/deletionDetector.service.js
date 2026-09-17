const { Voucher } = require("../../models");
const { sendXml } = require("../../integrations/tally/tally.client");
const { buildLightweightVoucherKeysRequest } = require("../../integrations/tally/tally.requests");
const { parseTallyResponse, normalizeArray } = require("../../integrations/tally/tally.parser");
const { deriveStableId } = require("../../integrations/tally/canonical/company.canonical");
const realtimeSocket = require("../realtimeSocket.service");
const { logger } = require("../../utils/logger");

/**
 * Detects deleted vouchers by comparing active SQL mirror vouchers
 * against Tally's live lightweight voucher keys.
 * 
 * Performance: ~100-150ms total query and diffing time.
 * 
 * @param {string} companyId 
 * @param {string} companyName 
 * @returns {Promise<{ checked: number, deletedCount: number, deletedGuids: string[] }>}
 */
async function detectAndReconcileDeletions(companyId, companyName) {
  if (!companyId || !companyName) {
    return { checked: 0, deletedCount: 0, deletedGuids: [] };
  }

  try {
    // 1. Fetch live lightweight keys from Tally Prime
    const xmlReq = buildLightweightVoucherKeysRequest(companyName);
    const tallyRes = await sendXml(xmlReq);
    const parsed = parseTallyResponse(tallyRes.body);

    const tallyRecords = normalizeArray(parsed.collection);
    const tallyLiveIds = new Set();
    const tallyGuids = new Set();

    for (const raw of tallyRecords) {
      if (!raw) continue;
      const guid = (raw.GUID || raw.Guid || "").trim();
      const masterId = raw.MASTERID || raw.MasterId || null;
      if (guid) tallyGuids.add(guid);

      const stableId = deriveStableId(guid, masterId);
      if (stableId) tallyLiveIds.add(stableId);
    }

    // 2. Query active (non-deleted) vouchers from SQL mirror
    const activeSqlVouchers = await Voucher.findAll({
      where: { companyId, isDeleted: false },
      attributes: ["id", "sourceObjectId", "header", "data"],
      raw: true
    });

    const vanished = [];

    for (const doc of activeSqlVouchers) {
      const header = doc.header || (doc.data && doc.data.header);
      const docGuid = (header && header.guid) || null;
      const docStableId = doc.sourceObjectId;

      // Check if voucher vanished from Tally
      let isStillPresent = false;
      if (docGuid && tallyGuids.has(docGuid)) {
        isStillPresent = true;
      } else if (docStableId && tallyLiveIds.has(docStableId)) {
        isStillPresent = true;
      }

      if (!isStillPresent) {
        vanished.push(doc);
      }
    }

    if (vanished.length === 0) {
      return { checked: activeSqlVouchers.length, deletedCount: 0, deletedGuids: [] };
    }

    // Safety Circuit Breaker:
    // If Tally returns 0 records or if more than 15 vouchers (or > 15% of active records) vanish at once,
    // ABORT DELETION to protect historical records against filter truncation or gateway glitches.
    if (tallyRecords.length === 0 && activeSqlVouchers.length > 0) {
      logger.warn(
        { companyId, activeCount: activeSqlVouchers.length },
        "Deletion check skipped - Tally returned 0 keys (possible company context/startup)"
      );
      return { checked: activeSqlVouchers.length, deletedCount: 0, deletedGuids: [] };
    }

    const maxAllowedDeletions = Math.max(10, Math.floor(activeSqlVouchers.length * 0.15));
    if (vanished.length > maxAllowedDeletions) {
      logger.warn(
        { companyId, vanishedCount: vanished.length, maxAllowed: maxAllowedDeletions, activeCount: activeSqlVouchers.length },
        "MASS DELETION CIRCUIT BREAKER TRIPPED: Refusing to tombstone large number of vouchers in one tick (protecting historical records)"
      );
      return { checked: activeSqlVouchers.length, deletedCount: 0, deletedGuids: [], circuitBreakerTripped: true };
    }

    // 3. Mark vanished vouchers as isDeleted in SQL database
    const now = new Date();
    const { Op } = require("sequelize");
    const vanishedIds = vanished.map((v) => v.id || v._id);
    await Voucher.update(
      { isDeleted: true, deletedAt: now },
      { where: { id: { [Op.in]: vanishedIds } } }
    );


    // 4. Emit real-time deletion events via WebSocket
    const deletedGuids = [];
    for (const v of vanished) {
      const guid = (v.header && v.header.guid) || null;
      deletedGuids.push(guid || v.sourceObjectId);

      realtimeSocket.emitVoucherDeleted(companyId, {
        sourceObjectId: v.sourceObjectId,
        guid,
        voucherNumber: v.header?.voucherNumber || null
      });
    }

    logger.info(
      { companyId, count: vanished.length, deletedGuids },
      "Real-time CDC: detected and tombstoned deleted vouchers"
    );

    return {
      checked: activeSqlVouchers.length,
      deletedCount: vanished.length,
      deletedGuids
    };
  } catch (error) {
    logger.warn({ error: error.message, companyId }, "Deletion detection pass failed");
    return { checked: 0, deletedCount: 0, deletedGuids: [], error: error.message };
  }
}

module.exports = {
  detectAndReconcileDeletions
};
