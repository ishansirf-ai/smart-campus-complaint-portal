const mongoose = require("mongoose");

// Notices are published by an administrator and shown on the public home page.
// They are separate from user notifications, which are private.
const campusNoticeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Notice title is required."],
      trim: true,
      minlength: 3,
      maxlength: 160
    },

    message: {
      type: String,
      required: [true, "Notice message is required."],
      trim: true,
      minlength: 3,
      maxlength: 3000
    },

    // The public page displays every active notice. This field also lets the
    // frontend label notices intended for a particular portal.
    audience: {
      type: String,
      enum: ["all", "student", "department", "admin"],
      default: "all"
    },

    isActive: {
      type: Boolean,
      default: true
    },

    isPinned: {
      type: Boolean,
      default: false
    },

    // An empty expiry date means the notice remains visible until an admin
    // removes it. Expired notices are not returned by the public endpoint.
    expiresAt: {
      type: Date,
      default: null
    },

    publishedAt: {
      type: Date,
      default: Date.now
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  { timestamps: true }
);

campusNoticeSchema.index({ isActive: 1, isPinned: -1, publishedAt: -1 });
campusNoticeSchema.index({ expiresAt: 1 });

module.exports = mongoose.model("CampusNotice", campusNoticeSchema);
