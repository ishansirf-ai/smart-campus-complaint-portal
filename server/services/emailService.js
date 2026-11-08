function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// A Gmail SMTP connection takes noticeably longer the first time it is opened.
// Keep one small pool alive and remember a successful verification for a short
// period so every password-reset request does not repeat the same handshake.
let cachedTransporter = null;
let verificationPromise = null;
let verifiedUntil = 0;
const VERIFY_CACHE_MS = 10 * 60 * 1000;

function smtpIsConfigured() {
  const gmailUser = String(
    process.env.GMAIL_USER || process.env.SMTP_USER || ""
  ).trim();
  const gmailPassword = String(
    process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || ""
  ).replace(/\s+/g, "");

  return Boolean(gmailUser && gmailPassword);
}

function getTransporter() {
  const gmailUser = String(
    process.env.GMAIL_USER || process.env.SMTP_USER || ""
  ).trim();
  const gmailPassword = String(
    process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || ""
  ).replace(/\s+/g, "");

  if (!gmailUser || !gmailPassword) {
    const error = new Error(
      "Email service is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env."
    );
    error.statusCode = 503;
    throw error;
  }

  let nodemailer;
  try {
    // Lazy loading keeps the portal usable until npm install has completed.
    nodemailer = require("nodemailer");
  } catch {
    const error = new Error(
      "Nodemailer is missing. Run: npm install nodemailer"
    );
    error.statusCode = 503;
    throw error;
  }

  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      // A persistent SMTP pool prevents a slow TLS/Gmail login handshake for
      // every OTP while still waiting for Gmail to accept each message.
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      auth: {
        user: gmailUser,
        pass: gmailPassword
      }
    });

    // A network failure means the next request must establish and verify a
    // fresh connection instead of trusting a stale cached transport.
    cachedTransporter.on("error", () => {
      verifiedUntil = 0;
    });
  }

  return cachedTransporter;
}

async function verifyEmailTransport() {
  const transporter = getTransporter();
  if (verifiedUntil > Date.now()) return transporter;

  if (!verificationPromise) {
    verificationPromise = transporter
      .verify()
      .then(() => {
        verifiedUntil = Date.now() + VERIFY_CACHE_MS;
        return transporter;
      })
      .catch((error) => {
        // Do not cache a failed configuration or connection.
        cachedTransporter = null;
        verifiedUntil = 0;
        throw error;
      })
      .finally(() => {
        verificationPromise = null;
      });
  }

  await verificationPromise;
  return transporter;
}

// Warm the SMTP connection after the portal starts. It is deliberately
// non-blocking: a bad Gmail configuration must not prevent the complaint
// portal from starting, but the first real OTP request will still return a
// clear error if Gmail cannot accept it.
async function warmEmailTransport() {
  if (!smtpIsConfigured()) {
    console.warn("Gmail SMTP is not configured; password-reset emails are unavailable.");
    return false;
  }

  try {
    await verifyEmailTransport();
    console.log("Gmail SMTP is ready for password-reset emails.");
    return true;
  } catch (error) {
    console.error(`Gmail SMTP warm-up failed: ${error.message}`);
    return false;
  }
}

async function sendPasswordResetOtp({ to, fullName, otp, portal }) {
  const transporter = await verifyEmailTransport();
  const portalNames = {
    student: "Student Complaint Portal",
    admin: "Administrator Portal",
    department: "Department Staff Portal"
  };
  const portalLabel = portalNames[portal] || "Smart College Complaint Portal";
  const safeName = escapeHtml(fullName || "BGMIT Portal User");

  const plainText = [
    "BGMIT Mudhol - Smart College Complaint Portal",
    "",
    "Password Reset Request",
    "Your verification OTP is: " + otp,
    "This OTP is valid for 5 minutes.",
    "Do not share this OTP with anyone.",
    "If you did not request this password reset, please ignore this email. Your password will remain unchanged."
  ].join("\n");

  const html =
    '<div style="background:#eef5fb;padding:32px 16px;font-family:Arial,sans-serif;color:#173b5f;">' +
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(9,55,93,.12);">' +
    '<div style="background:linear-gradient(135deg,#073d72,#126abd);padding:28px 32px;color:#ffffff;">' +
    '<div style="display:inline-block;border:2px solid rgba(255,255,255,.8);border-radius:50%;padding:9px 12px;font-weight:800;font-size:18px;letter-spacing:1px;">BGMIT</div>' +
    '<h1 style="margin:18px 0 4px;font-size:24px;">Smart College Complaint Portal</h1>' +
    '<p style="margin:0;color:#dbeeff;font-size:14px;">' + escapeHtml(portalLabel) + '</p>' +
    '</div>' +
    '<div style="padding:32px;">' +
    '<p style="margin:0 0 12px;font-size:16px;">Hello ' + safeName + ',</p>' +
    '<h2 style="margin:0 0 12px;color:#0b4f8f;font-size:22px;">Password Reset Request</h2>' +
    '<p style="margin:0 0 22px;line-height:1.6;">Use this one-time verification code to reset your password.</p>' +
    '<div style="background:#f1f8ff;border:1px solid #bedcf7;border-radius:12px;color:#0b5597;font-size:34px;font-weight:800;letter-spacing:10px;padding:18px;text-align:center;">' + otp + '</div>' +
    '<p style="margin:22px 0 0;line-height:1.6;"><strong>This OTP is valid for 5 minutes.</strong></p>' +
    '<p style="margin:10px 0 0;line-height:1.6;color:#6b4c32;">If you did not request this password reset, please ignore this email. Never share this OTP with anyone.</p>' +
    '</div>' +
    '<div style="background:#f4f8fb;border-top:1px solid #dfeaf3;padding:18px 32px;color:#647b90;font-size:12px;text-align:center;">BGMIT Smart College Complaint Portal<br>Build for a better campus</div>' +
    '</div></div>';

  const delivery = await transporter.sendMail({
    from: process.env.SMTP_FROM || `${process.env.MAIL_FROM_NAME || "BGMIT Mudhol - Biluru Gurubasava Mahaswamiji Institute of Technology"} <${process.env.GMAIL_USER || process.env.SMTP_USER}>`,
    to,
    subject: "BGMIT Mudhol - Password Reset Verification Code",
    text: plainText,
    html
  });

  if (delivery.rejected?.length) {
    const error = new Error("Gmail rejected the password reset message.");
    error.statusCode = 503;
    throw error;
  }

  // A successful send can reuse this verified transport without another
  // verification request. Gmail has accepted the message at this point.
  verifiedUntil = Date.now() + VERIFY_CACHE_MS;
  console.log("Password reset email accepted by Gmail SMTP.");
}

module.exports = {
  sendPasswordResetOtp,
  verifyEmailTransport,
  warmEmailTransport
};
