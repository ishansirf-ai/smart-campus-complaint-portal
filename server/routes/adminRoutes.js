const express = require("express");
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

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
  isAdminOnlyCategory,
  getDueDate
} = require("../config/portal");
const { publicUser } = require("../utils/publicUser");
const {
  createNotification,
  notifyDepartment
} = require("../utils/notifications");
const { writeAudit } = require("../utils/audit");
const { sendStoredUpload } = require("../utils/secureUploads");

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
const finalStatuses = ["Resolved", "Closed", "Rejected"];

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

function addCondition(query, condition) {
  query.$and = query.$and || [];
  query.$and.push(condition);
}

function kolkataDayWindow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  const start = new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00+05:30`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

// Dashboard months use India Standard Time so the report agrees with dates
// displayed to BGMIT staff, while MongoDB continues to store UTC timestamps.
function kolkataMonthKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date(date));
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}`;
}

function recentKolkataMonths(count = 6) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  const year = Number(value("year"));
  const monthIndex = Number(value("month")) - 1;
  const labelFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    year: "numeric"
  });

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex - index, 1));
    return {
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
      label: labelFormatter.format(date)
    };
  }).reverse();
}

function buildComplaintQuery(req) {
  const query = {};
  ["department", "status", "category", "priority"].forEach((field) => {
    if (req.query[field]) query[field] = String(req.query[field]).trim();
  });
  if (req.query.isOverdue === "true") query.isOverdue = true;

  // Dates are submitted by the dashboard as calendar dates in Asia/Kolkata.
  // The end date is exclusive so a full selected end day is included.
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const start = new Date(`${from}T00:00:00+05:30`);
    if (!Number.isNaN(start.getTime())) {
      addCondition(query, { createdAt: { $gte: start } });
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const end = new Date(`${to}T00:00:00+05:30`);
    if (!Number.isNaN(end.getTime())) {
      end.setUTCDate(end.getUTCDate() + 1);
      addCondition(query, { createdAt: { $lt: end } });
    }
  }
  const dueFilter = String(req.query.due || "").trim();
  if (dueFilter) {
    const now = new Date();
    const { start, end } = kolkataDayWindow();
    if (dueFilter === "overdue") {
      addCondition(query, {
        dueDate: { $lt: now },
        status: { $nin: finalStatuses }
      });
    }
    if (dueFilter === "today") {
      addCondition(query, {
        dueDate: { $gte: start, $lt: end },
        status: { $nin: finalStatuses }
      });
    }
    if (dueFilter === "upcoming") {
      const upcomingEnd = new Date(end);
      upcomingEnd.setUTCDate(upcomingEnd.getUTCDate() + 7);
      addCondition(query, {
        dueDate: { $gte: end, $lt: upcomingEnd },
        status: { $nin: finalStatuses }
      });
    }
    if (dueFilter === "resolved") {
      addCondition(query, { status: { $in: ["Resolved", "Closed"] } });
    }
  }
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

function trendKey(date, granularity) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(date));
  const value = (type) => parts.find((part) => part.type === type).value;
  const dayKey = `${value("year")}-${value("month")}-${value("day")}`;
  if (granularity === "day") return dayKey;
  if (granularity === "month") return dayKey.slice(0, 7);

  // Monday-start week key. This is deterministic and time-zone aware because
  // it begins with the calendar date already converted to Asia/Kolkata.
  const calendarDate = new Date(`${dayKey}T00:00:00Z`);
  const mondayOffset = (calendarDate.getUTCDay() + 6) % 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - mondayOffset);
  return calendarDate.toISOString().slice(0, 10);
}

function trendLabel(key, granularity) {
  if (granularity === "month") {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      month: "short",
      year: "numeric"
    }).format(new Date(`${key}-01T12:00:00+05:30`));
  }
  const date = new Date(`${key}T12:00:00+05:30`);
  const label = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
  return granularity === "week" ? `Week of ${label}` : label;
}

function buildTrend(complaints, requestedGranularity) {
  const granularity = ["day", "week", "month"].includes(requestedGranularity)
    ? requestedGranularity
    : "month";
  const buckets = new Map();

  complaints.forEach((complaint) => {
    const submittedKey = trendKey(
      complaint.submittedAt || complaint.createdAt,
      granularity
    );
    const submitted = buckets.get(submittedKey) || {
      key: submittedKey,
      submitted: 0,
      resolved: 0
    };
    submitted.submitted += 1;
    buckets.set(submittedKey, submitted);

    if (complaint.resolvedAt) {
      const resolvedKey = trendKey(complaint.resolvedAt, granularity);
      const resolved = buckets.get(resolvedKey) || {
        key: resolvedKey,
        submitted: 0,
        resolved: 0
      };
      resolved.resolved += 1;
      buckets.set(resolvedKey, resolved);
    }
  });

  return [...buckets.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .slice(-24)
    .map((bucket) => ({
      label: trendLabel(bucket.key, granularity),
      submitted: bucket.submitted,
      resolved: bucket.resolved
    }));
}

function kolkataCalendarParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type).value;
  return { year: Number(value("year")), month: Number(value("month")) };
}

function addReportDateWindow(query, start, end) {
  addCondition(query, { createdAt: { $gte: start, $lt: end } });
}

function officialReportTitle(type, department) {
  const baseTitles = {
    individual: "Individual Complaint Report",
    history: "Complete Complaint History Report",
    department: "Department-wise Complaint Report",
    monthly: "Monthly Complaint Report",
    yearly: "Yearly Complaint Report",
    overdue: "Overdue Complaint Report",
    resolution: "Complaint Resolution Report",
    analytics: "Administrative Analytics Report"
  };
  const title = baseTitles[type];
  return department && type === "department" ? `${department} — ${title}` : title;
}

function buildOfficialReportQuery(req, type) {
  const query = buildComplaintQuery(req);
  const { year, month } = kolkataCalendarParts();
  const hasDateRange = Boolean(req.query.from || req.query.to);

  if (type === "monthly" && !hasDateRange) {
    const start = new Date(
      `${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`
    );
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    addReportDateWindow(query, start, end);
  }

  if (type === "yearly" && !hasDateRange) {
    const start = new Date(`${year}-01-01T00:00:00+05:30`);
    const end = new Date(`${year + 1}-01-01T00:00:00+05:30`);
    addReportDateWindow(query, start, end);
  }

  if (type === "overdue") {
    addCondition(query, {
      dueDate: { $lt: new Date() },
      status: { $nin: finalStatuses }
    });
  }

  if (type === "resolution") {
    addCondition(query, { status: { $in: ["Resolved", "Closed"] } });
  }

  return query;
}

function summarizeOfficialReport(complaints) {
  const now = new Date();
  const isOverdue = (complaint) =>
    complaint.dueDate &&
    new Date(complaint.dueDate) < now &&
    !finalStatuses.includes(complaint.status);
  const resolved = complaints.filter((complaint) =>
    ["Resolved", "Closed"].includes(complaint.status)
  );
  const departmentStats = [...DEPARTMENT_CODES, "ADMIN"].map((department) => {
    const items = complaints.filter((complaint) => complaint.department === department);
    return {
      department: department === "ADMIN" ? "Administration" : department,
      total: items.length,
      open: items.filter((item) => !finalStatuses.includes(item.status)).length,
      resolved: items.filter((item) => ["Resolved", "Closed"].includes(item.status)).length,
      overdue: items.filter(isOverdue).length
    };
  });

  return {
    total: complaints.length,
    open: complaints.filter((item) => !finalStatuses.includes(item.status)).length,
    submitted: complaints.filter((item) => item.status === "Submitted").length,
    assigned: complaints.filter((item) => item.status === "Assigned").length,
    inProgress: complaints.filter((item) => item.status === "In Progress").length,
    resolved: resolved.length,
    overdue: complaints.filter(isOverdue).length,
    escalated: complaints.filter((item) => item.isEscalated).length,
    averageResolutionHours: resolved.length
      ? Math.round(
          resolved.reduce((sum, item) =>
            sum + (new Date(item.resolvedAt || item.updatedAt) - new Date(item.createdAt)) /
              (1000 * 60 * 60), 0
          ) / resolved.length
        )
      : 0,
    departmentStats
  };
}

async function getComplaintDetails(id) {
  return Complaint.findById(id)
    .populate("student", "fullName email usn department semester phone")
    .populate("assignedTo", "fullName email department phone")
    .populate("acceptedBy", "fullName department")
    .populate("departmentRemarks.addedBy", "fullName department")
    .populate("workAssignments.assignedTo", "fullName department")
    .populate("workAssignments.assignedBy", "fullName department")
    .populate("history.changedBy", "fullName role department");
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
      // The dashboard performs only aggregate calculations. Select just the
      // fields it needs so large attachment and history arrays are not loaded
      // for every administrator page visit.
      Complaint.find(buildComplaintQuery(req))
        .select("category department dueDate status isEscalated resolvedAt createdAt submittedAt updatedAt")
        .lean(),
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

    const now = new Date();
    const { start, end } = kolkataDayWindow();
    const currentOverdue = (item) =>
      item.dueDate &&
      new Date(item.dueDate) < now &&
      !finalStatuses.includes(item.status);
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
      overdue: complaints.filter(currentOverdue).length,
      escalated: complaints.filter((item) => item.isEscalated).length,
      dueToday: complaints.filter((item) =>
        item.dueDate &&
        new Date(item.dueDate) >= start &&
        new Date(item.dueDate) < end &&
        !finalStatuses.includes(item.status)
      ).length,
      upcoming: complaints.filter((item) =>
        item.dueDate &&
        new Date(item.dueDate) >= end &&
        !finalStatuses.includes(item.status)
      ).length,
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

    // Date range, department and trend granularity all operate on the same
    // filtered real complaint set, preventing inconsistent dashboard figures.
    const monthlyTrend = buildTrend(complaints, req.query.trend);

    const resolved = complaints.filter((item) => item.resolvedAt);
    const onTimeResolved = resolved.filter((item) =>
      item.dueDate && new Date(item.resolvedAt) <= new Date(item.dueDate)
    ).length;
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
    const departmentPerformance = DEPARTMENT_CODES.map((department) => {
      const departmentComplaints = complaints.filter(
        (complaint) => complaint.department === department
      );
      const resolvedComplaints = departmentComplaints.filter((complaint) =>
        ["Resolved", "Closed"].includes(complaint.status)
      );
      const averageHours = resolvedComplaints.length
        ? Math.round(
            resolvedComplaints.reduce((total, complaint) => {
              const finishedAt = complaint.resolvedAt || complaint.updatedAt;
              return total +
                (new Date(finishedAt) - new Date(complaint.createdAt)) /
                  (1000 * 60 * 60);
            }, 0) / resolvedComplaints.length
          )
        : 0;

      return {
        department,
        total: departmentComplaints.length,
        open: departmentComplaints.filter(
          (complaint) => !finalStatuses.includes(complaint.status)
        ).length,
        resolved: resolvedComplaints.length,
        overdue: departmentComplaints.filter(currentOverdue).length,
        averageResolutionHours: averageHours
      };
    });

    res.json({
      success: true,
      summary,
      byCategory,
      byDepartment,
      monthlyTrend,
      departmentPerformance,
      averageResolutionHours,
      onTimeResolved,
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

router.get("/complaints/:id/attachments/:index", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint ID." });
    }
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ success: false, message: "Invalid attachment." });
    }
    const complaint = await Complaint.findById(req.params.id);
    const attachment = complaint?.attachments?.[index];
    if (!attachment) {
      return res.status(404).json({ success: false, message: "Attachment not found." });
    }
    return sendStoredUpload(res, {
      uploadUrl: attachment.url,
      mimeType: attachment.mimeType,
      downloadName: attachment.originalName
    });
  } catch (error) {
    next(error);
  }
});

router.get("/complaints/:id/media/:kind", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !["before", "after"].includes(req.params.kind)) {
      return res.status(400).json({ success: false, message: "Invalid media request." });
    }
    const complaint = await Complaint.findById(req.params.id);
    const uploadUrl = req.params.kind === "before" ? complaint?.beforePhoto : complaint?.afterPhoto;
    if (!uploadUrl) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }
    return sendStoredUpload(res, {
      uploadUrl,
      downloadName: `${complaint.ticketId}-${req.params.kind}-photo`
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

    if (complaint.isAdminOnly || isAdminOnlyCategory(complaint.category)) {
      return res.status(403).json({
        success: false,
        message:
          "This administrator-only complaint cannot be assigned to an ordinary department."
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
      if (!complaint.isAdminOnly && !isAdminOnlyCategory(complaint.category)) {
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
      }
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
    complaint.isOverdue =
      complaint.dueDate < new Date() && !finalStatuses.includes(complaint.status);
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
    const requestedAdminOnly =
      req.body.isAdminOnly === true || req.body.isAdminOnly === "true";
    const department = requestedAdminOnly
      ? "ADMIN"
      : String(req.body.department || "").trim();
    if (name.length < 2 || name.length > 100 || !isValidRoutingTarget(department)) {
      return res.status(400).json({
        success: false,
        message: "Enter a category name and a valid department."
      });
    }
    const category = await Category.create({
      name,
      department,
      description: String(req.body.description || "").trim(),
      isAdminOnly: requestedAdminOnly
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
    if (Object.prototype.hasOwnProperty.call(req.body, "isAdminOnly")) {
      changes.isAdminOnly =
        req.body.isAdminOnly === true || req.body.isAdminOnly === "true";
      if (changes.isAdminOnly) changes.department = "ADMIN";
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "isStudentVisible")) {
      changes.isStudentVisible =
        req.body.isStudentVisible === true || req.body.isStudentVisible === "true";
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
      key: {
        $in: [
          "portalName",
          "supportEmail",
          "maintenanceMessage",
          "monthlyComplaintLimit",
          "defaultComplaintPriority"
        ]
      }
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
    const allowed = [
      "portalName",
      "supportEmail",
      "maintenanceMessage",
      "monthlyComplaintLimit",
      "defaultComplaintPriority"
    ];
    const updates = allowed.filter((key) =>
      Object.prototype.hasOwnProperty.call(req.body, key)
    );
    if (!updates.length) {
      return res.status(400).json({
        success: false,
        message: "No supported setting was supplied."
      });
    }
    if (updates.includes("monthlyComplaintLimit")) {
      const monthlyComplaintLimit = Number(req.body.monthlyComplaintLimit);
      if (
        !Number.isInteger(monthlyComplaintLimit) ||
        monthlyComplaintLimit < 1 ||
        monthlyComplaintLimit > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "Monthly complaint limit must be a whole number from 1 to 100."
        });
      }
    }
    if (
      updates.includes("defaultComplaintPriority") &&
      !priorities.includes(String(req.body.defaultComplaintPriority))
    ) {
      return res.status(400).json({
        success: false,
        message: "Select a valid default complaint priority."
      });
    }

    await Promise.all(
      updates.map((key) =>
        SystemSetting.updateOne(
          { key },
          {
            $set: {
              value:
                key === "monthlyComplaintLimit"
                  ? Number(req.body[key])
                  : String(req.body[key] || "").trim(),
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

// Downloadable official workbook. This route appears before the non-suffixed
// report route so Express does not treat "analytics.xlsx" as a report type.
router.get("/official-reports/:type.xlsx", async (req, res, next) => {
  try {
    const type = String(req.params.type || "").trim().toLowerCase();
    const supportedTypes = [
      "individual",
      "history",
      "department",
      "monthly",
      "yearly",
      "overdue",
      "resolution",
      "analytics"
    ];
    if (!supportedTypes.includes(type)) {
      return res.status(400).json({ success: false, message: "Select a valid official report type." });
    }
    if (type === "department" && !isValidRoutingTarget(req.query.department)) {
      return res.status(400).json({ success: false, message: "Select a valid department for this report." });
    }

    let complaints;
    if (type === "individual") {
      const ticketId = String(req.query.ticketId || "").trim().toUpperCase();
      if (!ticketId) {
        return res.status(400).json({ success: false, message: "Enter a complaint ticket ID for the individual report." });
      }
      const record = await Complaint.findOne({ ticketId }).select("_id");
      if (!record) {
        return res.status(404).json({ success: false, message: "Complaint ticket was not found." });
      }
      const complaint = await getComplaintDetails(record._id);
      complaints = [complaint.toObject()];
    } else {
      complaints = await Complaint.find(buildOfficialReportQuery(req, type))
        .populate("student", "fullName email usn department semester")
        .populate("assignedTo", "fullName department")
        .sort({ createdAt: -1 })
        .limit(5000)
        .lean();
    }

    const summary = summarizeOfficialReport(complaints);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "BGMIT Smart College Complaint Portal";
    workbook.created = new Date();
    workbook.properties.title = officialReportTitle(type, req.query.department);

    const sheet = workbook.addWorksheet("Official Report", {
      views: [{ state: "frozen", ySplit: 10 }],
      pageSetup: {
        paperSize: 9,
        orientation: type === "individual" ? "portrait" : "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.6, header: 0.15, footer: 0.25 }
      },
      headerFooter: { oddFooter: "&CBGMIT Official Report — Page &P of &N" }
    });
    sheet.columns = [
      { width: 20 }, { width: 30 }, { width: 22 }, { width: 18 },
      { width: 13 }, { width: 16 }, { width: 22 }, { width: 24 }
    ];
    const logoPath = path.join(__dirname, "../../assets/images/logo.png");
    if (fs.existsSync(logoPath)) {
      const logo = workbook.addImage({ filename: logoPath, extension: "png" });
      sheet.addImage(logo, { tl: { col: 0, row: 0 }, ext: { width: 52, height: 52 } });
    }
    sheet.mergeCells("B1:H1");
    sheet.getCell("B1").value = "BASAVESHWAR GURUKULAM INSTITUTE OF TECHNOLOGY (BGMIT), MUDHOL";
    sheet.getCell("B1").font = { bold: true, size: 16, color: { argb: "FF083A68" } };
    sheet.getCell("B1").alignment = { horizontal: "center", vertical: "middle" };
    sheet.mergeCells("B2:H2");
    sheet.getCell("B2").value = "SMART COLLEGE COMPLAINT PORTAL · OFFICIAL ADMINISTRATIVE DOCUMENT";
    sheet.getCell("B2").font = { bold: true, size: 10, color: { argb: "FF40586D" } };
    sheet.getCell("B2").alignment = { horizontal: "center" };
    sheet.mergeCells("A4:H4");
    sheet.getCell("A4").value = officialReportTitle(type, req.query.department).toUpperCase();
    sheet.getCell("A4").font = { bold: true, size: 13, color: { argb: "FF111111" } };
    sheet.getCell("A4").alignment = { horizontal: "center" };
    sheet.mergeCells("A5:D5");
    sheet.getCell("A5").value = `Department: ${req.query.department === "ADMIN" ? "Administration" : req.query.department || "All"}`;
    sheet.mergeCells("E5:H5");
    sheet.getCell("E5").value = `Generated (IST): ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })}`;
    sheet.mergeCells("A6:H6");
    sheet.getCell("A6").value = `Report period: ${req.query.from || "All available dates"} to ${req.query.to || "All available dates"}`;

    const metricRows = [
      ["Total complaints", summary.total, "Resolved", summary.resolved],
      ["Open complaints", summary.open ?? (summary.total - summary.resolved), "Overdue", summary.overdue],
      ["Escalated", summary.escalated, "Average resolution", `${summary.averageResolutionHours || 0} hours`]
    ];
    metricRows.forEach((values, index) => {
      const row = 8 + index;
      sheet.getCell(`A${row}`).value = values[0];
      sheet.getCell(`B${row}`).value = values[1];
      sheet.getCell(`D${row}`).value = values[2];
      sheet.getCell(`E${row}`).value = values[3];
      ["A", "D"].forEach((column) => {
        sheet.getCell(`${column}${row}`).font = { bold: true, color: { argb: "FF083A68" } };
      });
    });

    const headerRow = 12;
    const header = ["Ticket ID", "Complaint details", "Student", "Department", "Priority", "Status", "Submitted (IST)", "Due / Resolved (IST)"];
    sheet.getRow(headerRow).values = header;
    sheet.getRow(headerRow).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF083A68" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    const dateText = (value) => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "";
    complaints.forEach((complaint) => {
      const row = sheet.addRow([
        complaint.ticketId,
        `${complaint.title}\n${complaint.category} · ${complaint.location}`,
        `${complaint.student?.fullName || ""}\n${complaint.student?.usn || ""}`,
        complaint.isAdminOnly ? "Administration" : complaint.department,
        complaint.priority,
        complaint.status,
        dateText(complaint.submittedAt || complaint.createdAt),
        `Due: ${dateText(complaint.dueDate)}\nResolved: ${dateText(complaint.resolvedAt)}`
      ]);
      row.alignment = { vertical: "top", wrapText: true };
      row.height = 34;
    });
    sheet.autoFilter = { from: `A${headerRow}`, to: `H${headerRow}` };
    sheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
    sheet.eachRow((row, number) => {
      if (number > headerRow && number % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F9FD" } };
        });
      }
    });

    const signatureRow = sheet.rowCount + 4;
    sheet.mergeCells(`A${signatureRow}:H${signatureRow}`);
    sheet.getCell(`A${signatureRow}`).value = "PRINCIPAL";
    sheet.getCell(`A${signatureRow}`).font = { bold: true, size: 12 };
    sheet.mergeCells(`A${signatureRow + 1}:H${signatureRow + 1}`);
    sheet.getCell(`A${signatureRow + 1}`).value = "Basaveshwar Gurukulam Institute of Technology (BGMIT), Mudhol";
    sheet.mergeCells(`A${signatureRow + 4}:D${signatureRow + 4}`);
    sheet.getCell(`A${signatureRow + 4}`).value = "Signature: __________________________________";
    sheet.mergeCells(`E${signatureRow + 4}:H${signatureRow + 4}`);
    sheet.getCell(`E${signatureRow + 4}`).value = "Date: __________________________________";
    sheet.mergeCells(`A${signatureRow + 6}:D${signatureRow + 6}`);
    sheet.getCell(`A${signatureRow + 6}`).value = "Official Seal: ______________________________";

    if (["individual", "history"].includes(type)) {
      const historySheet = workbook.addWorksheet("Activity History", {
        views: [{ state: "frozen", ySplit: 1 }],
        pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
        headerFooter: { oddFooter: "&CBGMIT Official Report — Page &P of &N" }
      });
      historySheet.columns = [{ width: 22 }, { width: 24 }, { width: 18 }, { width: 58 }, { width: 26 }];
      historySheet.addRow(["Ticket ID", "Date and time (IST)", "Status", "Recorded action", "Updated by"]);
      historySheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF083A68" } };
      });
      complaints.flatMap((complaint) => (complaint.history || []).map((item) => ({ complaint, item })))
        .sort((left, right) => new Date(left.item.changedAt) - new Date(right.item.changedAt))
        .forEach(({ complaint, item }) => {
          const row = historySheet.addRow([
            complaint.ticketId,
            dateText(item.changedAt),
            item.status,
            item.note || "Status updated.",
            item.changedBy?.fullName || "Portal system"
          ]);
          row.alignment = { vertical: "top", wrapText: true };
        });
      historySheet.pageSetup.printTitlesRow = "1:1";
    }

    await writeAudit({
      req,
      action: "ADMIN_OFFICIAL_EXCEL_DOWNLOADED",
      entityType: "OfficialReport",
      details: { type, complaintCount: complaints.length }
    });
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="bgmit-official-${type}-report.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

// Official print data is deliberately served from the Admin router. The
// protect + adminOnly middleware above applies before this endpoint, so a
// Student or Department JWT receives 403 even if it calls the URL directly.
router.get("/official-reports/:type", async (req, res, next) => {
  try {
    const type = String(req.params.type || "").trim().toLowerCase();
    const supportedTypes = [
      "individual",
      "history",
      "department",
      "monthly",
      "yearly",
      "overdue",
      "resolution",
      "analytics"
    ];
    if (!supportedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid official report type."
      });
    }
    if (type === "department" && !isValidRoutingTarget(req.query.department)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid department for this report."
      });
    }

    let complaints;
    if (type === "individual") {
      const ticketId = String(req.query.ticketId || "").trim().toUpperCase();
      if (!ticketId) {
        return res.status(400).json({
          success: false,
          message: "Enter a complaint ticket ID for the individual report."
        });
      }
      const record = await Complaint.findOne({ ticketId }).select("_id");
      if (!record) {
        return res.status(404).json({
          success: false,
          message: "Complaint ticket was not found."
        });
      }
      const complaint = await getComplaintDetails(record._id);
      complaints = [complaint.toObject()];
    } else {
      const query = buildOfficialReportQuery(req, type);
      complaints = await Complaint.find(query)
        .populate("student", "fullName email usn department semester")
        .populate("assignedTo", "fullName department")
        .sort({ createdAt: -1 })
        .limit(5000)
        .lean();
    }

    const summary = summarizeOfficialReport(complaints);
    const complaintIds = complaints.map((complaint) => complaint._id);
    const feedbackSummary = complaintIds.length
      ? await Feedback.aggregate([
          { $match: { complaint: { $in: complaintIds } } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              averageRating: { $avg: "$rating" }
            }
          }
        ])
      : [];
    const feedback = feedbackSummary[0] || { count: 0, averageRating: 0 };

    await writeAudit({
      req,
      action: "ADMIN_OFFICIAL_REPORT_PREPARED",
      entityType: "OfficialReport",
      details: { type, complaintCount: complaints.length }
    });

    res.json({
      success: true,
      report: {
        type,
        title: officialReportTitle(type, req.query.department),
        generatedAt: new Date(),
        filters: {
          department: String(req.query.department || "").trim(),
          from: String(req.query.from || "").trim(),
          to: String(req.query.to || "").trim()
        },
        summary: {
          ...summary,
          feedbackCount: feedback.count,
          averageFeedbackRating: Number(
            Number(feedback.averageRating || 0).toFixed(1)
          )
        },
        complaints
      }
    });
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
        "Submitted Date and Time",
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
          csvValue((complaint.submittedAt || complaint.createdAt)?.toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })),
          csvValue(complaint.dueDate?.toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })),
          csvValue(complaint.resolvedAt?.toLocaleString("en-GB", { timeZone: "Asia/Kolkata" }))
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

// A true Excel workbook for college reviews and administration. It deliberately
// uses the same server-side query as the dashboard, so exports respect the
// selected department and date range rather than relying on browser data.
router.get("/export.xlsx", async (req, res, next) => {
  try {
    const complaints = await Complaint.find(buildComplaintQuery(req))
      .populate("student", "fullName email usn")
      .populate("assignedTo", "fullName department")
      .sort({ createdAt: -1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "BGMIT Smart College Complaint Portal";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Complaints", {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    sheet.columns = [
      { header: "Ticket ID", key: "ticketId", width: 22 },
      { header: "Title", key: "title", width: 34 },
      { header: "Category", key: "category", width: 22 },
      { header: "Location", key: "location", width: 26 },
      { header: "Priority", key: "priority", width: 13 },
      { header: "Status", key: "status", width: 16 },
      { header: "Overdue", key: "overdue", width: 11 },
      { header: "Escalated", key: "escalated", width: 12 },
      { header: "Department", key: "department", width: 18 },
      { header: "Assigned Staff", key: "assignedTo", width: 24 },
      { header: "Student", key: "student", width: 24 },
      { header: "Submitted (IST)", key: "submittedAt", width: 23 },
      { header: "Due Date (IST)", key: "dueDate", width: 23 },
      { header: "Resolved (IST)", key: "resolvedAt", width: 23 }
    ];
    const dateText = (value) =>
      value
        ? new Date(value).toLocaleString("en-GB", {
            timeZone: "Asia/Kolkata",
            dateStyle: "medium",
            timeStyle: "short"
          })
        : "";

    complaints.forEach((complaint) => {
      sheet.addRow({
        ticketId: complaint.ticketId,
        title: complaint.title,
        category: complaint.category,
        location: complaint.location,
        priority: complaint.priority,
        status: complaint.status,
        overdue: complaint.isOverdue ? "Yes" : "No",
        escalated: complaint.isEscalated ? "Yes" : "No",
        department: complaint.isAdminOnly ? "Administration" : complaint.department,
        assignedTo: complaint.assignedTo?.fullName || "",
        student: complaint.student?.fullName || "",
        submittedAt: dateText(complaint.submittedAt || complaint.createdAt),
        dueDate: dateText(complaint.dueDate),
        resolvedAt: dateText(complaint.resolvedAt)
      });
    });

    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF08447E" } };
      cell.alignment = { vertical: "middle" };
    });
    sheet.autoFilter = { from: "A1", to: "N1" };
    sheet.eachRow((row, index) => {
      if (index > 1 && index % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F9FD" } };
        });
      }
      row.alignment = { vertical: "top", wrapText: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bgmit-complaint-report.xlsx"'
    );
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
