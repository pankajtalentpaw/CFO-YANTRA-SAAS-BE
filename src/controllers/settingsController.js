const tallyConfigService = require("../services/tallyConfig.service");
const { logger } = require("../utils/logger");

/**
 * Get current Tally and application integration settings
 */
async function getTallySettings(req, res) {
  try {
    const config = tallyConfigService.getActiveConfig();
    return res.json({
      success: true,
      settings: config
    });
  } catch (error) {
    logger.error({ error: error.message }, "Error fetching Tally settings");
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Update and persist Tally connection settings
 */
async function updateTallySettings(req, res) {
  try {
    const updates = req.body || {};

    if (updates.tallyPort !== undefined) {
      const port = Number(updates.tallyPort);
      if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({
          success: false,
          error: "Invalid port number. Port must be between 1 and 65535."
        });
      }
    }

    const updatedConfig = await tallyConfigService.updateTallyConfig(updates);

    // Run a background test on the new configuration to refresh live status
    tallyConfigService.testCandidateConnection({
      host: updatedConfig.tallyHost,
      port: updatedConfig.tallyPort,
      companyName: updatedConfig.targetCompany
    }).catch((err) => {
      logger.warn({ error: err.message }, "Background probe after settings save failed");
    });

    return res.json({
      success: true,
      message: "Tally configuration updated successfully",
      settings: updatedConfig
    });
  } catch (error) {
    logger.error({ error: error.message }, "Error saving Tally settings");
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Test connectivity with candidate parameters
 */
async function testTallyConnection(req, res) {
  try {
    const { host, port, protocol, companyName } = req.body || {};
    const result = await tallyConfigService.testCandidateConnection({
      host,
      port,
      protocol,
      companyName
    });

    return res.json(result);
  } catch (error) {
    logger.error({ error: error.message }, "Error during Tally candidate test");
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  getTallySettings,
  updateTallySettings,
  testTallyConnection
};
