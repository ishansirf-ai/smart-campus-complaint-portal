function publicUser(user) {
  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    usn: user.usn,
    department: user.department,
    semester: user.semester,
    phone: user.phone || "",
    profile: user.profile || {},
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

module.exports = { publicUser };
