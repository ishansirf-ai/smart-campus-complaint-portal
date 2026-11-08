const fs = require("fs");
const path = require("path");

const uploadDirectory = path.join(__dirname, "../../uploads");

function safeStoredFilename(uploadUrl) {
  const filename = path.basename(String(uploadUrl || ""));

  // A stored upload must be a plain filename. Reject traversal, blank strings,
  // and the legacy route itself rather than ever resolving user input directly.
  if (!filename || filename === "." || filename === "..") return null;
  return filename;
}

function safeDownloadName(value) {
  return String(value || "attachment")
    .replace(/[\\/:*?"<>|\r\n]+/g, "-")
    .slice(0, 180) || "attachment";
}

function mimeFromStoredFilename(uploadUrl) {
  const extension = path.extname(String(uploadUrl || "")).toLowerCase();
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf"
  }[extension] || "application/octet-stream";
}

function sendStoredUpload(res, { uploadUrl, mimeType, downloadName }) {
  const filename = safeStoredFilename(uploadUrl);
  if (!filename) {
    const error = new Error("Attachment is unavailable.");
    error.statusCode = 404;
    throw error;
  }

  const fullPath = path.join(uploadDirectory, filename);
  if (!fullPath.startsWith(uploadDirectory + path.sep) || !fs.existsSync(fullPath)) {
    const error = new Error("Attachment file was not found.");
    error.statusCode = 404;
    throw error;
  }

  res.setHeader("Content-Type", mimeType || mimeFromStoredFilename(uploadUrl));
  res.setHeader("Content-Disposition", `inline; filename="${safeDownloadName(downloadName)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(fullPath).pipe(res);
}

module.exports = {
  sendStoredUpload
};
