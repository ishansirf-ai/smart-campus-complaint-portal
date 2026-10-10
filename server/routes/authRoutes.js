const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");

const User = require("../models/User");
const { protect } = require("../middleware/auth");
const {
  passwordResetRequestLimiter,
  passwordResetVerifyLimiter
} = require("../middleware/rateLimits");
const { isValidDepartment } = require("../config/portal");
const { publicUser } = require("../utils/publicUser");
const { writeAudit } = require("../utils/audit");
const { sendPasswordResetOtp } = require("../services/emailService");

const router = express.Router();

const portalRoles = {
  student: "student",
  admin: "admin",
  department: "department"
};

function validationMessage(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;

  res.status(400).json({
    success: false,
    message: errors.array()[0].msg
  });
  return true;
}

function sessionToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      purpose: "session"
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function passwordResetToken(user, resetNonce) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      purpose: "password-reset",
      resetNonce
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function otpHash(otp) {
  return crypto.createHash("sha256").update(String(otp)).digest("hex");
}

function clearResetFields(user) {
  user.passwordResetOtpHash = null;
  user.passwordResetOtpExpiresAt = null;
  user.passwordResetRequestedAt = null;
  user.passwordResetAttempts = 0;
}

function clearResetSession(user) {
  user.passwordResetSessionHash = null;
  user.passwordResetSessionExpiresAt = null;
}

function hashesMatch(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function loginRules() {
  return [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Enter a valid email address."),
    body("password")
      .notEmpty()
      .withMessage("Password is required.")
  ];
}

function loginForRole(expectedRole) {
  return async (req, res, next) => {
    try {
      if (validationMessage(req, res)) return;

      const email = req.body.email.trim().toLowerCase();
      const password = req.body.password;
      const user = await User.findOne({ email }).select("+password");

      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password."
        });
      }

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "This account has been disabled. Contact the administrator."
        });
      }

      if (expectedRole && user.role !== expectedRole) {
        return res.status(403).json({
          success: false,
          message: "This account belongs to a different portal. Use the correct login page."
        });
      }

      user.lastLoginAt = new Date();
      await user.save();

      await writeAudit({
        req,
        actor: user._id,
        action: "AUTH_LOGIN",
        entityType: "User",
        entityId: user._id,
        details: { role: user.role }
      });

      res.json({
        success: true,
        message: "Login successful.",
        token: sessionToken(user),
        user: publicUser(user)
      });
    } catch (error) {
      next(error);
    }
  };
}

// Public registration can only ever create a student. role and department
// values supplied by a browser cannot create privileged accounts.
router.post(
  "/register",
  [
    body("fullName")
      .trim()
      .isLength({ min: 2, max: 80 })
      .withMessage("Full name must contain 2 to 80 characters."),
    body("email")
      .trim()
      .isEmail()
      .withMessage("Enter a valid email address."),
    body("password")
      .isLength({ min: 6, max: 128 })
      .withMessage("Password must contain 6 to 128 characters."),
    body("usn")
      .trim()
      .isLength({ min: 4, max: 30 })
      .withMessage("USN must contain 4 to 30 characters."),
    body("department")
      .trim()
      .custom((value) => {
        if (!isValidDepartment(value)) {
          throw new Error("Select a valid department.");
        }
        return true;
      }),
    body("semester")
      .trim()
      .isLength({ min: 1, max: 10 })
      .withMessage("Select a semester.")
  ],
  async (req, res, next) => {
    try {
      if (validationMessage(req, res)) return;

      const email = req.body.email.trim().toLowerCase();
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "An account already exists with this email."
        });
      }

      const user = await User.create({
        fullName: req.body.fullName,
        email,
        password: req.body.password,
        usn: req.body.usn,
        department: req.body.department,
        semester: req.body.semester,
        phone: String(req.body.phone || "").trim(),
        role: "student"
      });

      await writeAudit({
        req,
        actor: user._id,
        action: "STUDENT_REGISTERED",
        entityType: "User",
        entityId: user._id
      });

      res.status(201).json({
        success: true,
        message: "Student account created successfully.",
        token: sessionToken(user),
        user: publicUser(user)
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post("/student/login", loginRules(), loginForRole("student"));
router.post("/admin/login", loginRules(), loginForRole("admin"));
router.post(
  "/department/login",
  loginRules(),
  loginForRole("department")
);

// Kept for old API clients. The new user interface only calls the three
// portal-specific login endpoints above.
router.post("/login", loginRules(), loginForRole(null));

router.get("/me", protect, (req, res) => {
  res.json({
    success: true,
    user: publicUser(req.user)
  });
});

router.patch(
  "/profile",
  protect,
  [
    body("fullName")
      .optional()
      .trim()
      .isLength({ min: 2, max: 80 })
      .withMessage("Full name must contain 2 to 80 characters."),
    body("phone")
      .optional()
      .trim()
      .isLength({ max: 20 })
      .withMessage("Phone must contain at most 20 characters."),
    body("semester")
      .optional()
      .trim()
      .isLength({ max: 10 })
      .withMessage("Semester must contain at most 10 characters."),
    body("bio")
      .optional()
      .trim()
      .isLength({ max: 300 })
      .withMessage("Bio must contain at most 300 characters.")
  ],
  async (req, res, next) => {
    try {
      if (validationMessage(req, res)) return;

      const allowed = ["fullName", "phone", "semester"];
      allowed.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
          req.user[field] = String(req.body[field] || "").trim();
        }
      });

      if (Object.prototype.hasOwnProperty.call(req.body, "bio")) {
        req.user.profile = {
          ...(req.user.profile?.toObject?.() || req.user.profile || {}),
          bio: String(req.body.bio || "").trim()
        };
      }

      await req.user.save();

      await writeAudit({
        req,
        action: "PROFILE_UPDATED",
        entityType: "User",
        entityId: req.user._id
      });

      res.json({
        success: true,
        message: "Profile updated successfully.",
        user: publicUser(req.user)
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/change-password",
  protect,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required."),
    body("newPassword")
      .isLength({ min: 6, max: 128 })
      .withMessage("New password must contain 6 to 128 characters."),
    body("confirmPassword")
      .notEmpty()
      .withMessage("Confirm your new password.")
  ],
  async (req, res, next) => {
    try {
      if (validationMessage(req, res)) return;

      if (req.body.newPassword !== req.body.confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "New password and confirmation do not match."
        });
      }

      const user = await User.findById(req.user._id).select(
        "+password +passwordResetSessionHash +passwordResetSessionExpiresAt"
      );

      if (!(await user.comparePassword(req.body.currentPassword))) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect."
        });
      }

      user.password = req.body.newPassword;
      clearResetFields(user);
      clearResetSession(user);
      await user.save();

      await writeAudit({
        req,
        action: "PASSWORD_CHANGED",
        entityType: "User",
        entityId: user._id
      });

      res.json({
        success: true,
        message: "Password changed successfully."
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/password-reset/request",
  passwordResetRequestLimiter,
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Enter a valid email address."),
    body("portal")
      .trim()
      .isIn(Object.keys(portalRoles))
      .withMessage("Select a valid portal.")
  ],
  async (req, res, next) => {
    try {
      if (validationMessage(req, res)) return;

      const email = req.body.email.trim().toLowerCase();
      const portal = req.body.portal;
      const expectedRole = portalRoles[portal];
      const genericResponse = {
        success: true,
        message: "If this account is registered in this portal, an OTP has been sent.",
        resendAfterSeconds: 60
      };

      const user = await User.findOne({
        email,
        role: expectedRole,
        isActive: true
      }).select(
        "+passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetRequestedAt +passwordResetAttempts +passwordResetSessionHash +passwordResetSessionExpiresAt"
      );

      // Do not reveal whether an email exists in the requested portal.
      if (!user) {
        return res.json(genericResponse);
      }

      const now = Date.now();
      const lastRequest = user.passwordResetRequestedAt?.getTime() || 0;

      if (now - lastRequest < 60 * 1000) {
        return res.json(genericResponse);
      }

      const otp = String(crypto.randomInt(1000, 10000));
      clearResetSession(user);
      user.passwordResetOtpHash = otpHash(otp);
      user.passwordResetOtpExpiresAt = new Date(now + 10 * 60 * 1000);
      user.passwordResetRequestedAt = new Date(now);
      user.passwordResetAttempts = 0;
      await user.save();

      try {
        await sendPasswordResetOtp({
          to: user.email,
          fullName: user.fullName,
          otp,
          portal
        });
      } catch (emailError) {
        clearResetFields(user);
        await user.save();
        throw emailError;
      }

      await writeAudit({
        req,
        actor: user._id,
        action: "PASSWORD_RESET_OTP_SENT",
        entityType: "User",
        entityId: user._id,
        details: { portal }
      });

      res.json(genericResponse);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/password-reset/verify",
  passwordResetVerifyLimiter,
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Enter a valid email address."),
    body("portal")
      .trim()
      .isIn(Object.keys(portalRoles))
      .withMessage("Select a valid portal."),
    body("otp")
      .trim()
      .matches(/^[0-9]{4}$/)
      .withMessage("Enter the 4-digit OTP.")
  ],
  async (req, res, next) => {
    try {
      if (validationMessage(req, res)) return;

      const user = await User.findOne({
        email: req.body.email.trim().toLowerCase(),
        role: portalRoles[req.body.portal],
        isActive: true
      }).select(
        "+passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetRequestedAt +passwordResetAttempts +passwordResetSessionHash +passwordResetSessionExpiresAt"
      );

      const invalid = !user ||
        !user.passwordResetOtpHash ||
        !user.passwordResetOtpExpiresAt ||
        user.passwordResetOtpExpiresAt.getTime() < Date.now() ||
        user.passwordResetOtpHash !== otpHash(req.body.otp);

      if (invalid) {
        if (user) {
          user.passwordResetAttempts += 1;
          if (user.passwordResetAttempts >= 5 ||
              (user.passwordResetOtpExpiresAt &&
                user.passwordResetOtpExpiresAt.getTime() < Date.now())) {
            clearResetFields(user);
          }
          await user.save();
        }

        return res.status(400).json({
          success: false,
          message: "OTP is invalid, expired, or already used."
        });
      }

      // OTP becomes invalid as soon as verification succeeds. The short
      // reset session below is stored server-side and is also single-use.
      clearResetFields(user);
      const resetNonce = crypto.randomBytes(32).toString("hex");
      user.passwordResetSessionHash = otpHash(resetNonce);
      user.passwordResetSessionExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();

      await writeAudit({
        req,
        actor: user._id,
        action: "PASSWORD_RESET_OTP_VERIFIED",
        entityType: "User",
        entityId: user._id,
        details: { portal: req.body.portal }
      });

      res.json({
        success: true,
        message: "OTP verified. Create your new password.",
        resetToken: passwordResetToken(user, resetNonce)
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/password-reset/reset",
  [
    body("resetToken")
      .notEmpty()
      .withMessage("Password reset verification is required."),
    body("newPassword")
      .isLength({ min: 6, max: 128 })
      .withMessage("New password must contain 6 to 128 characters."),
    body("confirmPassword")
      .notEmpty()
      .withMessage("Confirm your new password.")
  ],
  async (req, res, next) => {
    try {
      if (validationMessage(req, res)) return;

      if (req.body.newPassword !== req.body.confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "New password and confirmation do not match."
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(req.body.resetToken, process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({
          success: false,
          message: "Password reset session expired. Request a new OTP."
        });
      }

      if (decoded.purpose !== "password-reset") {
        return res.status(401).json({
          success: false,
          message: "Invalid password reset session."
        });
      }

      const user = await User.findById(decoded.id).select(
        "+password +passwordResetSessionHash +passwordResetSessionExpiresAt"
      );

      const resetSessionIsValid = user &&
        user.passwordResetSessionExpiresAt &&
        user.passwordResetSessionExpiresAt.getTime() >= Date.now() &&
        hashesMatch(user.passwordResetSessionHash, otpHash(decoded.resetNonce));

      if (!user || !user.isActive || user.role !== decoded.role || !resetSessionIsValid) {
        return res.status(401).json({
          success: false,
          message: "Password reset session is no longer valid."
        });
      }

      user.password = req.body.newPassword;
      clearResetFields(user);
      clearResetSession(user);
      await user.save();

      await writeAudit({
        req,
        actor: user._id,
        action: "PASSWORD_RESET_COMPLETED",
        entityType: "User",
        entityId: user._id
      });

      res.json({
        success: true,
        message: "Password reset successfully. Please log in."
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
