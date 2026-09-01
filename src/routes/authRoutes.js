/**
 * CFO Yantra Authentication Routes
 */

"use strict";

const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

router.post("/send-otp", authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);
router.post("/register", authController.register);
router.get("/me", authController.getMe);
router.post("/logout", authController.logout);

module.exports = router;
