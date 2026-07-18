# Duravel — DekaFit Go-Live Checklist

**Race:** DekaFit, Saturday **July 25, 2026** · **Today:** July 15 (T−10) · **Goal:** `duravel.app/pace` live and capturing DekaFit-tagged leads, cards printed and scanned before race day.

The single hard constraint is **print lead time** — the page can go live in an hour, but physical cards take days. Lock the page, test it, then order prints immediately.

---

## Already done for you (sitting in your working tree, UNCOMMITTED)

- `public/pace.html` — the lead-capture page (Privacy link pointed at `/privacy`).
- `public/hyrox-pacing-guide.pdf` — the lead magnet, hosted so the autoresponder can link it at `https://duravel.app/hyrox-pacing-guide.pdf`.
- `next.config.ts` — added a `/pace` → `/pace.html` rewrite so the clean URL works. (Typecheck passes.)
- **QR verified:** `marketing/qr/Duravel_QR_dekafit.png` decodes to exactly `https://duravel.app/pace?src=dekafit`. Print-ready.

These won't deploy until you commit + push (step 4).

---

## Your steps, in order

### 1 — Pick the form backend (5 min) · DECISION
The page POSTs `{first_name, email, source, consent, captured_at}`.
- **Formspree free = 50 submissions/month.** Fine if you expect < 50 DekaFit signups.
- Expecting more? Upgrade Formspree for the race month (~$10–20, cancel after), or use the **unlimited free Google Sheet** route — *ask me and I'll write the exact Apps Script.*

Create the form, copy its endpoint (looks like `https://formspree.io/f/abc1234x`).

### 2 — Fill two values in `public/pace.html`
- **`FORM_ENDPOINT`** (near top of `<script>`): replace `https://formspree.io/f/YOUR_FORM_ID` with your endpoint. (The amber "not connected" note auto-hides once this is set.)
- **Mailing address** (footer): replace `[Your business mailing address]` with your **Northwest registered-agent address** — CAN-SPAM requires a real physical postal address in the footer.

### 3 — Wire the pacing-guide delivery
- **Best:** set a Formspree **autoresponse** that links the guide at `https://duravel.app/hyrox-pacing-guide.pdf`, so every signup gets it automatically.
- **Fallback (fine for DekaFit):** export the signup list after the race and send the guide in one batch — just don't wait days.

### 4 — Build + ship (your terminal)
```
cd C:\dev\duravel
npm run build
git add public/pace.html public/hyrox-pacing-guide.pdf next.config.ts
git commit -m "DekaFit lead-capture page at /pace"
git push
```
`npm run build` should say "Compiled successfully." The push auto-deploys on Vercel.

### 5 — Test on your PHONE before printing (critical)
- Open `https://duravel.app/pace?src=dekafit` on your phone — the badge should read **RACING DEKAFIT**.
- Submit a real test with your own email → you see the success state, the lead lands in Formspree with `source: dekafit`, and you receive the guide.
- Confirm the footer address is filled and the **Privacy** link works.

### 6 — Print the cards · START NOW (this is the deadline)
- Art to print: the DekaFit card in `marketing/Duravel_Race_QR_Cards_AllRaces.html` (print-to-PDF the DekaFit card), or drop the raw `marketing/qr/Duravel_QR_dekafit.png` into your own card layout.
- **Print one test card, scan it with your phone (step 5), THEN order the batch.**
- Timing: online printers (VistaPrint, etc.) run **3–7 business days + shipping** → order by ~Jul 17–18. A **local shop** (FedEx Office / Staples) is same-/next-day and safer given the 10-day window.

---

## Timeline (T-minus)

- **T−10 · Jul 15 (today):** hosting done. Decide backend, fill the two values, deploy, phone-test.
- **T−8/9 · Jul 16–17:** after the test-scan passes, order the card prints.
- **T−2/1 · Jul 23–24:** cards in hand; re-test the live URL on your phone one more time.
- **Race day · Jul 25:** QR → `/pace`, 60-second live demos at the setup, leads captured as `src=dekafit`.

## After the race
Keep the list. When Phase 3 (the real `/pace` tool + Resend flow) ships, import the opted-in DekaFit leads into `email_subscribers` with `source='dekafit'` so they enter the lifecycle sequence, then retire this stopgap page.

---

**One reminder:** the three hosting files are uncommitted — nothing is live until you run step 4.
