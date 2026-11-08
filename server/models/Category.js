const mongoose = require("mongoose");
const { ROUTING_TARGETS } = require("../config/portal");

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      maxlength: 100
    },
    department: {
      type: String,
      required: true,
      enum: ROUTING_TARGETS,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: ""
    },
    // Department APIs and assignment endpoints enforce this policy.
    isAdminOnly: {
      type: Boolean,
      default: false,
      index: true
    },
    // Retired categories can remain in historic records without appearing in
    // the new-student submission dropdown.
    isStudentVisible: {
      type: Boolean,
      default: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

categorySchema.index({ isActive: 1, name: 1 });

module.exports = mongoose.model("Category", categorySchema);
