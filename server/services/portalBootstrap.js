const Department = require("../models/Department");
const Category = require("../models/Category");
const SystemSetting = require("../models/SystemSetting");
const {
  DEPARTMENTS,
  DEFAULT_CATEGORIES,
  ADMIN_ONLY_CATEGORY_NAMES
} = require("../config/portal");

async function ensurePortalData() {
  await Promise.all(
    DEPARTMENTS.map((department) =>
      Department.updateOne(
        { code: department.code },
        { $setOnInsert: department },
        { upsert: true }
      )
    )
  );

  await Promise.all(
    DEFAULT_CATEGORIES.map((category) =>
      Category.updateOne(
        { name: category.name },
        { $setOnInsert: category },
        { upsert: true }
      )
    )
  );

  // Apply the non-negotiable administrator-only policy to existing category
  // records without overwriting an administrator's other route choices.
  await Category.updateMany(
    { name: { $in: ADMIN_ONLY_CATEGORY_NAMES } },
    { $set: { isAdminOnly: true } }
  );

  // Old aliases stay in history, but students cannot submit duplicate Bus,
  // Library, or Hostel categories after the new names are introduced.
  await Category.updateMany(
    { name: { $in: ["Bus / Transport Problem", "Library Problem", "Hostel Problem"] } },
    { $set: { isStudentVisible: false } }
  );

  await Promise.all([
    SystemSetting.updateOne(
      { key: "portalName" },
      {
        $setOnInsert: {
          key: "portalName",
          value: "Smart College Complaint Portal"
        }
      },
      { upsert: true }
    ),
    SystemSetting.updateOne(
      { key: "supportEmail" },
      { $setOnInsert: { key: "supportEmail", value: "" } },
      { upsert: true }
    ),
    SystemSetting.updateOne(
      { key: "maintenanceMessage" },
      { $setOnInsert: { key: "maintenanceMessage", value: "" } },
      { upsert: true }
    ),
    SystemSetting.updateOne(
      { key: "monthlyComplaintLimit" },
      { $setOnInsert: { key: "monthlyComplaintLimit", value: 5 } },
      { upsert: true }
    ),
    SystemSetting.updateOne(
      { key: "defaultComplaintPriority" },
      { $setOnInsert: { key: "defaultComplaintPriority", value: "Normal" } },
      { upsert: true }
    )
  ]);
}

module.exports = { ensurePortalData };
