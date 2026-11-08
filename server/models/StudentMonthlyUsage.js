const mongoose = require("mongoose");

// A compact, atomic counter for the current student/month combination. The
// Complaint collection remains the permanent history of every submission.
const studentMonthlyUsageSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    monthKey: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/
    },
    submittedCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    }
  },
  { timestamps: true }
);

studentMonthlyUsageSchema.index({ student: 1, monthKey: 1 }, { unique: true });

module.exports = mongoose.model("StudentMonthlyUsage", studentMonthlyUsageSchema);
