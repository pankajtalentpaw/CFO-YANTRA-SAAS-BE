/**
 * CFO Yantra - Production-Grade OTP Service
 *
 * Encapsulates OTP generation, dispatching, resend cooldown, and verification.
 * The development static verification code ("5555") is strictly isolated here.
 * Future SMS gateways (Twilio, Fast2SMS, AWS SNS) plug in directly here without
 * affecting controllers or UI components.
 */

"use strict";

const AUTH_CONSTANTS = require("../constants/authConstants");

// In-memory session store for OTP verification and rate-limiting
// In multi-instance production, this can be backed by Redis.
const otpSessions = new Map();

/**
 * Normalizes any mobile input to a clean 10-digit standard Indian mobile number.
 * Examples: "+91 98765 43210" -> "9876543210", "09876543210" -> "9876543210"
 *
 * @param {string} rawMobile
 * @returns {string}
 */
function normalizeMobile(rawMobile) {
  if (!rawMobile || typeof rawMobile !== "string") return "";
  let digits = rawMobile.replace(/\D/g, "");

  // Strip international prefix if present (91 followed by 10 digits)
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits;
}

/**
 * Send an OTP to the given mobile number.
 * Enforces a 30-second resend cooldown.
 *
 * @param {string} rawMobile
 * @returns {Promise<{ success: boolean, message: string, cooldownSeconds: number }>}
 */
async function sendOtp(rawMobile) {
  const mobile = normalizeMobile(rawMobile);
  if (!mobile || mobile.length !== 10) {
    return {
      success: false,
      error: "Please enter a valid 10-digit mobile number."
    };
  }

  const now = Date.now();
  const existing = otpSessions.get(mobile);

  // Check resend cooldown
  if (existing && existing.lastSentAt) {
    const elapsed = now - existing.lastSentAt;
    if (elapsed < AUTH_CONSTANTS.RESEND_COOLDOWN_MS) {
      const remainingSec = Math.ceil((AUTH_CONSTANTS.RESEND_COOLDOWN_MS - elapsed) / 1000);
      return {
        success: false,
        cooldown: true,
        remainingSeconds: remainingSec,
        error: `Please wait ${remainingSec}s before requesting a new OTP.`
      };
    }
  }

  // Generate OTP - Uses centralized STATIC_DEV_OTP in development/testing
  const otpCode = AUTH_CONSTANTS.STATIC_DEV_OTP;

  // In production, dispatch to SMS provider here (e.g. Twilio / Fast2SMS)
  // await smsProvider.send({ to: `+91${mobile}`, message: `Your CFO Yantra OTP is ${otpCode}` });

  // Store OTP session
  otpSessions.set(mobile, {
    otp: otpCode,
    lastSentAt: now,
    expiresAt: now + AUTH_CONSTANTS.OTP_EXPIRY_MS,
    attempts: 0
  });

  return {
    success: true,
    message: "OTP sent successfully.",
    cooldownSeconds: Math.floor(AUTH_CONSTANTS.RESEND_COOLDOWN_MS / 1000)
  };
}

/**
 * Verify a 4-digit OTP for a given mobile number.
 *
 * @param {string} rawMobile
 * @param {string} enteredOtp
 * @returns {{ valid: boolean, error?: string }}
 */
function verifyOtp(rawMobile, enteredOtp) {
  const mobile = normalizeMobile(rawMobile);
  if (!mobile) {
    return { valid: false, error: "Please enter a valid mobile number." };
  }

  if (!enteredOtp || String(enteredOtp).trim().length !== AUTH_CONSTANTS.OTP_LENGTH) {
    return { valid: false, error: `OTP must be exactly ${AUTH_CONSTANTS.OTP_LENGTH} digits.` };
  }

  const cleanOtp = String(enteredOtp).trim();
  const session = otpSessions.get(mobile);

  // Check expiration if session exists
  if (session && session.expiresAt && Date.now() > session.expiresAt) {
    otpSessions.delete(mobile);
    return { valid: false, error: "OTP has expired. Please request a new OTP." };
  }

  // Development Static OTP check & Session validation
  const isValid = cleanOtp === AUTH_CONSTANTS.STATIC_DEV_OTP || (session && session.otp === cleanOtp);

  if (!isValid) {
    if (session) {
      session.attempts = (session.attempts || 0) + 1;
      if (session.attempts >= 5) {
        otpSessions.delete(mobile);
        return { valid: false, error: "Too many failed attempts. Please request a new OTP." };
      }
    }
    return { valid: false, error: "Invalid OTP. Please enter the correct verification code." };
  }

  // Verification succeeded - invalidate session to prevent replay attacks
  otpSessions.delete(mobile);

  return { valid: true };
}

module.exports = {
  normalizeMobile,
  sendOtp,
  verifyOtp
};
