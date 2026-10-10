const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");

const Complaint = require("../models/Complaint");
const Feedback = require("../models/Feedback");
const Category = require("../models/Category");

const { protect, studentOnly } = require("../middleware/auth");
const { complaintUpload } = require("../middleware/upload");
const { getDueDate } = require("../config/portal");
const {
  createNotification,
  notifyDepartment,
  notifyAdministrators
} = require("../utils/notifications");
const { writeAudit } = require("../utils/audit");

const router = express.Router();
const allowedPriorities = ["Low", "Normal", "High", "Emergency"];
const closedStatuses = ["Resolved", "Closed", "Rejected"];
const busCategoryName = "Bus / Transport Problem";

function createTicketId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const randomCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  return "CMP-" + date + "-" + randomCode;
}

async function createUniqueTicketId() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ticketId = createTicketId();
    if (!(await Complaint.exists({ ticketId }))) return ticketId;
  }
  throw new Error("Could not generate a unique complaint ID.");
}

function escapeRegex(text) {
  return Array.from(text)
    .map((character) =>
      "\\.^$|?*+()[]{}".includes(character)
        ? "\\" + character
        : character
    )
    .join("");
}

function attachmentFromFile(file) {
  return {
    url: "/uploads/" + file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype
  };
}

function keywordSet(value) {
  const ignored = new Set([
    "the", "and", "for", "with", "from", "that", "this", "not",
    "are", "was", "has", "have", "block", "room", "issue", "problem"
  ]);
  return new Set(
    String(value || "")
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)?.filter((word) => !ignored.has(word)) || []
  );
}

function similarityScore(left, right) {
  const leftWords = keywordSet(left);
  const rightWords = keywordSet(right);
  if (!leftWords.size || !rightWords.size) return 0;
  let shared = 0;
  leftWords.forEach((word) => {
    if (rightWords.has(word)) shared += 1;
  });
  return shared / Math.max(leftWords.size, rightWords.size);
}

async function findSimilarComplaints({ title, description, category, location }) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const candidates = await Complaint.find({
    category,
    status: { $nin: closedStatuses },
    createdAt: { $gte: since }
  })
    .select("ticketId title description location status department createdAt")
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  const searchText = `${title} ${description} ${location}`;
  return candidates
    .map((complaint) => ({
      ...complaint,
      similarity: similarityScore(
        searchText,
        `${complaint.title} ${complaint.description} ${complaint.location}`
      )
    }))
    .filter((complaint) => complaint.similarity >= 0.35)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 5);
}

async function checkOverdue(complaint) {
  const isPastDue =
    complaint.dueDate &&
    new Date(complaint.dueDate).getTime() < Date.now();

  if (
    isPastDue &&
    !complaint.isOverdue &&
    !closedStatuses.includes(complaint.status)
  ) {
    complaint.isOverdue = true;
    complaint.isEscalated = true;
    complaint.escalatedAt = new Date();
    complaint.history.push({
      status: complaint.status,
      note: "System alert: complaint exceeded its SLA due date."
    });
    await complaint.save();

    await createNotification({
      recipient: complaint.student,
      complaint: complaint._id,
      message: "Complaint " + complaint.ticketId + " is overdue and has been escalated.",
      type: "overdue"
    });
    await notifyDepartment({
      department: complaint.department,
      complaint: complaint._id,
      message: "Overdue complaint " + complaint.ticketId + " needs attention.",
      type: "overdue"
    });
    await notifyAdministrators({
      complaint: complaint._id,
      message: "Escalated complaint " + complaint.ticketId + " is overdue in " + complaint.department + ".",
      type: "escalated"
    });
  }

  return complaint;
}

async function populateStudentComplaint(query) {
  return query
    .populate("assignedTo", "fullName department email")
    .populate("acceptedBy", "fullName department")
    .populate("departmentRemarks.addedBy", "fullName department")
    .populate("workAssignments.assignedTo", "fullName department")
    .populate("workAssignments.assignedBy", "fullName department");
}

router.get("/categories", async (req, res, next) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .select("name department description");

    res.json({ success: true, categories });
  } catch (error) {
    next(error);
  }
});

// Lightweight, private duplicate detection before the student submits. It
// exposes only safe complaint details, never another student's identity.
router.get("/similar", protect, studentOnly, async (req, res, next) => {
  try {
    const title = String(req.query.title || "").trim();
    const description = String(req.query.description || "").trim();
    const category = String(req.query.category || "").trim();
    const location = String(req.query.location || "").trim();
    if (title.length < 5 || category.length < 2) {
      return res.json({ success: true, similarComplaints: [] });
    }
    const similarComplaints = await findSimilarComplaints({
      title,
      description,
      category,
      location
    });
    res.json({
      success: true,
      similarComplaints: similarComplaints.map((complaint) => ({
        id: complaint._id,
        ticketId: complaint.ticketId,
        title: complaint.title,
        location: complaint.location,
        status: complaint.status,
        department: complaint.department,
        similarity: Math.round(complaint.similarity * 100)
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Department is intentionally derived only from the category database record.
router.post(
  "/",
  protect,
  studentOnly,
  complaintUpload,
  async (req, res, next) => {
    try {
      const title = String(req.body.title || "").trim();
      const categoryName = String(req.body.category || "").trim();
      const enteredLocation = String(req.body.location || "").trim();
      const priority = String(req.body.priority || "Normal").trim();
      const description = String(req.body.description || "").trim();

      if (title.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Complaint title must contain at least 5 characters."
        });
      }
      if (description.length < 10) {
        return res.status(400).json({
          success: false,
          message: "Description must contain at least 10 characters."
        });
      }
      if (!allowedPriorities.includes(priority)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid priority."
        });
      }

      const category = await Category.findOne({
        name: categoryName,
        isActive: true
      });
      if (!category) {
        return res.status(400).json({
          success: false,
          message: "Select a valid complaint category."
        });
      }

      const isBusComplaint = category.name === busCategoryName;
      const busDetails = {
        problemType: String(req.body.busProblemType || "").trim(),
        busNumber: String(req.body.busNumber || "").trim(),
        route: String(req.body.busRoute || "").trim(),
        busStop: String(req.body.busStop || "").trim(),
        travelDate: req.body.travelDate ? new Date(req.body.travelDate) : null,
        travelTime: String(req.body.travelTime || "").trim()
      };
      if (isBusComplaint && !busDetails.problemType) {
        return res.status(400).json({
          success: false,
          message: "Select the bus or transport problem type."
        });
      }
      if (busDetails.travelDate && Number.isNaN(busDetails.travelDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid travel date."
        });
      }
      const location = enteredLocation || (isBusComplaint
        ? `Bus ${busDetails.busNumber || "not specified"} - ${busDetails.route || "route not specified"}`
        : "");
      if (location.length < 3) {
        return res.status(400).json({
          success: false,
          message: "Enter the exact complaint location."
        });
      }

      const photoFiles = req.files?.photo || [];
      const attachmentFiles = req.files?.attachments || [];
      const files = [...photoFiles, ...attachmentFiles];
      const imageFile = files.find((file) =>
        String(file.mimetype).startsWith("image/")
      );

      let similarTo = null;
      if (mongoose.isValidObjectId(req.body.similarComplaintId)) {
        const similarComplaint = await Complaint.findOne({
          _id: req.body.similarComplaintId,
          category: category.name
        }).select("_id");
        similarTo = similarComplaint?._id || null;
      }

      const complaint = await Complaint.create({
        ticketId: await createUniqueTicketId(),
        student: req.user._id,
        title,
        category: category.name,
        location,
        priority,
        description,
        department: category.department,
        locationDetails: {
          block: String(req.body.block || "").trim(),
          room: String(req.body.room || "").trim()
        },
        busDetails: isBusComplaint ? busDetails : undefined,
        dueDate: getDueDate(priority),
        beforePhoto: imageFile ? "/uploads/" + imageFile.filename : "",
        attachments: files.map(attachmentFromFile),
        similarTo,
        history: [
          {
            status: "Submitted",
            note: "Complaint submitted by student.",
            changedBy: req.user._id
          }
        ]
      });

      await createNotification({
        recipient: req.user._id,
        complaint: complaint._id,
        message:
          "Your complaint " +
          complaint.ticketId +
          " was submitted and routed to " +
          complaint.department +
          ".",
        type: "complaint-created"
      });
      await notifyDepartment({
        department: complaint.department,
        complaint: complaint._id,
        message:
          "New " +
          complaint.department +
          " complaint " +
          complaint.ticketId +
          " has been submitted.",
        type: "department-assignment"
      });
      await notifyAdministrators({
        complaint: complaint._id,
        message: "New complaint " + complaint.ticketId + " was submitted for " + complaint.department + ".",
        type: "complaint-created"
      });
      await writeAudit({
        req,
        action: "COMPLAINT_CREATED",
        entityType: "Complaint",
        entityId: complaint._id,
        details: {
          ticketId: complaint.ticketId,
          department: complaint.department
        }
      });

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

router.get("/my", protect, studentOnly, async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
    const query = { student: req.user._id };

    ["status", "category", "priority"].forEach((field) => {
      if (req.query[field]) query[field] = req.query[field];
    });
    if (req.query.isOverdue === "true") query.isOverdue = true;
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
});

router.get("/dashboard", protect, studentOnly, async (req, res, next) => {
  try {
    const complaints = await Complaint.find({
      student: req.user._id
    }).sort({ createdAt: -1 });
    await Promise.all(complaints.map(checkOverdue));

    const summary = {
      total: complaints.length,
      submitted: complaints.filter((item) => item.status === "Submitted")
        .length,
      inProgress: complaints.filter((item) =>
        ["Assigned", "In Progress", "Reopened"].includes(item.status)
      ).length,
      resolved: complaints.filter((item) =>
        ["Resolved", "Closed"].includes(item.status)
      ).length,
      overdue: complaints.filter((item) => item.isOverdue).length
    };
    const byCategory = Object.entries(
      complaints.reduce((totals, complaint) => {
        totals[complaint.category] = (totals[complaint.category] || 0) + 1;
        return totals;
      }, {})
    ).map(([label, value]) => ({ label, value }));

    res.json({
      success: true,
      summary,
      byCategory,
      recentComplaints: complaints.slice(0, 5)
    });
  } catch (error) {
    next(error);
  }
});

// Public tracking exposes safe status data only.
router.get("/track/:ticketId", async (req, res, next) => {
  try {
    const ticketId = String(req.params.ticketId || "").toUpperCase();
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

router.get("/:id", protect, studentOnly, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid complaint ID."
      });
    }

    const complaint = await populateStudentComplaint(
      Complaint.findOne({
        _id: req.params.id,
        student: req.user._id
      })
    );
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found."
      });
    }

    await checkOverdue(complaint);
    res.json({ success: true, complaint });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/feedback", protect, studentOnly, async (req, res, next) => {
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
    if (!["Resolved", "Closed"].includes(complaint.status)) {
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
      note: "Student submitted " + rating + "/5 feedback.",
      changedBy: req.user._id
    });
    await complaint.save();

    await writeAudit({
      req,
      action: "FEEDBACK_SUBMITTED",
      entityType: "Complaint",
      entityId: complaint._id,
      details: { rating }
    });

    res.status(201).json({
      success: true,
      message: "Thank you for your feedback.",
      feedback
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/reopen", protect, studentOnly, async (req, res, next) => {
  try {
    const reopenReason = String(req.body.reopenReason || "").trim();
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
    if (!["Resolved", "Closed"].includes(complaint.status)) {
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
    complaint.isEscalated = false;
    complaint.escalatedAt = null;
    complaint.dueDate = getDueDate(complaint.priority);
    complaint.history.push({
      status: "Reopened",
      note: "Student reopened complaint: " + reopenReason,
      changedBy: req.user._id
    });
    await complaint.save();

    await createNotification({
      recipient: req.user._id,
      complaint: complaint._id,
      message: "Complaint " + complaint.ticketId + " was reopened successfully.",
      type: "reopened"
    });
    await notifyDepartment({
      department: complaint.department,
      complaint: complaint._id,
      message: "Complaint " + complaint.ticketId + " was reopened by the student.",
      type: "reopened"
    });
    await writeAudit({
      req,
      action: "COMPLAINT_REOPENED",
      entityType: "Complaint",
      entityId: complaint._id
    });

    res.json({
      success: true,
      message: "Complaint reopened successfully.",
      complaint
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
