const env = require("../config/env");

async function getCloudStatus(req, res) {
  return res.json({
    cloudApi: "DISCONNECTED",
    cloudEndpoint: "NOT_CONFIGURED",
    cloudSql: "DISCONNECTED",
    targetDatabase: "Cloud SQL / PostgreSQL",
    deviceRegistered: false,
    outboundHttpsOnly: true
  });
}

module.exports = {
  getCloudStatus
};
