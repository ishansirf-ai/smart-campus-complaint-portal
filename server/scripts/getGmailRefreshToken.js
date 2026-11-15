// Run this once on your own computer to authorize the portal's sending Gmail
// account for the free Gmail API option. Never share the generated refresh
// token. Save it only as GOOGLE_OAUTH_REFRESH_TOKEN in .env and Render.
const http = require("http");
const crypto = require("crypto");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "../../.env")
});

const PORT = 4280;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
const clientSecret = String(
  process.env.GOOGLE_OAUTH_CLIENT_SECRET || ""
).trim();

if (!clientId || !clientSecret) {
  console.error(
    "Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env first."
  );
  process.exit(1);
}

const state = crypto.randomBytes(24).toString("hex");
const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

authorizationUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: GMAIL_SEND_SCOPE,
  access_type: "offline",
  prompt: "consent",
  state
}).toString();

const server = http.createServer(async (req, res) => {
  const callbackUrl = new URL(req.url, REDIRECT_URI);

  if (callbackUrl.pathname !== "/oauth2callback") {
    res.writeHead(404).end("Not found");
    return;
  }

  if (callbackUrl.searchParams.get("state") !== state) {
    res.writeHead(400).end("Authorization state did not match. Try again.");
    server.close();
    return;
  }

  const code = callbackUrl.searchParams.get("code");
  const oauthError = callbackUrl.searchParams.get("error");

  if (!code || oauthError) {
    res.writeHead(400).end("Google authorization was cancelled or failed.");
    console.error("Google authorization failed:", oauthError || "no code returned");
    server.close();
    return;
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI
      }).toString()
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok || !tokenData.refresh_token) {
      throw new Error(
        tokenData.error_description ||
          "Google did not return a refresh token. Revoke the previous access and run this script again."
      );
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      "<h2>Gmail connected.</h2><p>Return to VS Code. Copy the refresh token from the terminal into your local .env and Render Environment. Do not share it.</p>"
    );
    console.log("\nCopy this value into .env and Render as GOOGLE_OAUTH_REFRESH_TOKEN:");
    console.log(tokenData.refresh_token);
    console.log("\nDo not paste this token into chat, GitHub, or frontend code.");
  } catch (error) {
    res.writeHead(500).end("Could not get a Gmail refresh token. Check terminal.");
    console.error("Could not get Gmail refresh token:", error.message);
  } finally {
    setTimeout(() => server.close(), 300);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this URL in your browser and sign in with the Gmail account that sends portal OTPs:\n");
  console.log(authorizationUrl.toString());
  console.log(`\nWaiting for Google at ${REDIRECT_URI}`);
});
