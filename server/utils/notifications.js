const Notification = require("../models/Notification");
const User = require("../models/User");

async function createNotification({
  recipient,
  complaint = null,
  message,
  type = "system"
}) {
  try {
    return await Notification.create({
      recipient,
      complaint,
      message,
      type
    });
  } catch (error) {
    // A failed notification must never cancel a valid complaint update.
    console.error("Notification error:", error.message);
    return null;
  }
}

async function notifyDepartment({
  department,
  complaint = null,
  message,
  type = "department-assignment"
}) {
  const staff = await User.find({
    role: "department",
    department,
    isActive: true
  }).select("_id");

  await Promise.all(
    staff.map((member) =>
      createNotification({
        recipient: member._id,
        complaint,
        message,
        type
      })
    )
  );
}

async function notifyAdministrators({
  complaint = null,
  message,
  type = "system"
}) {
  const administrators = await User.find({
    role: "admin",
    isActive: true
  }).select("_id");

  await Promise.all(
    administrators.map((administrator) =>
      createNotification({
        recipient: administrator._id,
        complaint,
        message,
        type
      })
    )
  );
}

module.exports = {
  createNotification,
  notifyDepartment,
  notifyAdministrators
};
