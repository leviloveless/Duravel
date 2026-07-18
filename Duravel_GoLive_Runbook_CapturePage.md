# Duravel — Go-Live Runbook: DekaFit Capture Page

_Created: July 14, 2026 · Est. time: ~30–45 min · Prereq: `Duravel_Pace_Capture_Landing.html` (in `marketing/`)_

Goal: get `duravel.app/pace` live and collecting emails before DekaFit (Jul 25), with leads tagged by `?src=`.

---

## Part A — Connect the form backend (~10 min)

The page POSTs JSON `{first_name, email, source, consent, captured_at}` with `Accept: application/json`. Any of these work; pick one, create a form, copy its endpoint URL.

**⚠️ Volume caveat — read first.** Formspree's free tier is **50 submissions/month per form**. At a race you may beat that. Options:
- **Expecting < 50 DekaFit signups:** Formspree free is fine.
- **Expecting more (or want headroom):** upgrade Formspree for the race month (~$10–20/mo, cancel after), or use **Basin** / **Getform** (similar, check their current free caps), or the **unlimited-free Google Sheet** route in Part A-alt.

**Formspree (fastest path):**
1. Sign up at formspree.io → **New Form**.
2. Set the notification email to yours; name it "Duravel – Pace Capture (DekaFit)".
3. Copy the form endpoint — looks like `https://formspree.io/f/abc1234x`.
4. Open `Duravel_Pace_Capture_Landing.html`, find the line near the top of `<script>`:
   `var FORM_ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID";`
   Replace the URL with yours. Save.
5. Formspree's first real submission triggers a one-time email-confirmation click — do a test submit and confirm.

**A-alt — Unlimited free via Google Sheet (if you expect high volume):**
1. Create a Google Sheet → Extensions → Apps Script.
2. Paste a `doPost(e)` that appends `e.postData` fields to the sheet and returns `{result:"ok"}`; Deploy → Web app → access "Anyone".
3. Use the resulting `/exec` URL as `FORM_ENDPOINT`. (Ask me and I'll write the exact Apps Script.)

---

## Part B — Fill the two placeholders (~3 min)

In `Duravel_Pace_Capture_Landing.html`:
- Footer: replace `[Your business mailing address]` with a real address (registered agent or PO box is fine — CAN-SPAM).
- Optional: point the `Privacy` link at a privacy page (even a simple one).

The amber "not connected yet" setup note auto-hides once `FORM_ENDPOINT` no longer contains `YOUR_FORM_ID`, so once Part A is done it disappears.

---

## Part C — Host it at duravel.app/pace (~15 min)

You already deploy on Vercel, so the cleanest path keeps it on your domain. Three options, easiest first:

**Option 1 — Add it to your existing Next.js app (recommended, keeps one domain/deploy):**
1. Drop the file into the repo as `public/pace.html` (Next serves `public/` statically), **or** create `app/pace/page.tsx` that returns the markup.
   - Fastest: `public/pace.html` → served at `duravel.app/pace.html`. To get the clean `/pace` URL, add a rewrite in `next.config.ts`: `{ source: '/pace', destination: '/pace.html' }`.
2. Commit + push → Vercel auto-deploys. Done — it's on `duravel.app/pace`.

**Option 2 — Netlify Drop (zero-config, separate URL):**
1. Go to app.netlify.com/drop, drag the HTML file in.
2. You get a `*.netlify.app` URL instantly; optionally map a subdomain.
   - Downside: not on `duravel.app`, so your QR (`duravel.app/pace?src=…`) wouldn't resolve unless you point DNS. Prefer Option 1.

**Option 3 — Cloudflare Pages:** similar to Netlify; direct-upload the file.

> **Because the QR cards encode `duravel.app/pace?src=…`, Option 1 is strongly preferred** — the QR only works if that exact URL serves this page.

---

## Part D — Test before you print/hand out (~5 min)

1. Visit `duravel.app/pace?src=dekafit` on your **phone** (it's mobile-first; test where people will actually scan).
2. Confirm the badge reads **RACING DEKAFIT**.
3. Submit a real test with your own email → you should see the "You're on the list" success state **and** get the lead in Formspree/your sheet with `source: dekafit`.
4. Scan the actual **printed** DekaFit QR card with your phone camera → it should open the same page. (Print one test card first.)
5. Check the footer address is filled and the unsubscribe/privacy link isn't broken.

---

## Part E — Deliver the promise (important)

The page promises a "HYROX pacing guide." You have it: **`Duravel_HYROX_Pacing_Guide.pdf`** (in `marketing/`).
- **Formspree:** set up an autoresponse/confirmation email that attaches or links the guide PDF (host the PDF at e.g. `duravel.app/hyrox-pacing-guide.pdf` via `public/`), so every signup gets it automatically.
- **Manual fallback (fine for DekaFit):** export the signup list after the race and send the guide in one batch from your normal email — just don't wait days.

---

## After DekaFit
Keep the list. When Phase 3 (the real `/pace` tool + Resend flow) ships, import these opted-in DekaFit leads into `email_subscribers` with `source='dekafit'` so they flow into the lifecycle sequence. Then retire this stopgap page.
