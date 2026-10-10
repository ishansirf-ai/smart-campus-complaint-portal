const mongoose = require("mongoose");

// Every status action is retained so students, staff, and administrators can
// see a clear complaint timeline.
const historySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 1000, default: "" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    originalName: { type: String, trim: true, maxlength: 180, default: "" },
    mimeType: { type: String, trim: true, maxlength: 100, default: "" },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const departmentRemarkSchema = new mongoose.Schema(
  {
    remark: { type: String, required: true, trim: true, maxlength: 1000 },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    addedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const workAssignmentSchema = new mongoose.Schema(
  {
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    workDescription: { type: String, required: true, trim: true, maxlength: 1000 },
    dueDate: { type: Date, required: true },
    workStatus: {
      type: String,
      enum: ["Assigned", "In Progress", "Completed"],
      default: "Assigned"
    },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const locationDetailsSchema = new mongoose.Schema(
  {
    block: { type: String, trim: true, maxlength: 80, default: "" },
    room: { type: String, trim: true, maxlength: 80, default: "" }
  },
  { _id: false }
);

const busDetailsSchema = new mongoose.Schema(
  {
    problemType: { type: String, trim: true, maxlength: 100, default: "" },
    busNumber: { type: String, trim: true, maxlength: 50, default: "" },
    route: { type: String, trim: true, maxlength: 120, default: "" },
    busStop: { type: String, trim: true, maxlength: 120, default: "" },
    travelDate: { type: Date, default: null },
    travelTime: { type: String, trim: true, maxlength: 30, default: "" }
  },
  { _id: false }
);

const complaintSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: {
      type: String,
      required: [true, "Complaint title is required."],
      trim: true,
      minlength: 5,
      maxlength: 120
    },
    // A Category document validates new submissions. Avoiding a static enum
    // preserves historic category values when admins manage categories.
    category: { type: String, required: true, trim: true, maxlength: 100, index: true },
    location: {
      type: String,
      required: [true, "Exact location is required."],
      trim: true,
      minlength: 3,
      maxlength: 150
    },
    locationDetails: { type: locationDetailsSchema, default: () => ({}) },
    busDetails: { type: busDetailsSchema, default: () => ({}) },
    priority: {
      type: String,
      enum: ["Low", "Normal", "High", "Emergency"],
      default: "Normal"
    },
    description: {
      type: String,
      required: [true, "Description is required."],
      trim: true,
      minlength: 10,
      maxlength: 2000
    },
    // Set by backend category routing; students cannot select it themselves.
    department: { type: String, required: true, trim: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    acceptedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["Submitted", "Assigned", "In Progress", "Resolved", "Closed", "Reopened", "Rejected"],
      default: "Submitted",
      index: true
    },
    isOverdue: { type: Boolean, default: false },
    isEscalated: { type: Boolean, default: false, index: true },
    escalatedAt: { type: Date, default: null },
    dueDate: { type: Date, required: true, index: true },
    // Retained for existing screens while the attachments array supports PDF
    // and multiple evidence files.
    beforePhoto: { type: String, default: "" },
    afterPhoto: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    departmentRemarks: { type: [departmentRemarkSchema], default: [] },
    adminResponse: { type: String, trim: true, maxlength: 1000, default: "" },
    workAssignments: { type: [workAssignmentSchema], default: [] },
    resolutionNote: { type: String, trim: true, maxlength: 1000, default: "" },
    resolvedAt: { type: Date, default: null },
    reopenReason: { type: String, trim: true, maxlength: 500, default: "" },
    reopenCount: { type: Number, default: 0 },
    similarTo: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint", default: null },
    history: { type: [historySchema], default: [] }
  },
  { timestamps: true }
);

complaintSchema.index({ student: 1, createdAt: -1 });
complaintSchema.index({ department: 1, status: 1, createdAt: -1 });
complaintSchema.index({ isOverdue: 1, dueDate: 1 });

module.exports = mongoose.model("Complaint", complaintSchema);
