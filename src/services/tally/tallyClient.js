// Legacy adapter: delegates to modular src/integrations/tally/tally.client.js
const { sendXml, getTallyUrl, checkHeartbeat } = require("../../integrations/tally/tally.client");

module.exports = {
  sendXml,
  getTallyUrl,
  checkHeartbeat
};