/**
 * CFO Yantra - Authentication Controller
 * Standalone Desktop Mode - Defaults to Active CFO Administrator.
 */

"use strict";

const DEFAULT_USER = {
  id: "cfo-admin",
  mobile: "9876543210",
  fullName: "CFO Administrator",
  email: "admin@cfoyantra.com",
  role: "Owner"
};

async function handleSendOtp(req, res) {
  return res.json({
    success: true,
    message: "Standalone mode active.",
    cooldownSeconds: 0
  });
}

async function handleVerifyOtp(req, res) {
  return res.json({
    success: true,
    token: "standalone-desktop-token",
    user: DEFAULT_USER
  });
}

async function handleRegister(req, res) {
  return res.json({
    success: true,
    message: "Account active.",
    token: "standalone-desktop-token",
    user: DEFAULT_USER
  });
}

async function handleGetMe(req, res) {
  return res.json({
    success: true,
    user: DEFAULT_USER
  });
}

async function handleLogout(req, res) {
  return res.json({
    success: true,
    message: "Logged out."
  });
}

module.exports = {
  sendOtp: handleSendOtp,
  verifyOtp: handleVerifyOtp,
  register: handleRegister,
  getMe: handleGetMe,
  logout: handleLogout
};
