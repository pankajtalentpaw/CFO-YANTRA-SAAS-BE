const { Server } = require("socket.io");
const { logger } = require("../utils/logger");

let io = null;

/**
 * Initialize Socket.io with the HTTP server
 * @param {import("http").Server} httpServer
 */
function initRealtimeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    pingInterval: 10000,
    pingTimeout: 5000
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Real-time client connected");

    // Client subscribes to a specific company room
    socket.on("subscribe:company", (companyId) => {
      if (companyId) {
        socket.join(`company:${companyId}`);
        logger.debug({ socketId: socket.id, companyId }, "Client joined company room");
        socket.emit("subscribed", { companyId, timestamp: new Date() });
      }
    });

    socket.on("unsubscribe:company", (companyId) => {
      if (companyId) {
        socket.leave(`company:${companyId}`);
        logger.debug({ socketId: socket.id, companyId }, "Client left company room");
      }
    });

    socket.on("disconnect", (reason) => {
      logger.debug({ socketId: socket.id, reason }, "Real-time client disconnected");
    });
  });

  logger.info("Real-time WebSocket server initialized");
  return io;
}

function getIo() {
  return io;
}

/**
 * Broadcast newly created voucher to subscribed clients
 */
function emitVoucherInserted(companyId, voucher) {
  if (!io) return;
  const payload = {
    action: "INSERT",
    companyId,
    voucher,
    timestamp: new Date().toISOString()
  };
  io.to(`company:${companyId}`).emit("voucher:sync", payload);
  io.emit("tally:voucher:inserted", payload); // Global fallback for unified dashboards
  logger.info({ companyId, voucherNumber: voucher.header?.voucherNumber }, "Realtime event: voucher INSERT emitted");
}

/**
 * Broadcast updated/altered voucher to subscribed clients
 */
function emitVoucherUpdated(companyId, voucher) {
  if (!io) return;
  const payload = {
    action: "UPDATE",
    companyId,
    voucher,
    timestamp: new Date().toISOString()
  };
  io.to(`company:${companyId}`).emit("voucher:sync", payload);
  io.emit("tally:voucher:updated", payload);
  logger.info({ companyId, voucherNumber: voucher.header?.voucherNumber }, "Realtime event: voucher UPDATE emitted");
}

/**
 * Broadcast deleted voucher tombstone to subscribed clients
 */
function emitVoucherDeleted(companyId, deletionMeta) {
  if (!io) return;
  const payload = {
    action: "DELETE",
    companyId,
    sourceObjectId: deletionMeta.sourceObjectId,
    guid: deletionMeta.guid,
    voucherNumber: deletionMeta.voucherNumber,
    timestamp: new Date().toISOString()
  };
  io.to(`company:${companyId}`).emit("voucher:sync", payload);
  io.emit("tally:voucher:deleted", payload);
  logger.info({ companyId, deletionMeta }, "Realtime event: voucher DELETE emitted");
}

/**
 * Broadcast sync status / CDC heartbeat
 */
function emitSyncStatus(companyId, status) {
  if (!io) return;
  const payload = {
    companyId,
    ...status,
    timestamp: new Date().toISOString()
  };
  io.to(`company:${companyId}`).emit("sync:status", payload);
  io.emit("tally:sync:status", payload);
}

module.exports = {
  initRealtimeSocket,
  getIo,
  emitVoucherInserted,
  emitVoucherUpdated,
  emitVoucherDeleted,
  emitSyncStatus
};
