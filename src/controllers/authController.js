/**
 * CFO Yantra - Authentication Controller
 * Manages Mobile OTP verification, User Registration, Session Generation, and Current User profile.
 */

"use strict";

const { HTTP_STATUS, APP_ERROR_CODES, sendError } = require("../constants/statusCodes");
const { sendOtpSchema, verifyOtpSchema, registerSchema } = require("../validations");
const { sendOtp } = require("../services/otpService");
const { loginWithOtp, registerWithOtp, getUserById, verifyToken } = require("../services/authService");
const { logger } = require("../utils/logger");

/**
 * POST /api/v1/auth/send-otp
 * Dispatches OTP to mobile number with 30s resend cooldown.
 */
async function handleSendOtp(req, res) {
  try {
    const parseResult = sendOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        parseResult.error.issues[0]?.message || "Invalid mobile number.",
        APP_ERROR_CODES.INVALID_PAYLOAD,
        parseResult.error.issues
      );
    }

    const { mobile } = parseResult.data;
    const result = await sendOtp(mobile);

    if (!result.success) {
      const status = result.cooldown ? HTTP_STATUS.TOO_MANY_REQUESTS : HTTP_STATUS.BAD_REQUEST;
      return res.status(status).json({
        success: false,
        error: result.error,
        cooldown: result.cooldown || false,
        remainingSeconds: result.remainingSeconds || 0
      });
    }

    return res.json({
      success: true,
      message: result.message,
      cooldownSeconds: result.cooldownSeconds
    });
  } catch (err) {
    logger.error({ err }, "Error in handleSendOtp");
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to send OTP. Please try again.");
  }
}

/**
 * POST /api/v1/auth/verify-otp
 * Verifies mobile number + OTP ("5555" in dev) and issues session token.
 */
async function handleVerifyOtp(req, res) {
  try {
    const parseResult = verifyOtpSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        parseResult.error.issues[0]?.message || "Invalid mobile number or OTP.",
        APP_ERROR_CODES.INVALID_PAYLOAD,
        parseResult.error.issues
      );
    }

    const { mobile, otp } = parseResult.data;
    const authResult = await loginWithOtp(mobile, otp);

    if (!authResult.success) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: authResult.error || "Invalid OTP. Please enter the correct verification code."
      });
    }

    return res.json({
      success: true,
      token: authResult.token,
      user: authResult.user
    });
  } catch (err) {
    logger.error({ err }, "Error in handleVerifyOtp");
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Login verification failed. Please try again.");
  }
}

/**
 * POST /api/v1/auth/register
 * Verifies mobile number + OTP and creates new registered user profile.
 */
async function handleRegister(req, res) {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        parseResult.error.issues[0]?.message || "Invalid registration data.",
        APP_ERROR_CODES.INVALID_PAYLOAD,
        parseResult.error.issues
      );
    }

    const { fullName, mobile, email, otp } = parseResult.data;
    const authResult = await registerWithOtp({ fullName, mobile, email }, otp);

    if (!authResult.success) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: authResult.error || "Registration failed. Invalid OTP."
      });
    }

    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: "Account created successfully.",
      token: authResult.token,
      user: authResult.user
    });
  } catch (err) {
    logger.error({ err }, "Error in handleRegister");
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Registration failed. Please try again.");
  }
}

/**
 * GET /api/v1/auth/me
 * Retrieves current authenticated user from Bearer session token.
 */
async function handleGetMe(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: "Authentication token is missing or invalid."
      });
    }

    const token = authHeader.split(" ")[1];
    const payload = verifyToken(token);

    if (!payload || !payload.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: "Session has expired or token is invalid."
      });
    }

    const user = await getUserById(payload.id);
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: "User not found."
      });
    }

    return res.json({
      success: true,
      user: {
        id: user._id.toString(),
        mobile: user.mobile,
        fullName: user.fullName,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    logger.error({ err }, "Error in handleGetMe");
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to retrieve user profile.");
  }
}

/**
 * POST /api/v1/auth/logout
 * Logs out the user.
 */
async function handleLogout(req, res) {
  return res.json({
    success: true,
    message: "Logged out successfully."
  });
}

module.exports = {
  sendOtp: handleSendOtp,
  verifyOtp: handleVerifyOtp,
  register: handleRegister,
  getMe: handleGetMe,
  logout: handleLogout
};
