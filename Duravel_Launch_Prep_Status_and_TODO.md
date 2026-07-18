# Duravel — Launch Prep: Status & To-Do

_Prepared July 14, 2026 while you were away. Everything below is done unless marked otherwise._

---

## What's ready now (delivered + committed to `C:\dev\duravel`)

**Marketing assets** (`marketing/`)
- `Duravel_HYROX_Pacing_Guide.pdf` — the 2-page lead magnet your capture page promises. Accurate to official 25/26 HYROX loads. Ends on the trial CTA.
- `Duravel_Pace_Capture_Landing.html` — the DekaFit stopgap capture page (mobile-first, `?src=` tagging, form-backend hook).
- `Duravel_Race_QR_Cards_AllRaces.html` — 4 print-ready per-race cards.
- `qr/Duravel_QR_{dekafit,slc,bos,dal}.png` — standalone tagged QR codes.
- `Duravel_Email_Templates.html` — the 7 rendered lifecycle emails.

**Docs** (repo root)
- `Duravel_Pace_Page_Copy.md` — full `/pace` page copy deck.
- `Duravel_Phase3_Lifecycle_Email_Build_Plan.md` — the M13 engineering plan.
- `Duravel_GoLive_Runbook_CapturePage.md` — host the page + connect the form (this doc's Part A–E).
- `Duravel_Resend_Deliverability_Runbook.md` — Resend + `send.duravel.app` DNS + warm-up.
- `Duravel_Launch_Calendar_and_Revenue_Model.xlsx` — races woven in + Race Activation + email sequence tabs.

**Code scaffold** (`_phase3_draft/`, review drafts — not wired in)
- `lib/email/schedule.ts` + `schedule.test.ts` — **complete, sandbox-verified (vitest 4/4).**
- `lib/email/races.ts`, `supabase/migrations/0018_email_subscribers.sql` — complete.
- `resend.ts`, `templates.ts`, `send.ts`, `app/pace/actions.ts`, cron + unsubscribe routes — skeletons with wiring TODOs.
- `README.md` — per-file status + how to place them.

---

## Blanks only you can fill

1. **Business mailing address** — required in the capture-page footer and every email (CAN-SPAM). One value, used everywhere.
2. **A real ambassador name + quote** — placeholder in nurture email #2. Don't invent one; use a real early user or your own result.
3. **Brand colors / logo** — everything uses a clean placeholder identity (ink + orange). Fine to ship as-is for DekaFit; swap when finalized.

## Decisions outstanding

- **Resend vs Loops** for the email flow (recommendation: Resend — rationale in the plan doc).
- **Form backend** for the stopgap (Formspree is fastest; note the 50/mo free cap — see runbook).
- **Pacing-calculator math** (roadmap #6): ship with the real `/pace` page in August, or a simpler v1 first?
- **Vercel plan** — sub-daily cron (needed for race-week/post-race timing) requires a paid plan.

---

## Your to-do list (sequenced)

### ⚠️ Before DekaFit (Jul 25 — ~11 days)
1. Pick a form backend and paste its URL into `FORM_ENDPOINT` in the capture page (Runbook Part A).
2. Fill the mailing address in the capture page footer (Part B).
3. Host the page at `duravel.app/pace` (Part C — Option 1 keeps it on your domain so the QR works).
4. Test on your phone via `?src=dekafit` and scan a printed test card (Part D).
5. Set the page to auto-send the pacing guide PDF, or plan to batch-send it after (Part E).
6. Print the DekaFit cards (rush/local print given the timeline).

### Foundation (next 2–3 weeks)
7. Add `send.duravel.app` to Resend and set the DNS records — **start now for warm-up** (Deliverability Runbook).
8. Confirm Resend vs Loops.
9. Review + approve the 7 emails and the `/pace` copy; get the ambassador quote.

### August — Phase 3 build (M13)
10. `npm i resend`; apply migration `0018`; move `_phase3_draft` files into place and wire the DB TODOs (README has the checklist).
11. Build the real `/pace` calculator + capture; paste the email HTML into `templates.ts`.
12. Wire the cron + race triggers; `npm run test` + `next build` before deploy.

### September — pre-SLC gate
13. Full pre-flight + mail-tester ≥ 9/10 + inbox-placement check.
14. Print SLC / Boston / Dallas cards with proper lead time.
15. Everything bulletproof before **Sep 19 (HYROX Salt Lake City)**.

---

## Assumptions I made (flag if wrong)
- Free-tool URL path is `duravel.app/pace`; QR codes and copy all assume it.
- Pacing-guide station-time budgets are estimates (labeled as such in the guide) — calibrate against a real time-trial.
- Nurture cadence +2/+5/+8/+14 days; race emails at −3d / +1d.
- The stopgap page promises a "pacing guide," not live calculated splits (the calculator isn't built yet) — the PDF fulfills that promise.
