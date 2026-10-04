const mongoose = require("mongoose");
const { categoryDepartmentMap } = require("../config/portal");

// Use the same categories defined in portal.js.
const categories = Object.keys(categoryDepartmentMap);

// This stores every status change in the complaint timeline.
const historySchema = new mongoose.Schema(
  {
    // Example: Submitted, Assigned, In Progress, Resolved.
    status: {
      type: String,
      required: true
    },

    // Department/admin can write a short explanation.
    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },

    // User who changed the complaint status.
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    // Date and time of this status change.
    changedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    _id: false
  }
);

// Main complaint collection schema.
const complaintSchema = new mongoose.Schema(
  {
    // Private tracking ID, for example CMP-20261003-A12B.
    ticketId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },

    // Student who submitted complaint.
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    // Short issue heading.
    title: {
      type: String,
      required: [true, "Complaint title is required."],
      trim: true,
      minlength: 5,
      maxlength: 120
    },

    // Electrical, Internet, Cleanliness and so on.
    category: {
      type: String,
      required: true,
      enum: categories
    },

    // Example: Block A - Room 203.
    location: {
      type: String,
      required: [true, "Exact location is required."],
      trim: true,
      minlength: 3,
      maxlength: 150
    },

    // Low / Normal / High / Emergency.
    priority: {
      type: String,
      enum: ["Low", "Normal", "High", "Emergency"],
      default: "Normal"
    },

    // Full problem explanation from student.
    description: {
      type: String,
      required: [true, "Description is required."],
      trim: true,
      minlength: 10,
      maxlength: 2000
    },

    // Automatically selected from category.
    department: {
      type: String,
      required: true,
      trim: true
    },

    // Department staff member assigned to resolve this complaint.
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    // Submitted → Assigned → In Progress → Resolved.
    status: {
      type: String,
      enum: [
        "Submitted",
        "Assigned",
        "In Progress",
        "Resolved",
        "Closed",
        "Reopened",
        "Rejected"
      ],
      default: "Submitted"
    },

    // Separate overdue flag looks more professional than changing status.
    isOverdue: {
      type: Boolean,
      default: false
    },

    // Due date depends on complaint priority.
    dueDate: {
      type: Date,
      required: true
    },

    // Student issue photo path, for example /uploads/photo.jpg.
    beforePhoto: {
      type: String,
      default: ""
    },

    // Department resolution proof photo.
    afterPhoto: {
      type: String,
      default: ""
    },

    // Final explanation written by department/admin.
    resolutionNote: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
    },

    // Date when complaint was resolved.
    resolvedAt: {
      type: Date,
      default: null
    },

    // Student can reopen an unsatisfactory resolution.
    reopenReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },

    // Number of times student reopened complaint.
    reopenCount: {
      type: Number,
      default: 0
    },

    // Complete audit trail/status timeline.
    history: {
      type: [historySchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

// Useful indexes for admin dashboard filtering.
complaintSchema.index({ student: 1, createdAt: -1 });
complaintSchema.index({ department: 1, status: 1 });
complaintSchema.index({ isOverdue: 1, dueDate: 1 });

// Create MongoDB Complaint collection model.
module.exports = mongoose.model("Complaint", complaintSchema);