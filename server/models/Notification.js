const mongoose = require("mongoose");

// Stores messages shown to students after status updates.
const notificationSchema = new mongoose.Schema(
  {
    // Student receiving notification.
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // Complaint connected to this message.
    complaint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
      required: true
    },

    // Notification message shown in dashboard.
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300
    },

    // Helps frontend show the correct icon/colour.
    type: {
      type: String,
      enum: [
        "complaint-created",
        "assigned",
        "status-update",
        "overdue",
        "resolved",
        "reopened",
        "system"
      ],
      default: "system"
    },

    // Student can mark message as read.
    isRead: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);