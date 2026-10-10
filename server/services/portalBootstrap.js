const Department = require("../models/Department");
const Category = require("../models/Category");
const SystemSetting = require("../models/SystemSetting");
const {
  DEPARTMENTS,
  DEFAULT_CATEGORIES
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
    )
  ]);
}

module.exports = { ensurePortalData };
