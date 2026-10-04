const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Checks if the user sent a valid JWT login token.
async function protect(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";

    // Token format must be: Bearer TOKEN_HERE
    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Login is required."
      });
    }

    // Remove "Bearer " and keep only the token.
    const token = authorization.split(" ")[1];

    // Read user ID stored inside token.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get current user from MongoDB.
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

// Allows only selected roles to use a route.
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission for this action."
      });
    }

    next();
  };
}

module.exports = {
  protect,
  allowRoles
};