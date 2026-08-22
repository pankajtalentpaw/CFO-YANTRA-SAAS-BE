const pino = require("pino");
const { nodeEnv, logLevel } = require("../config/env");

const logger = pino({
  level: logLevel,
  redact: {
    paths: [
      "password",
      "token",
      "secret",
      "authorization",
      "auth",
      "mongoUri",
      "*.password",
      "*.token",
      "*.secret",
      "*.authorization"
    ],
    censor: "[REDACTED]"
  },
  base: {
    env: nodeEnv,
    service: "cfo-yantra-tally-bridge"
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

function createChildLogger(bindings) {
  return logger.child(bindings);
}

module.exports = {
  logger,
  createChildLogger
};
