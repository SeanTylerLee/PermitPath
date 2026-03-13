# Backend: Send release-notify signups to team@permitpathnav.com

The index page has a "Notify me when Permit Path releases" form that POSTs to your same `/api/contact` with:

```json
{ "type": "release_notify", "email": "user@example.com" }
```

To have those emails go to **team@permitpathnav.com** (instead of your main contact inbox), update your backend `api/contact.js` in the **SeanTylerLee** repo as follows.

---

### 1. Add a constant for the release-notify recipient

Near the top with your other constants, add:

```js
const TO_EMAIL_RELEASE = "team@permitpathnav.com";
```

---

### 2. At the start of your handler, handle `type === "release_notify"`

Right after you handle OPTIONS and set CORS, and before you check `req.method !== "POST"`, add this block:

```js
// Release-notify signup: send only to team@permitpathnav.com
if (req.body && req.body.type === "release_notify" && req.body.email) {
  const email = String(req.body.email).trim();
  if (!email) return res.status(400).json({ error: "Missing email" });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: TO_EMAIL_RELEASE,
      subject: "Permit Path release notification signup",
      text: `New signup for release notification:\n\nEmail: ${email}`,
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Resend error (release_notify):", error);
    return res.status(500).json({ error: "Failed to send" });
  }
}
```

---

### 3. Keep the rest of your handler as-is

Your existing contact form logic (name, email, message → TO_EMAIL) stays the same. Commit, let Vercel redeploy, and the index release-notify form will then send to **team@permitpathnav.com**.
