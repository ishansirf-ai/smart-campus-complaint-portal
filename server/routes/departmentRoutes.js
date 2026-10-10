const express = require("express");
const mongoose = require("mongoose");

const Complaint = require("../models/Complaint");
const User = require("../models/User");
const { protect, authorize } = require("../middleware/auth");
const { imageUpload } = require("../middleware/upload");
const {
  createNotification
} = require("../utils/notifications");
const { publicUser } = require("../utils/publicUser");
const { writeAudit } = require("../utils/audit");

const router = express.Router();
const statuses = ["Assigned", "In Progress", "Resolved", "Closed", "Rejected"];
const workStatuses = ["Assigned", "In Progress", "Completed"];

// An administrator can use these work-management APIs as the highest role.
// A department session is always scoped to its own department below.
router.use(protect, authorize("department", "admin"));

function getDepartmentScope(user) {
  return user.role === "department"
    ? { department: user.department }
    : {};
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

function complaintQuery(req) {
  const query = getDepartmentScope(req.user);
  ["status", "category", "priority"].forEach((field) => {
    if (req.query[field]) query[field] = String(req.query[field]).trim();
  });
  if (req.query.isOverdue === "true") query.isOverdue = true;
  if (req.user.role === "admin" && req.query.department) {
    query.department = String(req.query.department).trim();
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

async function findScopedComplaint(req, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Complaint.findOne({
    _id: id,
    ...getDepartmentScope(req.user)
  });
}

async function detailQuery(req, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Complaint.findOne({
    _id: id,
    ...getDepartmentScope(req.user)
  })
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
    const scope = getDepartmentScope(req.user);
    const complaints = await Complaint.find(scope).sort({ createdAt: -1 });
    const summary = {
      total: complaints.length,
      pending: complaints.filter((item) =>
        ["Submitted", "Assigned", "Reopened"].includes(item.status)
      ).length,
      inProgress: complaints.filter((item) => item.status === "In Progress")
        .length,
      resolved: complaints.filter((item) =>
        ["Resolved", "Closed"].includes(item.status)
      ).length,
      overdue: complaints.filter((item) => item.isOverdue).length
    };

    res.json({
      success: true,
      department:
        req.user.role === "department" ? req.user.department : "All",
      summary,
      recentComplaints: complaints.slice(0, 10)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/complaints", async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const query = complaintQuery(req);
    const [complaints, total] = await Promise.all([
      Complaint.find(query)
        .populate("student", "fullName email usn department semester")
        .populate("assignedTo", "fullName department")
        .sort({ isOverdue: -1, dueDate: 1, createdAt: -1 })
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
    const complaint = await detailQuery(req, req.params.id);
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found or not allowed."
      });
    }
    res.json({ success: true, complaint });
  } catch (error) {
    next(error);
  }
});

router.get("/staff", async (req, res, next) => {
  try {
    const department =
      req.user.role === "department"
        ? req.user.department
        : String(req.query.department || "").trim();

    const query = { role: "department", isActive: true };
    if (department) query.department = department;
    const staff = await User.find(query).sort({ fullName: 1 });
    res.json({
      success: true,
      staff: staff.map(publicUser)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/complaints/:id/accept", async (req, res, next) => {
  try {
    const complaint = await findScopedComplaint(req, req.params.id);
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found or not allowed."
      });
    }

    complaint.acceptedBy = req.user._id;
    complaint.acceptedAt = new Date();
    if (["Submitted", "Reopened"].includes(complaint.status)) {
      complaint.status = "Assigned";
    }
    complaint.history.push({
      status: complaint.status,
      note: "Department accepted responsibility for this complaint.",
      changedBy: req.user._id
    });
    await complaint.save();

    await notifyStudent(
      complaint,
      "Department " + complaint.department + " accepted your complaint " +
        complaint.ticketId + ".",
      "assigned"
    );
    await writeAudit({
      req,
      action: "DEPARTMENT_COMPLAINT_ACCEPTED",
      entityType: "Complaint",
      entityId: complaint._id,
      details: { department: complaint.department }
    });

    res.json({
      success: true,
      message: "Complaint accepted successfully.",
      complaint
    });
  } catch (error) {
    next(error);
  }
});

// The target user is checked against the complaint's department in the backend.
router.post("/complaints/:id/assign-work", async (req, res, next) => {
  try {
    const complaint = await findScopedComplaint(req, req.params.id);
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found or not allowed."
      });
    }

    const assignedTo = String(req.body.assignedTo || "").trim();
    const workDescription = String(req.body.workDescription || "").trim();
    const dueDate = new Date(req.body.dueDate);

    if (!mongoose.isValidObjectId(assignedTo)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid staff member."
      });
    }
    if (workDescription.length < 3 || workDescription.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Work description must contain 3 to 1000 characters."
      });
    }
    if (Number.isNaN(dueDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Select a valid work due date."
      });
    }

    const staffMember = await User.findOne({
      _id: assignedTo,
      role: "department",
      department: complaint.department,
      isActive: true
    });
    if (!staffMember) {
      return res.status(403).json({
        success: false,
        message: "Work can only be assigned to active staff in this department."
      });
    }

    complaint.assignedTo = staffMember._id;
    complaint.workAssignments.push({
      assignedTo: staffMember._id,
      assignedBy: req.user._id,
      workDescription,
      dueDate
    });
    if (["Submitted", "Reopened"].includes(complaint.status)) {
      complaint.status = "Assigned";
    }
    complaint.history.push({
      status: complaint.status,
      note: "Work assigned to " + staffMember.fullName + ".",
      changedBy: req.user._id
    });
    await complaint.save();

    await createNotification({
      recipient: staffMember._id,
      complaint: complaint._id,
      message:
        "You were assigned work for complaint " + complaint.ticketId + ".",
      type: "work-assigned"
    });
    await notifyStudent(
      complaint,
      "Work has been assigned for your complaint " + complaint.ticketId + ".",
      "assigned"
    );
    await writeAudit({
      req,
      action: "DEPARTMENT_WORK_ASSIGNED",
      entityType: "Complaint",
      entityId: complaint._id,
      details: { assignedTo: staffMember._id, department: complaint.department }
    });

    res.json({
      success: true,
      message: "Work assigned successfully.",
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
      const complaint = await findScopedComplaint(req, req.params.id);
      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found or not allowed."
        });
      }

      const status = String(req.body.status || "").trim();
      const note = String(req.body.note || "").trim();
      if (!statuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid complaint status."
        });
      }
      if (status === "Resolved" && note.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Write resolution details before marking resolved."
        });
      }

      complaint.status = status;
      if (note) {
        complaint.departmentRemarks.push({
          remark: note,
          addedBy: req.user._id
        });
      }
      if (req.file) complaint.afterPhoto = "/uploads/" + req.file.filename;
      if (status === "Resolved") {
        complaint.resolutionNote = note;
        complaint.resolvedAt = new Date();
        complaint.isOverdue = false;
      }
      if (status === "Closed") {
        complaint.resolvedAt = complaint.resolvedAt || new Date();
      }
      if (complaint.workAssignments.length) {
        const lastAssignment =
          complaint.workAssignments[complaint.workAssignments.length - 1];
        if (status === "In Progress") lastAssignment.workStatus = "In Progress";
        if (["Resolved", "Closed"].includes(status)) {
          lastAssignment.workStatus = "Completed";
        }
      }
      complaint.history.push({
        status,
        note: note || "Department changed status to " + status + ".",
        changedBy: req.user._id
      });
      await complaint.save();

      await notifyStudent(
        complaint,
        "Complaint " + complaint.ticketId + " status is now " + status + ".",
        status === "Resolved" ? "resolved" : "status-update"
      );
      await writeAudit({
        req,
        action: "DEPARTMENT_STATUS_CHANGED",
        entityType: "Complaint",
        entityId: complaint._id,
        details: { status, department: complaint.department }
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

router.post("/complaints/:id/remarks", async (req, res, next) => {
  try {
    const complaint = await findScopedComplaint(req, req.params.id);
    const remark = String(req.body.remark || "").trim();
    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found or not allowed."
      });
    }
    if (remark.length < 3 || remark.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Remark must contain 3 to 1000 characters."
      });
    }
    complaint.departmentRemarks.push({
      remark,
      addedBy: req.user._id
    });
    complaint.history.push({
      status: complaint.status,
      note: "Department remark added: " + remark,
      changedBy: req.user._id
    });
    await complaint.save();

    await notifyStudent(
      complaint,
      "Department added a remark to complaint " + complaint.ticketId + ".",
      "remark"
    );
    await writeAudit({
      req,
      action: "DEPARTMENT_REMARK_ADDED",
      entityType: "Complaint",
      entityId: complaint._id,
      details: { department: complaint.department }
    });
    res.status(201).json({
      success: true,
      message: "Remark added successfully.",
      complaint
    });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/complaints/:id/work-assignments/:assignmentId",
  async (req, res, next) => {
    try {
      const complaint = await findScopedComplaint(req, req.params.id);
      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: "Complaint not found or not allowed."
        });
      }
      const workStatus = String(req.body.workStatus || "").trim();
      if (!workStatuses.includes(workStatus)) {
        return res.status(400).json({
          success: false,
          message: "Select a valid work status."
        });
      }
      const assignment = complaint.workAssignments.id(req.params.assignmentId);
      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: "Work assignment not found."
        });
      }
      assignment.workStatus = workStatus;
      if (workStatus === "In Progress" && complaint.status === "Assigned") {
        complaint.status = "In Progress";
      }
      if (workStatus === "Completed") {
        complaint.history.push({
          status: complaint.status,
          note: "Assigned work marked completed.",
          changedBy: req.user._id
        });
      }
      await complaint.save();
      await writeAudit({
        req,
        action: "DEPARTMENT_WORK_PROGRESS_UPDATED",
        entityType: "Complaint",
        entityId: complaint._id,
        details: { workStatus }
      });
      res.json({ success: true, complaint });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/work-assignments", async (req, res, next) => {
  try {
    const complaints = await Complaint.find(getDepartmentScope(req.user))
      .populate("assignedTo", "fullName department")
      .sort({ dueDate: 1 });
    const assignments = complaints.flatMap((complaint) =>
      complaint.workAssignments.map((assignment) => ({
        complaintId: complaint._id,
        ticketId: complaint.ticketId,
        title: complaint.title,
        department: complaint.department,
        assignment
      }))
    );
    res.json({ success: true, assignments });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
