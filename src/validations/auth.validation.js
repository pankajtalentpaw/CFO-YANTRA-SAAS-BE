/**
 * Authentication Zod Validation Schemas
 */

"use strict";

const { z } = require("zod");

// Mobile number input schema
const sendOtpSchema = z.object({
  mobile: z
    .string({ required_error: "Mobile number is required." })
    .min(10, "Mobile number must be at least 10 digits.")
    .max(15, "Mobile number cannot exceed 15 digits.")
});

// OTP verification schema
const verifyOtpSchema = z.object({
  mobile: z
    .string({ required_error: "Mobile number is required." })
    .min(10, "Mobile number must be at least 10 digits.")
    .max(15, "Mobile number cannot exceed 15 digits."),
  otp: z
    .string({ required_error: "OTP is required." })
    .regex(/^\d{4}$/, "OTP must be exactly 4 numeric digits.")
});

// User registration schema
const registerSchema = z.object({
  fullName: z
    .string({ required_error: "Full name is required." })
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(100, "Full name cannot exceed 100 characters."),
  mobile: z
    .string({ required_error: "Mobile number is required." })
    .min(10, "Mobile number must be at least 10 digits.")
    .max(15, "Mobile number cannot exceed 15 digits."),
  email: z
    .string()
    .trim()
    .email("Please provide a valid email address.")
    .optional()
    .or(z.literal(""))
    .nullable(),
  otp: z
    .string({ required_error: "OTP is required." })
    .regex(/^\d{4}$/, "OTP must be exactly 4 numeric digits.")
});

module.exports = {
  sendOtpSchema,
  verifyOtpSchema,
  registerSchema
};
