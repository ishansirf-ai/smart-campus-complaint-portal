// The five departments available in the portal. Keep the codes stable because
// they are stored on Complaint and User documents.
const DEPARTMENTS = Object.freeze([
  {
    code: "CSE",
    name: "Computer Science and Engineering",
    description: "Campus systems, classrooms and network-related issues."
  },
  {
    code: "AIML",
    name: "Artificial Intelligence and Machine Learning",
    description: "AI/ML laboratory and specialist equipment issues."
  },
  {
    code: "CIVIL",
    name: "Civil Engineering",
    description: "Water, cleanliness and infrastructure issues."
  },
  {
    code: "EC",
    name: "Electronics and Communication",
    description: "Electrical and electronics issues."
  },
  {
    code: "MECHANICAL",
    name: "Mechanical Engineering",
    description: "Mechanical equipment and workshop issues."
  }
]);

const DEPARTMENT_CODES = DEPARTMENTS.map((department) => department.code);
// ADMIN is a handling target for services such as transport and security.
// It does not create a sixth Department account.
const ROUTING_TARGETS = [...DEPARTMENT_CODES, "ADMIN"];

// Categories that only administrators can manage.
const ADMIN_ONLY_CATEGORY_NAMES = Object.freeze([
  "Hostel",
  "Parking",
  "Bus",
  "Library"
]);

// These are seeded into MongoDB when the server starts. Administrators can
// later change the destination department in the Categories screen.
const DEFAULT_CATEGORIES = Object.freeze([
  // New student-facing categories.
  { name: "Campus", department: "CIVIL", description: "Campus grounds and common-area concerns." },
  { name: "Parking", department: "ADMIN", description: "Parking concerns managed by administration.", isAdminOnly: true },
  { name: "Library", department: "ADMIN", description: "Library concerns managed by administration.", isAdminOnly: true },
  { name: "Hostel", department: "ADMIN", description: "Hostel concerns managed by administration.", isAdminOnly: true },
  { name: "Bus", department: "ADMIN", description: "Bus and transport concerns managed by administration.", isAdminOnly: true },
  { name: "Water", department: "CIVIL", description: "Water supply, leakage and sanitation concerns." },
  { name: "Food", department: "ADMIN", description: "Food-service concerns managed by administration.", isAdminOnly: true },
  { name: "Attendance", department: "ADMIN", description: "Attendance concerns managed by academic administration.", isAdminOnly: true },
  { name: "Personal Complaint", department: "ADMIN", description: "Private student concern reviewed only by administration.", isAdminOnly: true },

  // Existing categories are retained to preserve historic complaint records.
  { name: "Electrical", department: "EC" },
  { name: "Water Leakage", department: "CIVIL" },
  { name: "Classroom Equipment", department: "CSE" },
  { name: "Internet Problems", department: "CSE" },
  { name: "Cleanliness", department: "CIVIL" },
  { name: "Infrastructure", department: "CIVIL" },
  { name: "Laboratory Equipment", department: "AIML" },
  { name: "Mechanical Equipment", department: "MECHANICAL" },
  { name: "Electricity Problem", department: "EC" },
  { name: "Water Problem", department: "CIVIL" },
  { name: "Maintenance Problem", department: "MECHANICAL" },
  { name: "Technical / Computer Problem", department: "CSE" },
  { name: "Internet / Wi-Fi Problem", department: "CSE" },
  { name: "Classroom / Furniture Problem", department: "CSE" },
  { name: "Laboratory Problem", department: "AIML" },
  { name: "Cleanliness / Sanitation Problem", department: "CIVIL" },
  { name: "Infrastructure / Building Problem", department: "CIVIL" },
  { name: "Washroom Problem", department: "CIVIL" },
  { name: "Bus / Transport Problem", department: "ADMIN" },
  { name: "Library Problem", department: "ADMIN" },
  { name: "Hostel Problem", department: "ADMIN" },
  { name: "Security / Safety Problem", department: "ADMIN" },
  { name: "Other College Service Problem", department: "ADMIN" },
  { name: "Other", department: "ADMIN" }
]);

// Kept as a compatibility export for existing code and old documentation.
const categoryDepartmentMap = Object.freeze(
  Object.fromEntries(
    DEFAULT_CATEGORIES.map((category) => [
      category.name,
      category.department
    ])
  )
);

const priorityDays = Object.freeze({
  Low: 14,
  Normal: 10,
  High: 5,
  Emergency: 1
});

function isValidDepartment(department) {
  return DEPARTMENT_CODES.includes(String(department || "").trim());
}

function isValidRoutingTarget(target) {
  return ROUTING_TARGETS.includes(String(target || "").trim());
}

function isAdminOnlyCategory(category) {
  return ADMIN_ONLY_CATEGORY_NAMES.includes(
    String(category || "").trim()
  );
}

function getDepartment(category) {
  return categoryDepartmentMap[category] || "CSE";
}

function getDueDate(priority) {
  const days = priorityDays[priority] || priorityDays.Normal;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);
  return dueDate;
}

module.exports = {
  DEPARTMENTS,
  DEPARTMENT_CODES,
  ROUTING_TARGETS,
  ADMIN_ONLY_CATEGORY_NAMES,
  DEFAULT_CATEGORIES,
  categoryDepartmentMap,
  priorityDays,
  isValidDepartment,
  isValidRoutingTarget,
  isAdminOnlyCategory,
  getDepartment,
  getDueDate
};
