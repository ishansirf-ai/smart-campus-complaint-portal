const rateLimit = require("express-rate-limit");

const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many reset requests. Please wait a few minutes."
  }
});

const passwordResetVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP attempts. Please request a new OTP later."
  }
});

module.exports = {
  passwordResetRequestLimiter,
  passwordResetVerifyLimiter
};
