const express = require("express");
const mongoose = require("mongoose");

const Notification = require("../models/Notification");
const { protect } = require("../middleware/auth");

const router = express.Router();

// All notification routes require login.
router.use(protect);

// Get logged-in user's notifications.
router.get("/", async (req, res, next) => {
  try {
    const notifications = await Notification.find({
      recipient: req.user._id
    })
      .populate("complaint", "ticketId title status")
      .sort({ createdAt: -1 })
      .limit(30);

    const unreadCount = notifications.filter(
      (notification) => !notification.isRead
    ).length;

    res.json({
      success: true,
      unreadCount,
      notifications
    });
  } catch (error) {
    next(error);
  }
});

// Mark every notification as read.
router.patch("/read-all", async (req, res, next) => {
  try {
    await Notification.updateMany(
      {
        recipient: req.user._id,
        isRead: false
      },
      {
        isRead: true
      }
    );

    res.json({
      success: true,
      message: "All notifications marked as read."
    });
  } catch (error) {
    next(error);
  }
});

// Mark one notification as read.
router.patch("/:id/read", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID."
      });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        recipient: req.user._id
      },
      {
        isRead: true
      },
      {
        new: true
      }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found."
      });
    }

    res.json({
      success: true,
      notification
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;