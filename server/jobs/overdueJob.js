const cron = require("node-cron");

const Complaint = require("../models/Complaint");
const {
  createNotification,
  notifyDepartment,
  notifyAdministrators
} = require("../utils/notifications");

async function markOverdueComplaints() {
  const overdueComplaints = await Complaint.find({
    dueDate: { $lt: new Date() },
    isOverdue: false,
    status: {
      $in: [
        "Submitted",
        "Assigned",
        "In Progress",
        "Reopened"
      ]
    }
  });

  for (const complaint of overdueComplaints) {
    complaint.isOverdue = true;
    complaint.isEscalated = true;
    complaint.escalatedAt = new Date();

    complaint.history.push({
      status: complaint.status,
      note: "System escalation: complaint exceeded due date."
    });

    await complaint.save();

    await createNotification({
      recipient: complaint.student,
      complaint: complaint._id,
      message: `Complaint ${complaint.ticketId} is overdue and escalated.`,
      type: "escalated"
    });
    await notifyDepartment({
      department: complaint.department,
      complaint: complaint._id,
      message: `Complaint ${complaint.ticketId} is overdue and needs urgent action.`,
      type: "escalated"
    });
    await notifyAdministrators({
      complaint: complaint._id,
      message: `Escalated complaint ${complaint.ticketId} is overdue in ${complaint.department}.`,
      type: "escalated"
    });
  }

  console.log(
    `Overdue check complete. Flagged: ${overdueComplaints.length}`
  );
}

function startOverdueJob() {
  // Run every hour at minute 0.
  cron.schedule("0 * * * *", () => {
    markOverdueComplaints().catch((error) => {
      console.error("Overdue job error:", error.message);
    });
  });

  // Also run once when server starts.
  markOverdueComplaints().catch((error) => {
    console.error("Initial overdue check error:", error.message);
  });
}

module.exports = {
  startOverdueJob
};
