const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");

const User = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();

// Create JWT token after successful login/register.
function createToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}

// Remove private data before sending user to browser.
function publicUser(user) {
  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    usn: user.usn,
    department: user.department,
    semester: user.semester,
    role: user.role
  };
}

// Show validation errors clearly.
function showValidationErrors(req, res) {
  const errors = validationResult(req);

  if (errors.isEmpty()) {
    return false;
  }

  res.status(400).json({
    success: false,
    message: errors.array()[0].msg
  });

  return true;
}

// Student registration.
// Important: public users can only create student accounts.
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
      .isLength({ min: 6 })
      .withMessage("Password must contain at least 6 characters."),

    body("usn")
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ min: 4, max: 30 })
      .withMessage("USN must contain 4 to 30 characters.")
  ],
  async (req, res, next) => {
    try {
      if (showValidationErrors(req, res)) return;

      const {
        fullName,
        email,
        password,
        usn,
        department,
        semester
      } = req.body;

      // Check if email already exists.
      const existingUser = await User.findOne({
        email: email.toLowerCase()
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "An account already exists with this email."
        });
      }

      // Create STUDENT only. Never trust role sent by browser.
      const user = await User.create({
        fullName,
        email,
        password,
        usn,
        department,
        semester,
        role: "student"
      });

      const token = createToken(user);

      res.status(201).json({
        success: true,
        message: "Student account created successfully.",
        token,
        user: publicUser(user)
      });
    } catch (error) {
      next(error);
    }
  }
);

// Login route for Student, Admin, and Department staff.
router.post(
  "/login",
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Enter a valid email address."),

    body("password")
      .notEmpty()
      .withMessage("Password is required.")
  ],
  async (req, res, next) => {
    try {
      if (showValidationErrors(req, res)) return;

      const { email, password } = req.body;

      // Password is hidden in User model, so include it only for login.
      const user = await User.findOne({
        email: email.toLowerCase()
      }).select("+password");

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password."
        });
      }

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "This account has been disabled."
        });
      }

      // Compare entered password with encrypted password.
      const passwordCorrect = await user.comparePassword(password);

      if (!passwordCorrect) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password."
        });
      }

      const token = createToken(user);

      res.json({
        success: true,
        message: "Login successful.",
        token,
        user: publicUser(user)
      });
    } catch (error) {
      next(error);
    }
  }
);

// Return current logged-in user.
router.get("/me", protect, async (req, res) => {
  res.json({
    success: true,
    user: publicUser(req.user)
  });
});

module.exports = router;