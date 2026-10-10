const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    action: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      index: true
    },
    entityType: {
      type: String,
      trim: true,
      maxlength: 60,
      default: ""
    },
    entityId: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 100,
      default: ""
    }
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
