const mongoose = require("mongoose");
const { DEPARTMENT_CODES } = require("../config/portal");

const departmentSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      enum: DEPARTMENT_CODES,
      required: true,
      uppercase: true,
      trim: true,
      unique: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    description: {
      type: String,
      trim: true,
      maxlength: 400,
      default: ""
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Department", departmentSchema);
