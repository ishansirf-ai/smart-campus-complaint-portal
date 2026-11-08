require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const connectDatabase = require("./server/config/db");

const authRoutes = require("./server/routes/authRoutes");
const complaintRoutes = require("./server/routes/complaintRoutes");
const notificationRoutes = require("./server/routes/notificationRoutes");
const adminRoutes = require("./server/routes/adminRoutes");
const departmentRoutes = require("./server/routes/departmentRoutes");
const noticeRoutes = require("./server/routes/noticeRoutes");

const {
  startOverdueJob
} = require("./server/jobs/overdueJob");
const { ensurePortalData } = require("./server/services/portalBootstrap");
const { warmEmailTransport } = require("./server/services/emailService");

const {
  notFound,
  errorHandler
} = require("./server/middleware/errorHandler");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const localDevelopmentOrigins = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];
const allowedOrigins = new Set(
  [
    ...localDevelopmentOrigins,
    ...(process.env.CLIENT_URL || "").split(","),
    // Render supplies its public onrender.com URL at runtime. Including it
    // means the same deployed service can call its own /api routes securely
    // without putting a generated public URL in source control.
    process.env.RENDER_EXTERNAL_URL || ""
  ]
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function isLocalDevelopmentOrigin(origin) {
  if (process.env.NODE_ENV === "production") return false;

  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function validateEnvironment() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in .env.");
  }

  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32
  ) {
    throw new Error(
      "JWT_SECRET must contain at least 32 random characters."
    );
  }
}

app.use(
  cors({
    origin(origin, callback) {
      // Browser-less requests such as PowerShell testing do not include Origin.
      if (
        !origin ||
        allowedOrigins.has(origin) ||
        isLocalDevelopmentOrigin(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error("This browser origin is not allowed."));
    }
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(
  "/assets",
  express.static(path.join(__dirname, "assets"))
);

// Complaint evidence is deliberately not exposed as a public static folder.
// Each portal streams it through an authorized complaint route instead.

function sendPortalApp(req, res) {
  res.sendFile(path.join(__dirname, "index.html"));
}

// Public About page and separate bookmarkable entry URLs for each portal.
app.get(["/", "/about", "/student-login", "/admin-login", "/department-login"], sendPortalApp);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Smart College Portal API is running."
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/complaints", complaintRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/department", departmentRoutes);
app.use("/api/notices", noticeRoutes);

app.use(notFound);
app.use(errorHandler);

async function startServer() {
  validateEnvironment();

  await connectDatabase();
  await ensurePortalData();

  // Start automatic overdue/SLA feature.
  startOverdueJob();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Portal running at http://localhost:${PORT}`);
    // Start preparing Gmail immediately so the first OTP request does not
    // need to wait for the complete SMTP/TLS connection setup.
    void warmEmailTransport();
  });
}

startServer().catch((error) => {
  console.error(`Cannot start server: ${error.message}`);
  process.exit(1);
});
