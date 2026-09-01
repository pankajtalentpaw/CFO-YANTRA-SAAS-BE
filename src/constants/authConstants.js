/**
 * CFO Yantra Authentication & OTP Constants
 */

"use strict";

const AUTH_CONSTANTS = Object.freeze({
  // Development / testing static verification code
  STATIC_DEV_OTP: "5555",
  OTP_LENGTH: 4,
  RESEND_COOLDOWN_MS: 30 * 1000, // 30 seconds
  OTP_EXPIRY_MS: 5 * 60 * 1000, // 5 minutes
  DEFAULT_ROLE: "admin",
  DEFAULT_COUNTRY_CODE: "+91",
  AUTH_SECRET: process.env.AUTH_SECRET || "cfo_yantra_secure_session_secret_2026"
});

module.exports = AUTH_CONSTANTS;
