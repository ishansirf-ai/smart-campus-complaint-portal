const Complaint = require("../models/Complaint");
const StudentMonthlyUsage = require("../models/StudentMonthlyUsage");

const DISPLAY_TIME_ZONE = "Asia/Kolkata";

function currentMonthWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year").value);
  const month = Number(parts.find((part) => part.type === "month").value);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const pad = (number) => String(number).padStart(2, "0");

  return {
    monthKey: `${year}-${pad(month)}`,
    start: new Date(`${year}-${pad(month)}-01T00:00:00+05:30`),
    end: new Date(`${nextYear}-${pad(nextMonth)}-01T00:00:00+05:30`)
  };
}

function normalizeLimit(value, fallback = 5) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 100
    ? number
    : fallback;
}

async function existingSubmissionCount(student, window) {
  return Complaint.countDocuments({
    student,
    createdAt: { $gte: window.start, $lt: window.end }
  });
}

async function getMonthlySubmissionSummary(student, limit) {
  const window = currentMonthWindow();
  const submitted = await existingSubmissionCount(student, window);
  return {
    monthKey: window.monthKey,
    limit,
    submitted,
    remaining: Math.max(limit - submitted, 0)
  };
}

// The unique index and conditional increment make parallel form submits safe.
async function reserveMonthlySubmission(student, limit) {
  const window = currentMonthWindow();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let usage = await StudentMonthlyUsage.findOne({
      student,
      monthKey: window.monthKey
    });

    if (!usage) {
      const currentCount = await existingSubmissionCount(student, window);
      if (currentCount >= limit) {
        return { allowed: false, ...await getMonthlySubmissionSummary(student, limit) };
      }
      try {
        usage = await StudentMonthlyUsage.create({
          student,
          monthKey: window.monthKey,
          submittedCount: currentCount + 1
        });
        return {
          allowed: true,
          usageId: usage._id,
          limit,
          submitted: usage.submittedCount,
          remaining: Math.max(limit - usage.submittedCount, 0)
        };
      } catch (error) {
        if (error?.code !== 11000) throw error;
        continue;
      }
    }

    const updated = await StudentMonthlyUsage.findOneAndUpdate(
      { _id: usage._id, submittedCount: { $lt: limit } },
      { $inc: { submittedCount: 1 } },
      { new: true }
    );
    if (updated) {
      return {
        allowed: true,
        usageId: updated._id,
        limit,
        submitted: updated.submittedCount,
        remaining: Math.max(limit - updated.submittedCount, 0)
      };
    }
    return { allowed: false, ...await getMonthlySubmissionSummary(student, limit) };
  }

  return { allowed: false, ...await getMonthlySubmissionSummary(student, limit) };
}

async function releaseMonthlySubmission(reservation) {
  if (!reservation?.usageId) return;
  await StudentMonthlyUsage.updateOne(
    { _id: reservation.usageId, submittedCount: { $gt: 0 } },
    { $inc: { submittedCount: -1 } }
  );
}

module.exports = {
  DISPLAY_TIME_ZONE,
  currentMonthWindow,
  normalizeLimit,
  getMonthlySubmissionSummary,
  reserveMonthlySubmission,
  releaseMonthlySubmission
};
