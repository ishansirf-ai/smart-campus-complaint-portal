# Publish the BGMIT Smart College Complaint Portal

This project is ready to deploy as one public Express web service. The browser
pages and the `/api` backend run from the same public URL.

## Before deploying

1. Do not upload `.env`. It contains MongoDB, Gmail and password secrets.
2. Keep `.gitignore` unchanged: it already excludes `.env`, `node_modules` and
   uploaded files.
3. Confirm the local portal still starts with `npm run dev`.

## 1. Upload the project to GitHub

Open a terminal inside the project folder and run these commands. Replace the
GitHub URL only after creating an empty GitHub repository named
`smart-college-portal`.

```powershell
git add .
git commit -m "Prepare Smart College Portal for public deployment"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/smart-college-portal.git
git push -u origin main
```

If Git says `remote origin already exists`, use this instead:

```powershell
git remote set-url origin https://github.com/YOUR-GITHUB-USERNAME/smart-college-portal.git
git push -u origin main
```

Before pushing, run `git status` and ensure that `.env` is **not** listed.

## 2. Create the public service on Render

1. Sign in at <https://dashboard.render.com> with GitHub.
2. Click **New** → **Blueprint**.
3. Select the `smart-college-portal` repository.
4. Render reads `render.yaml`. Confirm the service name and select **Apply**.
5. When Render asks for values, enter only these private values from your
   local `.env` file:

   - `MONGODB_URI`
   - `GMAIL_USER`
   - `GMAIL_APP_PASSWORD`

   Render generates `JWT_SECRET` automatically. Never copy your `.env` into
   GitHub, `render.yaml`, or a browser chat.
6. Click **Create Blueprint Instance** and wait for the deploy to finish.
7. Open the URL shown by Render, for example:
   `https://bgmit-smart-college-portal.onrender.com`

## 3. Permit the deployed server to reach MongoDB Atlas

In MongoDB Atlas:

1. Open your project → **Network Access** → **Add IP Address**.
2. For a college demonstration, add `0.0.0.0/0` temporarily.
3. Save, then redeploy/restart the Render service if its first deploy failed.

Your Atlas database user must have read/write access to the database named in
`MONGODB_URI`.

## 4. Verify the live website

Open these URLs after the deploy:

```text
https://YOUR-RENDER-URL/api/health
https://YOUR-RENDER-URL/
https://YOUR-RENDER-URL/about
https://YOUR-RENDER-URL/student-login
https://YOUR-RENDER-URL/admin-login
https://YOUR-RENDER-URL/department-login
```

The health URL must return `success: true`.

## Free Render: send OTPs through the Gmail API

Render Free blocks SMTP, including Gmail SMTP. The portal supports Gmail's
official HTTPS API so password-reset OTPs can still be sent from your Gmail
address without a paid email provider.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable **Gmail API**.
2. Open **APIs & Services → OAuth consent screen**, configure the app, and add
   the Gmail account that sends portal OTPs as a test user.
3. Open **Credentials → Create Credentials → OAuth client ID → Web
   application**. Add this exact authorized redirect URI:

   ```text
   http://localhost:4280/oauth2callback
   ```

4. In your local `.env`, add the client ID and client secret. Then run:

   ```powershell
   npm run gmail:authorize
   ```

   Open the URL printed in the terminal, sign in as the portal's sending Gmail
   account, allow Gmail sending, and copy the refresh token printed only in
   your terminal.
5. Add these private variables in Render → Environment, then redeploy:

   ```text
   EMAIL_PROVIDER=gmail_api
   GMAIL_USER=the_same_authorized_gmail_address
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   GOOGLE_OAUTH_REFRESH_TOKEN=...
   ```

Never commit or share the client secret or refresh token. After deployment,
Render Logs should say `Gmail API is ready for password-reset emails.`

## Important free-plan note

Render's Free web service can sleep after 15 minutes of no activity. The first
visitor after sleep can wait about one minute while it starts. Free services
also lose files saved in the local `uploads` folder after a restart or deploy.

For a permanent college portal with permanent uploaded complaint photos, use a
paid Render service with a persistent disk or move uploads to cloud storage
such as Cloudinary or Amazon S3. MongoDB complaint records remain in Atlas.

## After you receive your public URL

If you later connect a custom domain, add it to the Render service environment
variable `CLIENT_URL`, then redeploy. Example:

```text
CLIENT_URL=https://complaints.yourcollege.edu
```
