const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "../../.env")
});

const { verifyEmailTransport } = require("../services/emailService");

verifyEmailTransport()
  .then(() => {
    console.log("Gmail SMTP connection verified successfully.");
  })
  .catch((error) => {
    console.error(
      "Gmail SMTP verification failed:",
      error.code || error.name,
      "-",
      error.message
    );
    process.exitCode = 1;
  });
