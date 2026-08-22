// Legacy adapter: delegates to modular src/integrations/tally/tally.health.js
const { probeTally } = require("../../integrations/tally/tally.health");

module.exports = {
  probeTally
};