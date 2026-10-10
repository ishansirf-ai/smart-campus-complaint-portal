const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const uploadDirectory = path.join(__dirname, "../../uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, done) => {
    done(null, uploadDirectory);
  },
  filename: (req, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeFilename =
      Date.now() +
      "-" +
      crypto.randomBytes(8).toString("hex") +
      extension;
    done(null, safeFilename);
  }
});

const allowedAttachmentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
];

const allowedImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

function allowAttachment(req, file, done) {
  if (!allowedAttachmentTypes.includes(file.mimetype)) {
    return done(
      new Error("Upload only JPG, PNG, WEBP, or PDF attachment files.")
    );
  }
  done(null, true);
}

function allowImage(req, file, done) {
  if (!allowedImageTypes.includes(file.mimetype)) {
    return done(
      new Error("Upload only JPG, PNG, or WEBP image files.")
    );
  }
  done(null, true);
}

const uploadOptions = {
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 4
  }
};

const upload = multer({
  ...uploadOptions,
  fileFilter: allowAttachment
});

const imageUpload = multer({
  ...uploadOptions,
  fileFilter: allowImage
});

// Supports legacy "photo" uploads and the new multi-attachment field.
const complaintUpload = upload.fields([
  { name: "photo", maxCount: 1 },
  { name: "attachments", maxCount: 3 }
]);

module.exports = {
  upload,
  imageUpload,
  complaintUpload,
  uploadDirectory,
  allowedAttachmentTypes,
  allowedImageTypes
};
