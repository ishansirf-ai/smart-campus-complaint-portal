const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");

const Complaint = require("../models/Complaint");
const Notification = require("../models/Notification");
const Feedback = require("../models/Feedback");

const { protect, allowRoles } = require("../middleware/auth");
const { upload } = require("../middleware/upload");

const {
  categoryDepartmentMap,
  getDepartment,
  getDueDate
} = require("../config/portal");

const router = express.Router();

const categories = Object.keys(categoryDepartmentMap);

const allowedPriorities = [
  "Low",
  "Normal",
  "High",
  "Emergency"
];

// Create private complaint tracking ID.
function createTicketId() {
  const date = new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");

  const randomCode = crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase();

  return `CMP-${date}-${randomCode}`;
}

// Check ticket ID does not already exist.
async function createUniqueTicketId() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ticketId = createTicketId();

    const exists = await Complaint.exists({ ticketId });

    if (!exists) {
      return ticketId;
    }
  }

  throw new Error("Could not generate a unique complaint ID.");
}

// Avoid unsafe search text in MongoDB regex.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Create student notification.
async function createNotification(
  recipient,
  complaint,
  message,
  type
) {
  try {
    await Notification.create({
      recipient,
      complaint,
      message,
      type
    });
  } catch (error) {
    // Complaint should still work even if notification fails.
    console.error("Notification error:", error.message);
  }
}

// Mark complaint overdue only once.
async function checkOverdue(complaint) {
  const closedStatuses = ["Resolved", "Closed", "Rejected"];

  const dueDatePassed =
    complaint.dueDate &&
    new Date(complaint.dueDate) < new Date();

  if (
    dueDatePassed &&
    !complaint.isOverdue &&
    !closedStatuses.includes(complaint.status)
  ) {
    complaint.isOverdue = true;

    complaint.history.push({
      status: complaint.status,
      note: "System alert: complaint exceeded its SLA due date."
    });

    await complaint.save();

    await createNotification(
      complaint.student,
      complaint._id,
      `Complaint ${complaint.ticketId} is overdue and has been escalated.`,
      "overdue"
    );
  }

  return complaint;
}

// Public category list for frontend dropdown.
router.get("/categories", (req, res) => {
  res.json({
    success: true,
    categories: categories.map((category) => ({
      name: category,
      department: getDepartment(category)
    }))
  });
});

// Student creates complaint.
// Form photo field must be named "photo".
router.post(
  "/",
  protect,
  allowRoles("student"),
  upload.single("photo"),
  async (req, res, next) => {
    try {
      const title = String(req.body.title || "").trim();
      const category = String(req.body.category || "").trim();
      const location = String(req.body.location || "").trim();
      const priority = String(
        req.body.priority || "Normal"
      ).trim();
      const description = String(
        req.body.description || ""
      ).trim();

      if (title.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Complaint title must contain at least 5 characters."
        });
      }

      if (!categories.includes(category)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid complaint category."
        });
      }

      if (location.length < 3) {
        return res.status(400).json({
          success: false,
          message: "Enter the exact complaint location."
        });
      }

      if (!allowedPriorities.includes(priority)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid priority."
        });
      }

      if (description.length < 10) {
        return res.status(400).json({
          success: false,
          message: "Description must contain at least 10 characters."
        });
      }

      const ticketId = await createUniqueTicketId();
      const department = getDepartment(category);
      const dueDate = getDueDate(priority);

      const complaint = await Complaint.create({
        ticketId,
        student: req.user._id,
        title,
        category,
        location,
        priority,
        description,
        department,
        dueDate,

        // Save uploaded photo path if student selected one.
        beforePhoto: req.file
          ? `/uploads/${req.file.filename}`
          : "",

        // First timeline entry.
        history: [
          {
            status: "Submitted",
            note: "Complaint submitted by student.",
            changedBy: req.user._id
          }
        ]
      });

      await createNotification(
        req.user._id,
        complaint._id,
        `Your complaint ${ticketId} was submitted and routed to ${department}.`,
        "complaint-created"
      );

      res.status(201).json({
        success: true,
        message: "Complaint submitted successfully.",
        complaint
      });
    } catch (error) {
      next(error);
    }
  }
);

// Student sees own complaints with search/filter/pagination.
router.get(
  "/my",
  protect,
  allowRoles("student"),
  async (req, res, next) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(
        Math.max(Number(req.query.limit) || 10, 1),
        25
      );

      const query = {
        student: req.user._id
      };

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

      if (req.query.q) {
        const searchText = escapeRegex(req.query.q.trim());

        query.$or = [
          { ticketId: { $regex: searchText, $options: "i" } },
          { title: { $regex: searchText, $options: "i" } },
          { location: { $regex: searchText, $options: "i" } },
          { category: { $regex: searchText, $options: "i" } }
        ];
      }

      const [complaints, total] = await Promise.all([
        Complaint.find(query)
          .populate("assignedTo", "fullName department")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),

        Complaint.countDocuments(query)
      ]);

      // Update any complaint that became overdue.
      await Promise.all(complaints.map(checkOverdue));

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

// Student dashboard statistics.
router.get(
  "/dashboard",
  protect,
  allowRoles("student"),
  async (req, res, next) => {
    try {
      const complaints = await Complaint.find({
        student: req.user._id
      }).sort({ createdAt: -1 });

      await Promise.all(complaints.map(checkOverdue));

      const summary = {
        total: complaints.length,
        submitted: complaints.filter(
          (item) => item.status === "Submitted"
        ).length,

        inProgress: complaints.filter(
          (item) =>
            item.status === "Assigned" ||
            item.status === "In Progress" ||
            item.status === "Reopened"
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

      complaints.forEach((complaint) => {
        categoryMap[complaint.category] =
          (categoryMap[complaint.category] || 0) + 1;
      });

      const byCategory = Object.entries(categoryMap).map(
        ([label, value]) => ({
          label,
          value
        })
      );

      res.json({
        success: true,
        summary,
        byCategory,
        recentComplaints: complaints.slice(0, 5)
      });
    } catch (error) {
      next(error);
    }
  }
);

// Public complaint tracker.
// It does not reveal student email, password, or USN.
router.get("/track/:ticketId", async (req, res, next) => {
  try {
    const ticketId = req.params.ticketId.toUpperCase();

    const complaint = await Complaint.findOne({ ticketId });

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint ID was not found."
      });
    }

    await checkOverdue(complaint);

    res.json({
      success: true,
      complaint: {
        ticketId: complaint.ticketId,
        title: complaint.title,
        category: complaint.category,
        location: complaint.location,
        priority: complaint.priority,
        status: complaint.status,
        department: complaint.department,
        isOverdue: complaint.isOverdue,
        dueDate: complaint.dueDate,
        beforePhoto: complaint.beforePhoto,
        afterPhoto: complaint.afterPhoto,
        resolutionNote: complaint.resolutionNote,
        createdAt: complaint.createdAt,
        resolvedAt: complaint.resolvedAt,
        history: complaint.history
      }
    });
  } catch (error) {
    next(error);
  }
});

// Logged-in student sees full details of own complaint.
router.get(
  "/:id",
  protect,
  allowRoles("student"),
  async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid complaint ID."
        });
      }

      const complaint = await Complaint.findOne({
        _id: req.params.id,
        student: req.user._id
      }).populate("assignedTo", "fullName department");

      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found."
        });
      }

      await checkOverdue(complaint);

      res.json({
        success: true,
        complaint
      });
    } catch (error) {
      next(error);
    }
  }
);

// Student feedback after complaint is resolved.
router.post(
  "/:id/feedback",
  protect,
  allowRoles("student"),
  async (req, res, next) => {
    try {
      const rating = Number(req.body.rating);
      const comment = String(req.body.comment || "").trim();
      const anonymousToDepartment =
        req.body.anonymousToDepartment === true ||
        req.body.anonymousToDepartment === "true";

      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid complaint ID."
        });
      }

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          message: "Rating must be between 1 and 5."
        });
      }

      const complaint = await Complaint.findOne({
        _id: req.params.id,
        student: req.user._id
      });

      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found."
        });
      }

      if (
        complaint.status !== "Resolved" &&
        complaint.status !== "Closed"
      ) {
        return res.status(400).json({
          success: false,
          message: "Feedback is allowed only after resolution."
        });
      }

      const feedback = await Feedback.create({
        complaint: complaint._id,
        student: req.user._id,
        rating,
        comment,
        anonymousToDepartment
      });

      complaint.history.push({
        status: complaint.status,
        note: `Student submitted ${rating}/5 feedback.`,
        changedBy: req.user._id
      });

      await complaint.save();

      res.status(201).json({
        success: true,
        message: "Thank you for your feedback.",
        feedback
      });
    } catch (error) {
      next(error);
    }
  }
);

// Student reopens a resolved complaint.
router.patch(
  "/:id/reopen",
  protect,
  allowRoles("student"),
  async (req, res, next) => {
    try {
      const reopenReason = String(
        req.body.reopenReason || ""
      ).trim();

      if (reopenReason.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Explain why you want to reopen this complaint."
        });
      }

      const complaint = await Complaint.findOne({
        _id: req.params.id,
        student: req.user._id
      });

      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found."
        });
      }

      if (
        complaint.status !== "Resolved" &&
        complaint.status !== "Closed"
      ) {
        return res.status(400).json({
          success: false,
          message: "Only resolved complaints can be reopened."
        });
      }

      complaint.status = "Reopened";
      complaint.reopenReason = reopenReason;
      complaint.reopenCount += 1;
      complaint.resolvedAt = null;
      complaint.isOverdue = false;
      complaint.dueDate = getDueDate(complaint.priority);

      complaint.history.push({
        status: "Reopened",
        note: `Student reopened complaint: ${reopenReason}`,
        changedBy: req.user._id
      });

      await complaint.save();

      await createNotification(
        req.user._id,
        complaint._id,
        `Complaint ${complaint.ticketId} was reopened successfully.`,
        "reopened"
      );

      res.json({
        success: true,
        message: "Complaint reopened successfully.",
        complaint
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;