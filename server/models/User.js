const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// This schema defines Student, Admin and Department users.
const userSchema = new mongoose.Schema(
  {
    // Full name shown in dashboard.
    fullName: {
      type: String,
      required: [true, "Full name is required."],
      trim: true,
      minlength: 2,
      maxlength: 80
    },

    // Email is used for login.
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true
    },

    // USN is mainly for students.
    usn: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true
    },

    // Student branch, or department employee's assigned department.
    department: {
      type: String,
      trim: true,
      default: ""
    },

    // Student semester.
    semester: {
      type: String,
      trim: true,
      default: ""
    },

    // Password is hidden by default for security.
    password: {
      type: String,
      required: [true, "Password is required."],
      minlength: 6,
      select: false
    },

    // Three project roles.
    role: {
      type: String,
      enum: ["student", "department", "admin"],
      default: "student"
    },

    // Admin can disable an account if needed.
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    // Automatically adds createdAt and updatedAt.
    timestamps: true
  }
);

// Before saving a new password, convert it into encrypted hash.
userSchema.pre("save", async function encryptPassword(next) {
  // Do not encrypt again when password was not changed.
  if (!this.isModified("password")) {
    return next();
  }

  // Create encrypted password.
  this.password = await bcrypt.hash(this.password, 12);

  next();
});

// This function checks login password against encrypted password.
userSchema.methods.comparePassword = async function comparePassword(
  enteredPassword
) {
  return bcrypt.compare(enteredPassword, this.password);
};

// Create MongoDB collection model named User.
module.exports = mongoose.model("User", userSchema);