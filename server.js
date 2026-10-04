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

const {
  startOverdueJob
} = require("./server/jobs/overdueJob");

const {
  notFound,
  errorHandler
} = require("./server/middleware/errorHandler");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

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
    origin: process.env.CLIENT_URL || "http://localhost:5000"
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

app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

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

app.use(notFound);
app.use(errorHandler);

async function startServer() {
  validateEnvironment();

  await connectDatabase();

  // Start automatic overdue/SLA feature.
  startOverdueJob();

  app.listen(PORT, () => {
    console.log(`Portal running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error(`Cannot start server: ${error.message}`);
  process.exit(1);
});