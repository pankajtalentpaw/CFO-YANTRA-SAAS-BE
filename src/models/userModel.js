const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    fullName: {
      type: String,
      trim: true,
      default: ""
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null
    },
    role: {
      type: String,
      enum: ["admin", "cfo", "viewer"],
      default: "admin"
    },
    isVerified: {
      type: Boolean,
      default: true
    },
    lastLoginAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Prevent mongoose OverwriteModelError in watch / dev mode
const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
