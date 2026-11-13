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
5. In Render's **Environment** page, enter these private values:

   - `MONGODB_URI`
   - `BREVO_API_KEY`
   - `BREVO_SENDER_EMAIL`

   `BREVO_SENDER_EMAIL` must be an email sender verified in Brevo. Render
   generates `JWT_SECRET` automatically. Never copy your `.env` into GitHub,
   `render.yaml`, or a browser chat.
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

## Important free-plan note

Render's Free web service can sleep after 15 minutes of no activity. The first
visitor after sleep can wait about one minute while it starts. Free services
also lose files saved in the local `uploads` folder after a restart or deploy.

Render Free blocks outgoing SMTP ports, including Gmail ports 465 and 587.
This project uses Brevo's HTTPS email API for password-reset emails in
production. Create a Brevo account, verify the sender email, create an API key,
then add `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` in Render. Keep Gmail SMTP
variables only for local development or a paid Render service.

For a permanent college portal with permanent uploaded complaint photos, use a
paid Render service with a persistent disk or move uploads to cloud storage
such as Cloudinary or Amazon S3. MongoDB complaint records remain in Atlas.

## After you receive your public URL

If you later connect a custom domain, add it to the Render service environment
variable `CLIENT_URL`, then redeploy. Example:

```text
CLIENT_URL=https://complaints.yourcollege.edu
```
