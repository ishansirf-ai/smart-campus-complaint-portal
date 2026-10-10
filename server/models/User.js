const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const profileSchema = new mongoose.Schema(
  {
    avatar: {
      type: String,
      trim: true,
      default: ""
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 300,
      default: ""
    }
  },
  { _id: false }
);

// One model is shared by student, administrator and department staff. Route
// authorization, not a user-supplied field, decides what each role can do.
const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required."],
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true
    },
    usn: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true
    },
    department: {
      type: String,
      trim: true,
      default: ""
    },
    semester: {
      type: String,
      trim: true,
      default: ""
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: ""
    },
    profile: {
      type: profileSchema,
      default: () => ({})
    },
    password: {
      type: String,
      required: [true, "Password is required."],
      minlength: 6,
      select: false
    },
    role: {
      type: String,
      enum: ["student", "department", "admin"],
      default: "student",
      index: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    passwordResetOtpHash: {
      type: String,
      select: false,
      default: null
    },
    passwordResetOtpExpiresAt: {
      type: Date,
      select: false,
      default: null
    },
    passwordResetRequestedAt: {
      type: Date,
      select: false,
      default: null
    },
    passwordResetAttempts: {
      type: Number,
      select: false,
      default: 0
    },
    // A verified reset token is stored as a hash and is cleared immediately
    // after use, so it cannot be replayed during its JWT expiry period.
    passwordResetSessionHash: {
      type: String,
      select: false,
      default: null
    },
    passwordResetSessionExpiresAt: {
      type: Date,
      select: false,
      default: null
    },
    lastLoginAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// "name" is a convenience alias while existing code continues to use fullName.
userSchema.virtual("name")
  .get(function getName() {
    return this.fullName;
  })
  .set(function setName(value) {
    this.fullName = value;
  });

userSchema.pre("save", async function encryptPassword() {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(
  enteredPassword
) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.index({ role: 1, department: 1, isActive: 1 });

module.exports = mongoose.model("User", userSchema);
