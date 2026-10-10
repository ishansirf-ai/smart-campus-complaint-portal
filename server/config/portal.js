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

// These are seeded into MongoDB when the server starts. Administrators can
// later change the destination department in the Categories screen.
const DEFAULT_CATEGORIES = Object.freeze([
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
  DEFAULT_CATEGORIES,
  categoryDepartmentMap,
  priorityDays,
  isValidDepartment,
  isValidRoutingTarget,
  getDepartment,
  getDueDate
};
