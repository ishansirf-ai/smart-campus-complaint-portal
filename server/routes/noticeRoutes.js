const express = require("express");
const mongoose = require("mongoose");

const CampusNotice = require("../models/CampusNotice");
const { protect, adminOnly } = require("../middleware/auth");
const { writeAudit } = require("../utils/audit");

const router = express.Router();
const audiences = ["all", "student", "department", "admin"];

function parseOptionalDate(value, fieldName) {
  if (value === undefined) return { supplied: false };
  if (value === null || value === "") {
    return { supplied: true, value: null };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: fieldName + " must be a valid date." };
  }

  return { supplied: true, value: date };
}

function parseBoolean(value, fieldName) {
  if (value === true || value === "true") return { value: true };
  if (value === false || value === "false") return { value: false };
  return { error: fieldName + " must be true or false." };
}

function getNoticeValues(body, { partial = false } = {}) {
  const values = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (!partial || has("title")) {
    const title = String(body.title || "").trim();
    if (title.length < 3 || title.length > 160) {
      return { error: "Notice title must contain 3 to 160 characters." };
    }
    values.title = title;
  }

  if (!partial || has("message")) {
    const message = String(body.message || "").trim();
    if (message.length < 3 || message.length > 3000) {
      return { error: "Notice message must contain 3 to 3000 characters." };
    }
    values.message = message;
  }

  if (!partial || has("audience")) {
    const audience = String(body.audience || "all").trim().toLowerCase();
    if (!audiences.includes(audience)) {
      return { error: "Select a valid notice audience." };
    }
    values.audience = audience;
  }

  ["isActive", "isPinned"].forEach((field) => {
    if (!partial || has(field)) {
      if (!has(field)) {
        values[field] = field === "isActive";
        return;
      }
      const parsed = parseBoolean(body[field], field);
      if (parsed.error) {
        values.validationError = parsed.error;
        return;
      }
      values[field] = parsed.value;
    }
  });
  if (values.validationError) {
    return { error: values.validationError };
  }

  const expiresAt = parseOptionalDate(body.expiresAt, "Expiry date");
  if (expiresAt.error) return expiresAt;
  if (expiresAt.supplied) values.expiresAt = expiresAt.value;

  const publishedAt = parseOptionalDate(body.publishedAt, "Publish date");
  if (publishedAt.error) return publishedAt;
  if (publishedAt.supplied && publishedAt.value === null) {
    return { error: "Publish date cannot be empty." };
  }
  if (publishedAt.supplied) values.publishedAt = publishedAt.value;

  const effectivePublishedAt = values.publishedAt || new Date();
  if (values.expiresAt && values.expiresAt <= effectivePublishedAt) {
    return { error: "Expiry date must be after the publish date." };
  }

  return { values };
}

// Public endpoint: only active, published and unexpired notices can be shown
// on the public website.
router.get("/", async (req, res, next) => {
  try {
    const now = new Date();
    const notices = await CampusNotice.find({
      isActive: true,
      publishedAt: { $lte: now },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    })
      .select("title message audience isPinned publishedAt expiresAt createdAt")
      .sort({ isPinned: -1, publishedAt: -1, createdAt: -1 });

    res.json({ success: true, notices });
  } catch (error) {
    next(error);
  }
});

// Everything below this line is restricted to administrators.
router.use(protect, adminOnly);

// The admin view includes active, inactive, scheduled and expired notices.
router.get("/admin", async (req, res, next) => {
  try {
    const query = {};
    if (req.query.active === "true") query.isActive = true;
    if (req.query.active === "false") query.isActive = false;
    if (req.query.audience && audiences.includes(req.query.audience)) {
      query.audience = req.query.audience;
    }

    const notices = await CampusNotice.find(query)
      .populate("createdBy", "fullName email role")
      .populate("updatedBy", "fullName email role")
      .sort({ isPinned: -1, publishedAt: -1, createdAt: -1 });

    res.json({ success: true, notices });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const result = getNoticeValues(req.body);
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }

    const notice = await CampusNotice.create({
      ...result.values,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await writeAudit({
      req,
      action: "ADMIN_NOTICE_CREATED",
      entityType: "CampusNotice",
      entityId: notice._id,
      details: { title: notice.title, audience: notice.audience }
    });

    res.status(201).json({
      success: true,
      message: "Campus notice created successfully.",
      notice
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notice ID."
      });
    }

    const notice = await CampusNotice.findById(req.params.id);
    if (!notice) {
      return res.status(404).json({
        success: false,
        message: "Campus notice not found."
      });
    }

    const result = getNoticeValues(req.body, { partial: true });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }

    const nextPublishedAt = result.values.publishedAt || notice.publishedAt;
    const nextExpiresAt = Object.prototype.hasOwnProperty.call(
      result.values,
      "expiresAt"
    )
      ? result.values.expiresAt
      : notice.expiresAt;
    if (nextExpiresAt && nextExpiresAt <= nextPublishedAt) {
      return res.status(400).json({
        success: false,
        message: "Expiry date must be after the publish date."
      });
    }

    Object.assign(notice, result.values, { updatedBy: req.user._id });
    await notice.save();

    await writeAudit({
      req,
      action: "ADMIN_NOTICE_UPDATED",
      entityType: "CampusNotice",
      entityId: notice._id,
      details: { title: notice.title, audience: notice.audience }
    });

    res.json({
      success: true,
      message: "Campus notice updated successfully.",
      notice
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notice ID."
      });
    }

    const notice = await CampusNotice.findByIdAndDelete(req.params.id);
    if (!notice) {
      return res.status(404).json({
        success: false,
        message: "Campus notice not found."
      });
    }

    await writeAudit({
      req,
      action: "ADMIN_NOTICE_DELETED",
      entityType: "CampusNotice",
      entityId: notice._id,
      details: { title: notice.title, audience: notice.audience }
    });

    res.json({
      success: true,
      message: "Campus notice deleted successfully."
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
