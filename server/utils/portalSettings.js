const SystemSetting = require("../models/SystemSetting");
const { normalizeLimit } = require("./submissionLimit");

const PRIORITIES = ["Low", "Normal", "High", "Emergency"];

async function getComplaintSubmissionSettings() {
  const settings = await SystemSetting.find({
    key: { $in: ["monthlyComplaintLimit", "defaultComplaintPriority"] }
  }).lean();
  const values = settings.reduce((result, setting) => {
    result[setting.key] = setting.value;
    return result;
  }, {});
  const priority = PRIORITIES.includes(String(values.defaultComplaintPriority))
    ? String(values.defaultComplaintPriority)
    : "Normal";

  return {
    monthlyComplaintLimit: normalizeLimit(values.monthlyComplaintLimit, 5),
    defaultComplaintPriority: priority
  };
}

module.exports = {
  PRIORITIES,
  getComplaintSubmissionSettings
};
