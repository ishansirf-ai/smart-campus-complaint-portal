const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "../../.env")
});

const { verifyEmailTransport } = require("../services/emailService");
const provider =
  String(process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase() ===
  "gmail_api"
    ? "Gmail API"
    : "Gmail SMTP";

verifyEmailTransport()
  .then(() => {
    console.log(`${provider} connection verified successfully.`);
  })
  .catch((error) => {
    console.error(
      `${provider} verification failed:`,
      error.code || error.name,
      "-",
      error.message
    );
    process.exitCode = 1;
  });
