// Automatically select department based on complaint category.
const categoryDepartmentMap = {
  Electrical: "Maintenance Department",
  "Water Leakage": "Civil / Maintenance Department",
  "Classroom Equipment": "Maintenance Department",
  "Internet Problems": "IT Department",
  Cleanliness: "Housekeeping Department",
  Infrastructure: "Civil / Maintenance Department",
  "Laboratory Equipment": "Laboratory Department",
  Other: "Administration"
};

// Due date rules based on priority.
const priorityDays = {
  Low: 14,
  Normal: 10,
  High: 5,
  Emergency: 1
};

// Find department from category.
function getDepartment(category) {
  return categoryDepartmentMap[category] || "Administration";
}

// Create due date from priority.
function getDueDate(priority) {
  const days = priorityDays[priority] || 10;
  const dueDate = new Date();

  dueDate.setDate(dueDate.getDate() + days);

  return dueDate;
}

module.exports = {
  categoryDepartmentMap,
  priorityDays,
  getDepartment,
  getDueDate
};