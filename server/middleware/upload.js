const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

// Folder where uploaded photos are stored.
const uploadDirectory = path.join(__dirname, "../../uploads");

// Create uploads folder if it does not exist.
fs.mkdirSync(uploadDirectory, { recursive: true });

// Decide where photo goes and its safe filename.
const storage = multer.diskStorage({
  destination: (req, file, done) => {
    done(null, uploadDirectory);
  },

  filename: (req, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();

    // Example: 1760000000-a12b3c4d.jpg
    const safeFilename = `${Date.now()}-${crypto
      .randomBytes(6)
      .toString("hex")}${extension}`;

    done(null, safeFilename);
  }
});

// Accept only safe image file types.
function imageOnly(req, file, done) {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    return done(
      new Error("Upload only JPG, PNG, or WEBP image files.")
    );
  }

  done(null, true);
}

// Upload configuration.
const upload = multer({
  storage,
  fileFilter: imageOnly,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

module.exports = {
  upload,
  uploadDirectory
};