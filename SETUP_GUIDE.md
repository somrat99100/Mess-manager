# Setup Guide — OTP Verification, Forgot Password, Email Notifications

This covers everything you need to configure after unzipping the latest build so the new
features actually work: OTP email verification, forgot password, and email notifications
(notices, meal-off confirmations, manager confirmations).

Two things need setup: **EmailJS** (for OTP + notification emails) and **deploying the
updated `firestore.rules`**. Forgot password needs no setup — it uses Firebase's built-in
password reset email and works out of the box.

---

## 1. EmailJS setup (~10 minutes)

EmailJS lets the browser send real emails without a backend server — perfect for this
project since it's a static site with no server of its own.

### Step 1 — Create an account
Go to **https://www.emailjs.com** and sign up for the free plan (200 emails/month, enough
for a small mess).

### Step 2 — Connect an email service
1. In the EmailJS dashboard, go to **Email Services → Add New Service**.
2. Pick a provider — Gmail is easiest. Connect the Google account you want emails to be
   sent *from* (e.g. a Gmail you create for the mess, like `greenvalleymess@gmail.com`).
3. Once connected, copy the **Service ID** shown (looks like `service_abc1234`).

### Step 3 — Create two email templates
You need two separate templates because they carry different content.

**Template A — OTP code** (Email Templates → Create New Template)
- Subject, e.g.: `Your Mess Manager Pro verification code`
- Body must include `{{otp_code}}`. Example:
  ```
  Hi {{to_name}},

  Your verification code is: {{otp_code}}

  This code expires in 10 minutes. If you didn't request this, you can ignore this email.
  ```
- Save, then copy this template's **Template ID** (looks like `template_xyz789`).

**Template B — General notifications** (used for notices, meal-off confirmations, manager
confirmations)
- Subject field: `{{subject}}`
- Body must include `{{message}}`. Example:
  ```
  Hi {{to_name}},

  {{message}}

  — Mess Manager Pro
  ```
- Save, then copy this template's **Template ID** too.

### Step 4 — Copy your Public Key
Go to **Account → General**, and copy your **Public Key** (looks like `Ab12Cd34-Ef56`).
This is safe to use in client-side code — it's designed for that.

### Step 5 — Paste all four values into the code
Open `js/app.js`, find this block near the top, and replace the placeholders:

```js
const EMAILJS_PUBLIC_KEY    = 'YOUR_EMAILJS_PUBLIC_KEY';         // from Account → General
const EMAILJS_SERVICE_ID    = 'YOUR_EMAILJS_SERVICE_ID';         // from Email Services
const EMAILJS_TEMPLATE_ID   = 'YOUR_EMAILJS_TEMPLATE_ID';        // Template A (OTP)
const EMAILJS_NOTIFY_TEMPLATE_ID = 'YOUR_EMAILJS_NOTIFY_TEMPLATE_ID'; // Template B (notifications)
```

Save the file. That's it for EmailJS — no npm install, no build step, the SDK is already
loaded via CDN in `index.html`.

> Until these four values are filled in, the app still works — it just skips sending
> emails and shows a toast ("Email sending isn't configured yet…") if someone tries to
> register, so nothing breaks in the meantime.

---

## 2. Deploy the updated Firestore rules

The zip includes an updated `firestore.rules` with new rules for join requests, self-leave,
and the OTP codes collection. If you don't deploy it, those features will fail with
"permission denied" errors even though the code is correct.

**Option A — Firebase CLI (recommended)**
```bash
cd Mess-manager-main
firebase deploy --only firestore:rules
```
(Run `firebase login` first if you haven't, and make sure `firebase use` points at
`mess-manager-pro-e3500`.)

**Option B — Firebase Console (no CLI needed)**
1. Go to https://console.firebase.google.com → your project → **Firestore Database → Rules**.
2. Open `firestore.rules` from the zip in a text editor, select all, copy it.
3. Paste it into the console's rules editor, replacing what's there.
4. Click **Publish**.

---

## 3. Deploy the site itself

Same as before — copy the files up via git/Firebase Hosting:
```bash
firebase deploy --only hosting
```

---

## 4. Test checklist

Once both EmailJS and the rules are deployed:

- [ ] **Register a new account** → you should land on the "Confirm your email" screen and
      receive a 6-digit code within a minute. Enter it → you're in.
- [ ] **Resend code** → tap it, confirm a fresh code arrives (there's a 30-second cooldown
      between resends).
- [ ] **Forgot password** → from the login screen, tap "Forgot password?", enter your
      email, confirm the reset link arrives from Firebase.
- [ ] **Post a notice** → confirm other members (not the poster) receive an email.
- [ ] **Meal-off request** → as a member, request a meal off after the deadline; as the
      manager, approve it; confirm the member gets an email. Try declining one too.
- [ ] **Become-manager request** → as a member, request to become manager; as the current
      manager, approve it; confirm the requester gets an email. Try declining one too.
- [ ] **Join request** → try joining with the invite code from a different account, and
      confirm the manager sees it under "Pending join requests" and can approve/decline.
- [ ] **Leave & switch mess** → from Profile → "Change mess", confirm a member can leave
      and land back on the create/join screen.

---

## Troubleshooting

**"Email sending isn't configured yet" toast** — one or more of the four `EMAILJS_*`
constants in `js/app.js` still has its placeholder value. Double-check step 5 above.

**Emails not arriving at all** — check the connected Gmail's Sent folder to confirm
EmailJS actually sent it (if it's not there, the Service ID/Template ID/Public Key
combination is likely wrong). Also check the recipient's spam folder.

**"Missing or insufficient permissions" errors** — the updated `firestore.rules` hasn't
been deployed yet (see step 2). This is the most common cause of new features silently
failing right after unzipping.

**OTP code says "expired" immediately** — check your Firebase project's default time zone
isn't misconfigured; codes expire 10 minutes after creation using the browser's clock.

**A pre-existing account gets asked to verify on next login** — expected. Accounts created
before this update didn't have the `otpVerified` field, so they're treated as unverified
once and go through the OTP flow the same as new signups.
