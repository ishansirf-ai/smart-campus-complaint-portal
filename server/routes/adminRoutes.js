const express = require("express");
const mongoose = require("mongoose");

const Complaint = require("../models/Complaint");
const User = require("../models/User");
const Feedback = require("../models/Feedback");
const Notification = require("../models/Notification");

const { protect, allowRoles } = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const { categoryDepartmentMap } = require("../config/portal");

const router = express.Router();

const departments = [
  ...new Set(Object.values(categoryDepartmentMap))
];

const statuses = [
  "Submitted",
  "Assigned",
  "In Progress",
  "Resolved",
  "Closed",
  "Reopened",
  "Rejected"
];

// Create student notification.
async function notifyStudent(complaint, message, type) {
  try {
    await Notification.create({
      recipient: complaint.student,
      complaint: complaint._id,
      message,
      type
    });
  } catch (error) {
    console.error("Notification error:", error.message);
  }
}

// Department staff can access only their department complaints.
function getDepartmentScope(user) {
  if (user.role === "department") {
    return {
      department: user.department
    };
  }

  return {};
}

// Build filters for Admin complaint table.
function buildComplaintQuery(req) {
  const query = getDepartmentScope(req.user);

  if (req.user.role === "admin" && req.query.department) {
    query.department = req.query.department;
  }

  if (req.query.status) {
    query.status = req.query.status;
  }

  if (req.query.category) {
    query.category = req.query.category;
  }

  if (req.query.priority) {
    query.priority = req.query.priority;
  }

  if (req.query.isOverdue === "true") {
    query.isOverdue = true;
  }

  return query;
}

// Admin and Department: list/manage complaints.
router.get(
  "/complaints",
  protect,
  allowRoles("admin", "department"),
  async (req, res, next) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(
        Math.max(Number(req.query.limit) || 10, 1),
        50
      );

      const query = buildComplaintQuery(req);

      if (req.query.q) {
        const search = req.query.q.trim();

        query.$or = [
          { ticketId: { $regex: search, $options: "i" } },
          { title: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } }
        ];
      }

      const [complaints, total] = await Promise.all([
        Complaint.find(query)
          .populate(
            "student",
            "fullName email usn department semester"
          )
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
  }
);

// Admin/department sees one complaint detail.
router.get(
  "/complaints/:id",
  protect,
  allowRoles("admin", "department"),
  async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid complaint ID."
        });
      }

      const query = {
        _id: req.params.id,
        ...getDepartmentScope(req.user)
      };

      const complaint = await Complaint.findOne(query)
        .populate(
          "student",
          "fullName email usn department semester"
        )
        .populate("assignedTo", "fullName email department");

      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found."
        });
      }

      res.json({
        success: true,
        complaint
      });
    } catch (error) {
      next(error);
    }
  }
);

// ADMIN ONLY: assign complaint to department/staff member.
router.patch(
  "/complaints/:id/assign",
  protect,
  allowRoles("admin"),
  async (req, res, next) => {
    try {
      const { department, assignedTo, note } = req.body;

      if (!departments.includes(department)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid department."
        });
      }

      const complaint = await Complaint.findById(req.params.id);

      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found."
        });
      }

      let departmentUser = null;

      // Optional: assign a specific department staff member.
      if (assignedTo) {
        if (!mongoose.isValidObjectId(assignedTo)) {
          return res.status(400).json({
            success: false,
            message: "Invalid department user ID."
          });
        }

        departmentUser = await User.findById(assignedTo);

        if (
          !departmentUser ||
          departmentUser.role !== "department"
        ) {
          return res.status(400).json({
            success: false,
            message: "Selected user is not a department staff member."
          });
        }

        if (departmentUser.department !== department) {
          return res.status(400).json({
            success: false,
            message: "Department staff member belongs to another department."
          });
        }
      }

      complaint.department = department;
      complaint.assignedTo = departmentUser
        ? departmentUser._id
        : null;

      // Change Submitted/Reopened complaint to Assigned.
      if (
        complaint.status === "Submitted" ||
        complaint.status === "Reopened"
      ) {
        complaint.status = "Assigned";
      }

      complaint.history.push({
        status: complaint.status,
        note:
          String(note || "").trim() ||
          `Assigned to ${department}.`,
        changedBy: req.user._id
      });

      await complaint.save();

      await notifyStudent(
        complaint,
        `Complaint ${complaint.ticketId} was assigned to ${department}.`,
        "assigned"
      );

      res.json({
        success: true,
        message: "Complaint assigned successfully.",
        complaint
      });
    } catch (error) {
      next(error);
    }
  }
);

// ADMIN OR CORRECT DEPARTMENT: update status and resolution photo.
router.patch(
  "/complaints/:id/status",
  protect,
  allowRoles("admin", "department"),
  upload.single("afterPhoto"),
  async (req, res, next) => {
    try {
      const status = String(req.body.status || "").trim();
      const note = String(req.body.note || "").trim();

      if (!statuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid complaint status."
        });
      }

      const query = {
        _id: req.params.id,
        ...getDepartmentScope(req.user)
      };

      const complaint = await Complaint.findOne(query);

      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found or not allowed."
        });
      }

      // Student controls Reopened only through student route.
      if (status === "Reopened" || status === "Submitted") {
        return res.status(400).json({
          success: false,
          message: "Use a valid department/admin status."
        });
      }

      // Require a note before resolution.
      if (status === "Resolved" && note.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Write a resolution note before marking resolved."
        });
      }

      complaint.status = status;

      // If a staff member uploads proof photo, save its link.
      if (req.file) {
        complaint.afterPhoto = `/uploads/${req.file.filename}`;
      }

      // Set final resolution details.
      if (status === "Resolved") {
        complaint.resolutionNote = note;
        complaint.resolvedAt = new Date();
        complaint.isOverdue = false;
      }

      // Closed means fully finished after student feedback.
      if (status === "Closed") {
        complaint.resolvedAt =
          complaint.resolvedAt || new Date();
      }

      complaint.history.push({
        status,
        note: note || `Status changed to ${status}.`,
        changedBy: req.user._id
      });

      await complaint.save();

      const notificationType =
        status === "Resolved" ? "resolved" : "status-update";

      await notifyStudent(
        complaint,
        `Complaint ${complaint.ticketId} status is now ${status}.`,
        notificationType
      );

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

// Admin/department dashboard cards and chart data.
router.get(
  "/dashboard",
  protect,
  allowRoles("admin", "department"),
  async (req, res, next) => {
    try {
      const scope = getDepartmentScope(req.user);

      const complaints = await Complaint.find(scope);

      const summary = {
        total: complaints.length,
        submitted: complaints.filter(
          (item) => item.status === "Submitted"
        ).length,

        assigned: complaints.filter(
          (item) => item.status === "Assigned"
        ).length,

        inProgress: complaints.filter(
          (item) => item.status === "In Progress"
        ).length,

        resolved: complaints.filter(
          (item) =>
            item.status === "Resolved" ||
            item.status === "Closed"
        ).length,

        overdue: complaints.filter(
          (item) => item.isOverdue
        ).length
      };

      const categoryMap = {};
      const departmentMap = {};

      complaints.forEach((complaint) => {
        categoryMap[complaint.category] =
          (categoryMap[complaint.category] || 0) + 1;

        departmentMap[complaint.department] =
          (departmentMap[complaint.department] || 0) + 1;
      });

      const byCategory = Object.entries(categoryMap).map(
        ([label, value]) => ({ label, value })
      );

      const byDepartment = Object.entries(departmentMap).map(
        ([label, value]) => ({ label, value })
      );

      const resolvedComplaints = complaints.filter(
        (item) => item.resolvedAt
      );

      const averageResolutionHours =
        resolvedComplaints.length === 0
          ? 0
          : Math.round(
              resolvedComplaints.reduce(
                (total, item) =>
                  total +
                  (new Date(item.resolvedAt) -
                    new Date(item.createdAt)) /
                    (1000 * 60 * 60),
                0
              ) / resolvedComplaints.length
            );

      const complaintIds = complaints.map((item) => item._id);

      const feedbackData = await Feedback.aggregate([
        {
          $match: {
            complaint: {
              $in: complaintIds
            }
          }
        },
        {
          $group: {
            _id: null,
            averageRating: {
              $avg: "$rating"
            },
            totalFeedback: {
              $sum: 1
            }
          }
        }
      ]);

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
          feedbackSummary.averageRating.toFixed(1)
        ),
        totalFeedback: feedbackSummary.totalFeedback
      });
    } catch (error) {
      next(error);
    }
  }
);

// Download professional CSV report.
router.get(
  "/export",
  protect,
  allowRoles("admin", "department"),
  async (req, res, next) => {
    try {
      const query = buildComplaintQuery(req);

      const complaints = await Complaint.find(query)
        .populate("student", "fullName email usn")
        .populate("assignedTo", "fullName department")
        .sort({ createdAt: -1 });

      function csvValue(value) {
        return `"${String(value || "")
          .replaceAll('"', '""')
          .replaceAll("\n", " ")}"`;
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
          "Student",
          "Student USN",
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
            csvValue(complaint.student?.fullName),
            csvValue(complaint.student?.usn),
            csvValue(
              complaint.createdAt?.toLocaleDateString("en-GB")
            ),
            csvValue(
              complaint.dueDate?.toLocaleDateString("en-GB")
            ),
            csvValue(
              complaint.resolvedAt?.toLocaleDateString("en-GB")
            )
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
  }
);

module.exports = router;