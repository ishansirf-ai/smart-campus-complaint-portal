const mongoose = require("mongoose");

// Student feedback is allowed after a complaint is resolved.
const feedbackSchema = new mongoose.Schema(
  {
    // Complaint being rated.
    complaint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
      required: true
    },

    // Student who gives rating.
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // Rating from 1 to 5.
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },

    // Optional feedback comment.
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },

    // Admin can show feedback anonymously to department staff.
    anonymousToDepartment: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// One student can give only one feedback item for one complaint.
feedbackSchema.index(
  { complaint: 1, student: 1 },
  { unique: true }
);

module.exports = mongoose.model("Feedback", feedbackSchema);