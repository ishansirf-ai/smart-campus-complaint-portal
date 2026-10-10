function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTransporter() {
  const required = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM"
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    const error = new Error(
      "Email service is not configured. Add SMTP values to .env."
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

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

async function sendPasswordResetOtp({ to, fullName, otp, portal }) {
  const transporter = getTransporter();
  const portalNames = {
    student: "Student Complaint Portal",
    admin: "Administrator Portal",
    department: "Department Staff Portal"
  };
  const portalLabel = portalNames[portal] || "Smart College Complaint Portal";
  const safeName = escapeHtml(fullName || "BGMIT Portal User");

  const plainText = [
    "BGMIT Smart College Complaint Portal",
    "",
    "Password Reset Request",
    "Your verification OTP is: " + otp,
    "This OTP is valid for 10 minutes.",
    "If you did not request this password reset, please ignore this email."
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
    '<p style="margin:22px 0 0;line-height:1.6;"><strong>This OTP is valid for 10 minutes.</strong></p>' +
    '<p style="margin:10px 0 0;line-height:1.6;color:#6b4c32;">If you did not request this password reset, please ignore this email. Never share this OTP with anyone.</p>' +
    '</div>' +
    '<div style="background:#f4f8fb;border-top:1px solid #dfeaf3;padding:18px 32px;color:#647b90;font-size:12px;text-align:center;">BGMIT Smart College Complaint Portal<br>Build for a better campus</div>' +
    '</div></div>';

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "BGMIT Password Reset OTP",
    text: plainText,
    html
  });
}

module.exports = {
  sendPasswordResetOtp
};
