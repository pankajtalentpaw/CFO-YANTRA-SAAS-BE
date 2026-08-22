const env = require("../config/env");

async function getCloudStatus(req, res) {
  return res.json({
    cloudApi: "DISCONNECTED",
    cloudEndpoint: "NOT_CONFIGURED",
    mongoDbAtlas: "DISCONNECTED",
    targetDatabase: "MongoDB Atlas (Phase 5)",
    deviceRegistered: false,
    outboundHttpsOnly: true
  });
}

module.exports = {
  getCloudStatus
};
