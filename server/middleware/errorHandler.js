function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

function errorHandler(error, req, res, next) {
  console.error(error);

  // MongoDB duplicate email / USN error.
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "Email or USN already exists."
    });
  }

  // Mongoose model validation error.
  if (error.name === "ValidationError") {
    const message = Object.values(error.errors)
      .map((item) => item.message)
      .join(" ");

    return res.status(400).json({
      success: false,
      message
    });
  }

  // Multer photo upload error.
  if (error.name === "MulterError") {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "Internal server error."
  });
}

module.exports = {
  notFound,
  errorHandler
};