/**
 * CFO Yantra - Authentication Service
 * Handles user persistence, session management, secure signed token generation & verification.
 */

"use strict";

const crypto = require("crypto");
const { User } = require("../models");
const AUTH_CONSTANTS = require("../constants/authConstants");
const { verifyOtp, normalizeMobile } = require("./otpService");

/**
 * Creates a cryptographically signed session token without extra dependencies.
 * Format: base64(payload).signature
 */
function generateToken(payload) {
  const data = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days expiration
  };

  const payloadBase64 = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", AUTH_CONSTANTS.AUTH_SECRET)
    .update(payloadBase64)
    .digest("base64url");

  return `${payloadBase64}.${signature}`;
}

/**
 * Verifies and decodes a signed session token.
 */
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadBase64, providedSig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", AUTH_CONSTANTS.AUTH_SECRET)
    .update(payloadBase64)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired token
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Log in a user by verifying their mobile number and OTP.
 *
 * @param {string} rawMobile
 * @param {string} otp
 * @returns {Promise<{ success: boolean, token?: string, user?: object, error?: string }>}
 */
async function loginWithOtp(rawMobile, otp) {
  const mobile = normalizeMobile(rawMobile);
  const otpResult = verifyOtp(mobile, otp);

  if (!otpResult.valid) {
    return { success: false, error: otpResult.error };
  }

  // Find or create user
  let user = await User.findOne({ where: { mobile } });
  if (!user) {
    user = await User.create({
      mobile,
      fullName: `User ${mobile.slice(-4)}`,
      role: AUTH_CONSTANTS.DEFAULT_ROLE,
      isVerified: true,
      lastLoginAt: new Date()
    });
  } else {
    user.isVerified = true;
    user.lastLoginAt = new Date();
    await user.save();
  }

  const token = generateToken({
    id: String(user.id),
    mobile: user.mobile,
    role: user.role
  });

  return {
    success: true,
    token,
    user: {
      id: String(user.id),
      mobile: user.mobile,
      fullName: user.fullName || `User ${mobile.slice(-4)}`,
      email: user.email || null,
      role: user.role
    }
  };
}

/**
 * Register a new user with verified mobile number and details.
 *
 * @param {object} params
 * @param {string} params.fullName
 * @param {string} params.mobile
 * @param {string} [params.email]
 * @param {string} params.otp
 * @returns {Promise<{ success: boolean, token?: string, user?: object, error?: string }>}
 */
async function registerWithOtp({ fullName, mobile: rawMobile, email }, otp) {
  const mobile = normalizeMobile(rawMobile);
  const otpResult = verifyOtp(mobile, otp);

  if (!otpResult.valid) {
    return { success: false, error: otpResult.error };
  }

  // Check if user already exists
  let user = await User.findOne({ where: { mobile } });
  if (user) {
    // Update existing user details
    user.fullName = fullName.trim();
    if (email) user.email = email.trim().toLowerCase();
    user.isVerified = true;
    user.lastLoginAt = new Date();
    await user.save();
  } else {
    // Create new registered user
    user = await User.create({
      mobile,
      fullName: fullName.trim(),
      email: email ? email.trim().toLowerCase() : null,
      role: AUTH_CONSTANTS.DEFAULT_ROLE,
      isVerified: true,
      lastLoginAt: new Date()
    });
  }

  const token = generateToken({
    id: String(user.id),
    mobile: user.mobile,
    role: user.role
  });

  return {
    success: true,
    token,
    user: {
      id: String(user.id),
      mobile: user.mobile,
      fullName: user.fullName,
      email: user.email || null,
      role: user.role
    }
  };
}

/**
 * Retrieve user by ID
 */
async function getUserById(userId) {
  return User.findByPk(userId, { raw: true });
}

module.exports = {
  generateToken,
  verifyToken,
  loginWithOtp,
  registerWithOtp,
  getUserById
};
