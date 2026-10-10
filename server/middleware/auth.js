const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Checks the session token and loads the current database user. This protects
// every role-specific API from forged frontend values.
async function protect(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Login is required."
      });
    }

    const token = authorization.slice(7).trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.purpose && decoded.purpose !== "session") {
      return res.status(401).json({
        success: false,
        message: "This token cannot access the portal."
      });
    }

    req.user = await User.findById(decoded.id);

    if (!req.user || !req.user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account does not exist or is inactive."
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired login token."
    });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission for this action."
      });
    }

    next();
  };
}

const adminOnly = authorize("admin");
const departmentOnly = authorize("department");
const studentOnly = authorize("student");

module.exports = {
  protect,
  authorize,
  // Existing routes used this name. It is kept as an alias.
  allowRoles: authorize,
  adminOnly,
  departmentOnly,
  studentOnly
};
