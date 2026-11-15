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
const GMAIL_API_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
let gmailApiAccessToken = null;
let gmailApiTokenExpiresAt = 0;
let gmailApiTokenPromise = null;

// Use this provider on Render Free. It sends through the owner's Gmail
// account over HTTPS, which avoids the SMTP-port restriction on free hosts.
// Local development continues using Gmail SMTP unless explicitly changed.
function getEmailProvider() {
  const provider = String(process.env.EMAIL_PROVIDER || "smtp")
    .trim()
    .toLowerCase();

  if (provider === "smtp" || provider === "gmail_api") return provider;

  const error = new Error(
    "EMAIL_PROVIDER must be either smtp or gmail_api."
  );
  error.statusCode = 503;
  throw error;
}

function emailServiceError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function getGmailApiConfig() {
  const senderEmail = String(process.env.GMAIL_USER || "").trim();
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(
    process.env.GOOGLE_OAUTH_CLIENT_SECRET || ""
  ).trim();
  const refreshToken = String(
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN || ""
  ).trim();

  if (!senderEmail || !clientId || !clientSecret || !refreshToken) {
    throw emailServiceError(
      "Gmail API is not configured. Add GMAIL_USER and the three GOOGLE_OAUTH variables."
    );
  }

  return { senderEmail, clientId, clientSecret, refreshToken };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw emailServiceError("Gmail API connection timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readGoogleError(response) {
  const body = await response.json().catch(() => ({}));
  const message = String(
    body.error_description || body.error?.message || body.error || response.statusText
  )
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);

  return message || `HTTP ${response.status}`;
}

async function getGmailApiAccessToken() {
  const config = getGmailApiConfig();

  if (gmailApiAccessToken && gmailApiTokenExpiresAt > Date.now() + 60000) {
    return { accessToken: gmailApiAccessToken, config };
  }

  if (!gmailApiTokenPromise) {
    gmailApiTokenPromise = fetchWithTimeout(GMAIL_API_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token"
      }).toString()
    })
      .then(async (response) => {
        if (!response.ok) {
          throw emailServiceError(
            `Gmail API token request failed: ${await readGoogleError(response)}`
          );
        }

        const data = await response.json();
        if (!data.access_token) {
          throw emailServiceError("Gmail API did not return an access token.");
        }

        gmailApiAccessToken = data.access_token;
        gmailApiTokenExpiresAt = Date.now() +
          Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;

        return { accessToken: gmailApiAccessToken, config };
      })
      .finally(() => {
        gmailApiTokenPromise = null;
      });
  }

  return gmailApiTokenPromise;
}

function createGmailApiMessage({ from, to, subject, text, html }) {
  const boundary = `bgmit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const message = [
    `From: BGMIT Mudhol <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`
  ].join("\r\n");

  return Buffer.from(message, "utf8").toString("base64url");
}

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
  if (getEmailProvider() === "gmail_api") {
    const result = await getGmailApiAccessToken();
    verifiedUntil = Date.now() + VERIFY_CACHE_MS;
    return result;
  }

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
  const provider = getEmailProvider();

  if (provider === "smtp" && !smtpIsConfigured()) {
    console.warn("Gmail SMTP is not configured; password-reset emails are unavailable.");
    return false;
  }

  try {
    await verifyEmailTransport();
    console.log(
      provider === "gmail_api"
        ? "Gmail API is ready for password-reset emails."
        : "Gmail SMTP is ready for password-reset emails."
    );
    return true;
  } catch (error) {
    const label = provider === "gmail_api" ? "Gmail API" : "Gmail SMTP";
    console.error(`${label} warm-up failed: ${error.message}`);
    return false;
  }
}

async function sendPasswordResetOtp({ to, fullName, otp, portal }) {
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

  if (getEmailProvider() === "gmail_api") {
    const { accessToken, config } = await verifyEmailTransport();
    const response = await fetchWithTimeout(GMAIL_API_SEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        raw: createGmailApiMessage({
          from: config.senderEmail,
          to,
          subject: "BGMIT Mudhol - Password Reset Verification Code",
          text: plainText,
          html
        })
      })
    });

    if (!response.ok) {
      gmailApiAccessToken = null;
      gmailApiTokenExpiresAt = 0;
      throw emailServiceError(
        `Gmail API rejected the password reset message: ${await readGoogleError(response)}`
      );
    }

    verifiedUntil = Date.now() + VERIFY_CACHE_MS;
    console.log("Password reset email accepted by Gmail API.");
    return;
  }

  const transporter = await verifyEmailTransport();

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
