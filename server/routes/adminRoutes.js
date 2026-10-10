const express = require("express");
const mongoose = require("mongoose");

const Complaint = require("../models/Complaint");
const User = require("../models/User");
const Department = require("../models/Department");
const Category = require("../models/Category");
const Feedback = require("../models/Feedback");
const Notification = require("../models/Notification");
const AuditLog = require("../models/AuditLog");
const SystemSetting = require("../models/SystemSetting");

const { protect, adminOnly } = require("../middleware/auth");
const { imageUpload } = require("../middleware/upload");
const {
  DEPARTMENT_CODES,
  isValidDepartment,
  isValidRoutingTarget,
  getDueDate
} = require("../config/portal");
const { publicUser } = require("../utils/publicUser");
const {
  createNotification,
  notifyDepartment
} = require("../utils/notifications");
const { writeAudit } = require("../utils/audit");

const router = express.Router();

const statuses = [
  "Submitted",
  "Assigned",
  "In Progress",
  "Resolved",
  "Closed",
  "Reopened",
  "Rejected"
];
const manageableStatuses = [
  "Assigned",
  "In Progress",
  "Resolved",
  "Closed",
  "Rejected"
];
const priorities = ["Low", "Normal", "High", "Emergency"];

router.use(protect, adminOnly);

function escapeRegex(text) {
  return Array.from(text)
    .map((character) =>
      "\\.^$|?*+()[]{}".includes(character)
        ? "\\" + character
        : character
    )
    .join("");
}

function buildComplaintQuery(req) {
  const query = {};
  ["department", "status", "category", "priority"].forEach((field) => {
    if (req.query[field]) query[field] = String(req.query[field]).trim();
  });
  if (req.query.isOverdue === "true") query.isOverdue = true;
  if (req.query.q) {
    const search = escapeRegex(String(req.query.q).trim());
    query.$or = [
      { ticketId: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } },
      { location: { $regex: search, $options: "i" } }
    ];
  }
  return query;
}

async function getComplaintDetails(id) {
  return Complaint.findById(id)
    .populate("student", "fullName email usn department semester phone")
    .populate("assignedTo", "fullName email department phone")
    .populate("acceptedBy", "fullName department")
    .populate("departmentRemarks.addedBy", "fullName department")
    .populate("workAssignments.assignedTo", "fullName department")
    .populate("workAssignments.assignedBy", "fullName department");
}

async function notifyStudent(complaint, message, type) {
  return createNotification({
    recipient: complaint.student,
    complaint: complaint._id,
    message,
    type
  });
}

router.get("/dashboard", async (req, res, next) => {
  try {
    const [
      complaints,
      studentCount,
      staffCount,
      departmentCount,
      feedbackData
    ] = await Promise.all([
      Complaint.find({}),
      User.countDocuments({ role: "student", isActive: true }),
      User.countDocuments({ role: "department", isActive: true }),
      Department.countDocuments({}),
      Feedback.aggregate([
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            totalFeedback: { $sum: 1 }
          }
        }
      ])
    ]);

    const summary = {
      total: complaints.length,
      submitted: complaints.filter((item) => item.status === "Submitted")
        .length,
      assigned: complaints.filter((item) => item.status === "Assigned")
        .length,
      inProgress: complaints.filter((item) => item.status === "In Progress")
        .length,
      resolved: complaints.filter((item) =>
        ["Resolved", "Closed"].includes(item.status)
      ).length,
      overdue: complaints.filter((item) => item.isOverdue).length,
      students: studentCount,
      staff: staffCount,
      departments: departmentCount
    };

    const byCategory = Object.entries(
      complaints.reduce((totals, complaint) => {
        totals[complaint.category] = (totals[complaint.category] || 0) + 1;
        return totals;
      }, {})
    ).map(([label, value]) => ({ label, value }));

    const byDepartment = Object.entries(
      complaints.reduce((totals, complaint) => {
        totals[complaint.department] =
          (totals[complaint.department] || 0) + 1;
        return totals;
      }, {})
    ).map(([label, value]) => ({ label, value }));

    const resolved = complaints.filter((item) => item.resolvedAt);
    const averageResolutionHours = resolved.length
      ? Math.round(
          resolved.reduce((sum, item) => {
            return sum +
              (new Date(item.resolvedAt) - new Date(item.createdAt)) /
                (1000 * 60 * 60);
          }, 0) / resolved.length
        )
      : 0;
    const feedbackSummary = feedbackData[0] || {
      averageRating: 0,
      totalFeedback: 0
    };

    res.json({
      success: true,
      summary,
      byCategory,
      byDepartment,
      averageResolutionHours,
      averageFeedbackRating: Number(
        Number(feedbackSummary.averageRating || 0).toFixed(1)
      ),
      totalFeedback: feedbackSummary.totalFeedback
    });
  } catch (error) {
    next(error);
  }
});

router.get("/complaints", async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const query = buildComplaintQuery(req);
    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .populate("student", "fullName email usn department semester")
        .populate("assignedTo", "fullName email department")
        .sort({ isOverdue: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Complaint.countDocuments(query)
    ]);

    res.json({
      success: true,
      complaints,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/complaints/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid complaint ID."
      });
    }
    const complaint = await getComplaintDetails(req.params.id);
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found."
      });
    }
    res.json({ success: true, complaint });
  } catch (error) {
    next(error);
  }
});

// Admin can route or re-route any complaint and may choose a staff member in
// the selected department.
router.patch("/complaints/:id/assign", async (req, res, next) => {
  try {
    const department = String(req.body.department || "").trim();
    const assignedTo = String(req.body.assignedTo || "").trim();
    const note = String(req.body.note || "").trim();

    if (!isValidDepartment(department)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid department."
      });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid complaint ID."
      });
    }

    const departmentRecord = await Department.findOne({
      code: department,
      isActive: true
    });
    if (!departmentRecord) {
      return res.status(400).json({
        success: false,
        message: "This department is inactive."
      });
    }

    let staffMember = null;
    if (assignedTo) {
      if (!mongoose.isValidObjectId(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: "Invalid department staff member."
        });
      }
      staffMember = await User.findOne({
        _id: assignedTo,
        role: "department",
        department,
        isActive: true
      });
      if (!staffMember) {
        return res.status(400).json({
          success: false,
          message: "Selected staff member is not active in this department."
        });
      }
    }

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found."
      });
    }

    complaint.department = department;
    complaint.assignedTo = staffMember?._id || null;
    if (["Submitted", "Reopened"].includes(complaint.status)) {
      complaint.status = "Assigned";
    }
    complaint.history.push({
      status: complaint.status,
      note: note || "Assigned to " + department + ".",
      changedBy: req.user._id
    });
    await complaint.save();

    await notifyStudent(
      complaint,
      "Complaint " + complaint.ticketId + " was assigned to " + department + ".",
      "assigned"
    );
    await notifyDepartment({
      department,
      complaint: complaint._id,
      message:
        "Complaint " +
        complaint.ticketId +
        " was assigned to your department.",
      type: "department-assignment"
    });
    if (staffMember) {
      await createNotification({
        recipient: staffMember._id,
        complaint: complaint._id,
        message:
          "You were assigned complaint " +
          complaint.ticketId +
          ".",
        type: "work-assigned"
      });
    }
    await writeAudit({
      req,
      action: "ADMIN_COMPLAINT_ASSIGNED",
      entityType: "Complaint",
      entityId: complaint._id,
      details: { department, assignedTo: staffMember?._id || null }
    });

    res.json({
      success: true,
      message: "Complaint assigned successfully.",
      complaint
    });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/complaints/:id/status",
  imageUpload.single("afterPhoto"),
  async (req, res, next) => {
    try {
      const status = String(req.body.status || "").trim();
      const note = String(req.body.note || "").trim();
      if (!manageableStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid administrative status."
        });
      }
      if (status === "Resolved" && note.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Write resolution details before marking resolved."
        });
      }

      const complaint = await Complaint.findById(req.params.id);
      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found."
        });
      }

      complaint.status = status;
      if (note) complaint.adminResponse = note;
      if (req.file) complaint.afterPhoto = "/uploads/" + req.file.filename;
      if (status === "Resolved") {
        complaint.resolutionNote = note;
        complaint.resolvedAt = new Date();
        complaint.isOverdue = false;
      }
      if (status === "Closed") {
        complaint.resolvedAt = complaint.resolvedAt || new Date();
      }
      complaint.history.push({
        status,
        note: note || "Administrator changed status to " + status + ".",
        changedBy: req.user._id
      });
      await complaint.save();

      await notifyStudent(
        complaint,
        "Complaint " + complaint.ticketId + " status is now " + status + ".",
        status === "Resolved" ? "resolved" : "status-update"
      );
      await notifyDepartment({
        department: complaint.department,
        complaint: complaint._id,
        message:
          "Administrator updated " +
          complaint.ticketId +
          " to " +
          status +
          ".",
        type: "status-update"
      });
      await writeAudit({
        req,
        action: "ADMIN_COMPLAINT_STATUS_CHANGED",
        entityType: "Complaint",
        entityId: complaint._id,
        details: { status }
      });

      res.json({
        success: true,
        message: "Complaint status updated successfully.",
        complaint
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch("/complaints/:id/priority", async (req, res, next) => {
  try {
    const priority = String(req.body.priority || "").trim();
    if (!priorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid priority."
      });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found."
      });
    }

    complaint.priority = priority;
    const requestedDueDate = req.body.dueDate
      ? new Date(req.body.dueDate)
      : null;
    complaint.dueDate =
      requestedDueDate && !Number.isNaN(requestedDueDate.getTime())
        ? requestedDueDate
        : getDueDate(priority);
    complaint.isOverdue = false;
    complaint.history.push({
      status: complaint.status,
      note: "Administrator changed priority to " + priority + ".",
      changedBy: req.user._id
    });
    await complaint.save();
    await notifyStudent(
      complaint,
      "Complaint " + complaint.ticketId + " priority is now " + priority + ".",
      "status-update"
    );
    await writeAudit({
      req,
      action: "ADMIN_PRIORITY_CHANGED",
      entityType: "Complaint",
      entityId: complaint._id,
      details: { priority }
    });
    res.json({ success: true, complaint });
  } catch (error) {
    next(error);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const query = {};
    if (req.query.role) query.role = req.query.role;
    if (req.query.department) query.department = req.query.department;
    if (req.query.active === "true") query.isActive = true;
    if (req.query.active === "false") query.isActive = false;
    if (req.query.q) {
      const search = escapeRegex(String(req.query.q).trim());
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { usn: { $regex: search, $options: "i" } }
      ];
    }

    const users = await User.find(query).sort({ createdAt: -1 });
    res.json({
      success: true,
      users: users.map(publicUser)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/students", async (req, res, next) => {
  try {
    const students = await User.find({ role: "student" })
      .sort({ createdAt: -1 });
    res.json({
      success: true,
      students: students.map(publicUser)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/staff", async (req, res, next) => {
  try {
    const query = { role: "department" };
    if (req.query.department) query.department = req.query.department;
    const staff = await User.find(query).sort({ department: 1, fullName: 1 });
    res.json({
      success: true,
      staff: staff.map(publicUser)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/users", async (req, res, next) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const role = String(req.body.role || "").trim();
    const requestedDepartment = String(req.body.department || "").trim();

    if (fullName.length < 2 || fullName.length > 80) {
      return res.status(400).json({
        success: false,
        message: "Full name must contain 2 to 80 characters."
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address."
      });
    }
    if (password.length < 6 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password must contain 6 to 128 characters."
      });
    }
    if (!["student", "department", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid user role."
      });
    }
    if (
      (role === "department" || requestedDepartment) &&
      role !== "admin" &&
      !isValidDepartment(requestedDepartment)
    ) {
      return res.status(400).json({
        success: false,
        message: "Select one of the five valid departments."
      });
    }
    if (await User.exists({ email })) {
      return res.status(409).json({
        success: false,
        message: "An account already exists with this email."
      });
    }

    const user = await User.create({
      fullName,
      email,
      password,
      role,
      department: role === "admin" ? "Administration" : requestedDepartment,
      usn: String(req.body.usn || "").trim(),
      semester: String(req.body.semester || "").trim(),
      phone: String(req.body.phone || "").trim()
    });
    await writeAudit({
      req,
      action: "ADMIN_USER_CREATED",
      entityType: "User",
      entityId: user._id,
      details: { role: user.role, department: user.department }
    });
    res.status(201).json({
      success: true,
      message: "User created successfully.",
      user: publicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID."
      });
    }
    const user = await User.findById(req.params.id).select("+password");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    const role = req.body.role
      ? String(req.body.role).trim()
      : user.role;
    if (!["student", "department", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid role."
      });
    }
    const department = Object.prototype.hasOwnProperty.call(
      req.body,
      "department"
    )
      ? String(req.body.department || "").trim()
      : user.department;
    if (role === "department" && !isValidDepartment(department)) {
      return res.status(400).json({
        success: false,
        message: "Department staff must belong to one of the five departments."
      });
    }
    if (role === "student" && department && !isValidDepartment(department)) {
      return res.status(400).json({
        success: false,
        message: "Student department must be valid."
      });
    }
    if (user._id.equals(req.user._id) && req.body.isActive === false) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own administrator account."
      });
    }

    ["fullName", "email", "usn", "semester", "phone"].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        user[field] = String(req.body[field] || "").trim();
      }
    });
    user.role = role;
    user.department = role === "admin" ? "Administration" : department;
    if (Object.prototype.hasOwnProperty.call(req.body, "isActive")) {
      user.isActive = Boolean(req.body.isActive);
    }
    if (req.body.password) {
      if (String(req.body.password).length < 6) {
        return res.status(400).json({
          success: false,
          message: "New password must contain at least 6 characters."
        });
      }
      user.password = String(req.body.password);
    }
    await user.save();

    await writeAudit({
      req,
      action: "ADMIN_USER_UPDATED",
      entityType: "User",
      entityId: user._id,
      details: { role: user.role, department: user.department }
    });
    res.json({
      success: true,
      message: "User updated successfully.",
      user: publicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

// Soft deletion preserves historic complaint references and audit integrity.
router.delete("/users/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID."
      });
    }
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own administrator account."
      });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }
    await writeAudit({
      req,
      action: "ADMIN_USER_DEACTIVATED",
      entityType: "User",
      entityId: user._id
    });
    res.json({
      success: true,
      message: "User account deactivated successfully."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/departments", async (req, res, next) => {
  try {
    const departments = await Department.find({}).sort({ code: 1 });
    const enriched = await Promise.all(
      departments.map(async (department) => ({
        ...department.toObject(),
        staffCount: await User.countDocuments({
          role: "department",
          department: department.code,
          isActive: true
        }),
        complaintCount: await Complaint.countDocuments({
          department: department.code
        })
      }))
    );
    res.json({ success: true, departments: enriched });
  } catch (error) {
    next(error);
  }
});

router.patch("/departments/:code", async (req, res, next) => {
  try {
    const code = String(req.params.code || "").toUpperCase();
    if (!DEPARTMENT_CODES.includes(code)) {
      return res.status(400).json({
        success: false,
        message: "Invalid department code."
      });
    }
    const changes = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      changes.name = String(req.body.name || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
      changes.description = String(req.body.description || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "isActive")) {
      changes.isActive = Boolean(req.body.isActive);
    }

    const department = await Department.findOneAndUpdate(
      { code },
      changes,
      { new: true, runValidators: true }
    );
    if (!department) {
      return res.status(404).json({
        success: false,
        message: "Department not found."
      });
    }
    await writeAudit({
      req,
      action: "ADMIN_DEPARTMENT_UPDATED",
      entityType: "Department",
      entityId: department._id,
      details: { code }
    });
    res.json({ success: true, department });
  } catch (error) {
    next(error);
  }
});

router.get("/departments/:code/staff", async (req, res, next) => {
  try {
    const code = String(req.params.code || "").toUpperCase();
    if (!isValidDepartment(code)) {
      return res.status(400).json({
        success: false,
        message: "Invalid department code."
      });
    }
    const staff = await User.find({
      role: "department",
      department: code,
      isActive: true
    }).sort({ fullName: 1 });
    res.json({
      success: true,
      staff: staff.map(publicUser)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/categories", async (req, res, next) => {
  try {
    const categories = await Category.find({}).sort({ name: 1 });
    res.json({ success: true, categories });
  } catch (error) {
    next(error);
  }
});

router.post("/categories", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const department = String(req.body.department || "").trim();
    if (name.length < 2 || name.length > 100 || !isValidRoutingTarget(department)) {
      return res.status(400).json({
        success: false,
        message: "Enter a category name and a valid department."
      });
    }
    const category = await Category.create({
      name,
      department,
      description: String(req.body.description || "").trim()
    });
    await writeAudit({
      req,
      action: "ADMIN_CATEGORY_CREATED",
      entityType: "Category",
      entityId: category._id
    });
    res.status(201).json({ success: true, category });
  } catch (error) {
    next(error);
  }
});

router.patch("/categories/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID."
      });
    }
    const changes = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      changes.name = String(req.body.name || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "department")) {
      const department = String(req.body.department || "").trim();
      if (!isValidRoutingTarget(department)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid department."
        });
      }
      changes.department = department;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
      changes.description = String(req.body.description || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "isActive")) {
      changes.isActive = Boolean(req.body.isActive);
    }
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      changes,
      { new: true, runValidators: true }
    );
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found."
      });
    }
    await writeAudit({
      req,
      action: "ADMIN_CATEGORY_UPDATED",
      entityType: "Category",
      entityId: category._id
    });
    res.json({ success: true, category });
  } catch (error) {
    next(error);
  }
});

router.delete("/categories/:id", async (req, res, next) => {
  try {
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found."
      });
    }
    await writeAudit({
      req,
      action: "ADMIN_CATEGORY_DEACTIVATED",
      entityType: "Category",
      entityId: category._id
    });
    res.json({
      success: true,
      message: "Category deactivated successfully."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/feedback", async (req, res, next) => {
  try {
    const feedback = await Feedback.find({})
      .populate("complaint", "ticketId title department status")
      .populate("student", "fullName email usn")
      .sort({ createdAt: -1 });
    res.json({ success: true, feedback });
  } catch (error) {
    next(error);
  }
});

router.post("/notifications", async (req, res, next) => {
  try {
    const message = String(req.body.message || "").trim();
    const role = String(req.body.role || "").trim();
    const department = String(req.body.department || "").trim();
    if (message.length < 3 || message.length > 300) {
      return res.status(400).json({
        success: false,
        message: "Notification message must contain 3 to 300 characters."
      });
    }
    const query = { isActive: true };
    if (role) {
      if (!["student", "department", "admin"].includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid recipient role."
        });
      }
      query.role = role;
    }
    if (department) {
      if (!isValidDepartment(department)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid department."
        });
      }
      query.department = department;
    }
    const recipients = await User.find(query).select("_id");
    await Notification.insertMany(
      recipients.map((recipient) => ({
        recipient: recipient._id,
        message,
        type: "system"
      }))
    );
    await writeAudit({
      req,
      action: "ADMIN_NOTIFICATION_SENT",
      entityType: "Notification",
      details: { recipientCount: recipients.length, role, department }
    });
    res.json({
      success: true,
      message: "Notification sent to " + recipients.length + " account(s)."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/settings", async (req, res, next) => {
  try {
    const settings = await SystemSetting.find({
      key: { $in: ["portalName", "supportEmail", "maintenanceMessage"] }
    });
    res.json({
      success: true,
      settings: settings.reduce((result, setting) => {
        result[setting.key] = setting.value;
        return result;
      }, {})
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/settings", async (req, res, next) => {
  try {
    const allowed = ["portalName", "supportEmail", "maintenanceMessage"];
    const updates = allowed.filter((key) =>
      Object.prototype.hasOwnProperty.call(req.body, key)
    );
    if (!updates.length) {
      return res.status(400).json({
        success: false,
        message: "No supported setting was supplied."
      });
    }
    await Promise.all(
      updates.map((key) =>
        SystemSetting.updateOne(
          { key },
          {
            $set: {
              value: String(req.body[key] || "").trim(),
              updatedBy: req.user._id
            }
          },
          { upsert: true }
        )
      )
    );
    await writeAudit({
      req,
      action: "ADMIN_SETTINGS_UPDATED",
      entityType: "SystemSetting"
    });
    res.json({
      success: true,
      message: "Portal settings updated successfully."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/activity", async (req, res, next) => {
  try {
    const logs = await AuditLog.find({})
      .populate("actor", "fullName email role department")
      .sort({ createdAt: -1 })
      .limit(150);
    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

router.get("/export", async (req, res, next) => {
  try {
    const complaints = await Complaint.find(buildComplaintQuery(req))
      .populate("student", "fullName email usn")
      .populate("assignedTo", "fullName department")
      .sort({ createdAt: -1 });

    function csvValue(value) {
      return '"' +
        String(value || "")
          .replaceAll('"', '""')
          .replaceAll("\n", " ") +
        '"';
    }

    const rows = [
      [
        "Ticket ID",
        "Title",
        "Category",
        "Location",
        "Priority",
        "Status",
        "Overdue",
        "Department",
        "Assigned Staff",
        "Student",
        "Created Date",
        "Due Date",
        "Resolved Date"
      ].join(",")
    ];

    complaints.forEach((complaint) => {
      rows.push(
        [
          csvValue(complaint.ticketId),
          csvValue(complaint.title),
          csvValue(complaint.category),
          csvValue(complaint.location),
          csvValue(complaint.priority),
          csvValue(complaint.status),
          csvValue(complaint.isOverdue ? "Yes" : "No"),
          csvValue(complaint.department),
          csvValue(complaint.assignedTo?.fullName),
          csvValue(complaint.student?.fullName),
          csvValue(complaint.createdAt?.toLocaleDateString("en-GB")),
          csvValue(complaint.dueDate?.toLocaleDateString("en-GB")),
          csvValue(complaint.resolvedAt?.toLocaleDateString("en-GB"))
        ].join(",")
      );
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="college-complaint-report.csv"'
    );
    res.send(rows.join("\n"));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
