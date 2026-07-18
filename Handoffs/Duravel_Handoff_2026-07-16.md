# Duravel — Project Handoff

_Last updated: July 16, 2026 (**Rev 2026-07-16**). Supersedes Rev 2026-07-15c._
_This rev adds: the DekaFit funnel going fully LIVE (the `/deka` pacing estimator rebuilt on real race data, the new hybrid/coach print card, DEKA-branched auto-email), the **email-delivery migration to Resend** (Workspace couldn't deliver externally — now resolved end-to-end), SPF/DKIM/DMARC on the root domain, a submit-hang hardening fix, the secured social handles + Instagram launch kit, and the business-bank-account plan. Several §2/§3/§5/§6 items changed — re-read them._

This is the single starting point for anyone (a person or a new Cowork session) picking up Duravel. Read this first, then follow the pointers below.

---

## 0. START HERE

### If you are a NEW COWORK SESSION picking this up, do this in order:
1. **Read project memory first.** `project_memory_read` (no args) → read `MEMORY.md`, then the topic files — especially `duravel-positioning`, `duravel-dekafit-capture`, `duravel-accounts-and-email`, `duravel-llc-formation`, `duravel-repo-git-ops`, and `duravel-build-timeline`.
2. **Read §6 ("How work gets done here")** before touching anything — billing and email are both LIVE now.
3. **Then lead Levi one action at a time** (see §3). Confirm before anything irreversible (a live-DB migration, a git commit, a prod deploy, an Apps Script redeploy, a Stripe change).

### If you are Levi:
Jump to **§3 — What to do next**. Short version: the DekaFit funnel is **live and verified**; what's left is **physical/optional** — **print the tool card (the real Jul 25 deadline)**, launch **Instagram**, and open the **business bank account** this week. Then the HYROX-to-full dev block (`10`/`07`/`04`), then triathlon.

---

## 1. What Duravel is

An AI-driven endurance training app, single-founder (Levi). It generates personalized, periodized **HYROX** programs, tracks performance vs. plan, and adapts upcoming weeks from that. Brand is deliberately sport-agnostic — a **hybrid-athlete platform** (HYROX + DEKA FIT + other hybrid comps today; **triathlon** is the flagship expansion, which Levi will race next year for self-validation). Production domain: **duravel.app**.

**Positioning (locked this session — use everywhere; see `duravel-positioning` memory):** the quality and experience of a **personal coach** who builds a program personalized to you and **adapts it over time** based on your performance — for a **small fraction of a coach's price.** Not "just an AI app." Hybrid-athlete framing on all materials.

---

## 2. Current state (2026-07-16) — what's true now

### Business / legal
- **Duravel LLC** — Texas single-member LLC (Northwest Registered Agent), **EIN acquired** (CP_575_G.pdf, sensitive, out of git). Bootstrapped. Tax: stay disregarded-entity for now; revisit S-corp near ~$50k durable annual net profit. No BOI/CTA report (exempt). First TX Public Information Report due **May 15, 2027**.
- **Business bank account = the immediate LLC-downstream step** (see §3.C + `Duravel_Bank_Account_Setup.md`). Open it as soon as the stamped Certificate of Formation is in hand — billing is live, so this closes the commingling gap.

### Accounts / infrastructure
- **Primary email `levi.loveless@duravel.app`** everywhere (except Claude Console/claude.ai, stuck on the alyx address). Use duravel.app for every new account.
- **Social handles secured (2026-07-16):** Instagram **@duravel.app** · X **@DuravelApp** · TikTok **@Duravel42** · Threads **@Duravel.App**. Asset footers use @duravel.app.
- **GitHub repo + Supabase project both "Duravel."** Remote `https://github.com/leviloveless/Duravel.git`. Local repo `C:\dev\duravel`. Domain + DNS at **Vercel** (do NOT transfer).
- **Email sending = Resend (LIVE, 2026-07-16).** Transactional mail sends via **Resend on `send.duravel.app`** (domain verified). See §2 "Email" below. Root `duravel.app` also now has **SPF + DKIM + DMARC** for the Workspace mailbox.

### Product / code
- **Billing is LIVE** (since 2026-07-14): **$19.99/mo · $149/yr**, 14-day no-card trial. Stripe webhook is the sole entitlement writer. `BILLING_ENABLED=true`.
- **Sync-linking (Strava → training) complete + E2E-verified.** Garmin still a scaffold pending API approval.
- **DekaFit funnel is LIVE (this session):**
  - **`/deka` pacing estimator** (`public/deka.html`) — DEKA FIT = 10 zones each preceded by a 500m run (5km). Inputs: division + **5 tiers** + optional fresh-500m pace + optional goal → per-run splits (fatigue curve), per-zone budgets, cumulative splits, HYROX crossover, email capture. **Tiers are data-driven:** total finish = real finish-time percentiles of the **2025 DEKA FIT Austin Adult (Sat) field (448 finishers, by gender)** — First-timer 75th / Intermediate 50th / Competitive 25th / Elite 5th; **World-record** = actual WR (M 28:28 Schadegg / W 31:51 Weeks). The **run-vs-zone split** of each total is *modeled* from elite zone benchmarks (that results list only exposes finish time; per-athlete split data wasn't cleanly extractable — see §7 to refine).
  - **Backend** = Google Sheets Apps Script (`marketing/apps-script/pace-capture.gs`), same `/exec` URL. Stores leads in the "Duravel — Pace Leads" sheet AND sends the auto-email **via Resend** (`sendViaResend()` → `UrlFetchApp` to `api.resend.com/emails`; key in **Apps Script Script Properties** `RESEND_API_KEY`, never in git). Branches by `source`: `/^deka/i` → DEKA email (links `/deka`), else HYROX guide. From `hello@send.duravel.app`, reply-to `levi.loveless@duravel.app`.
  - **Submit hardened:** no-cors + `keepalive` + 9s fail-safe so an Apps Script cold start can't freeze the button. On both `/deka` and `/pace`.
  - **Verified end-to-end 2026-07-16:** live `/deka` signup → row lands (`guide_sent=yes`) → email delivers to Gmail (Promotions tab — normal/fine for a lead-magnet email; not spam).
- **HYROX `/pace` guide page** stays live as the free product for **future HYROX races** (SLC/Boston/Dallas).
- **Engine:** `lib/engine` (~5,080 LOC / 21 modules), zero DB/env coupling, `ProgramType` seam — sport abstraction ~80% done; triathlon is architecturally supported (long pole = domain content, not plumbing).

### Email — how it works now (important)
- **Why Resend:** Google Workspace (MailApp) could not deliver externally from the brand-new domain — Yahoo/RocketMail hard-bounced, Gmail filtered/spam-foldered (confirmed via Admin Email Log Search; a manual send from the mailbox also failed externally). SPF/DKIM/DMARC are correct — the issue was sending *reputation*, and a Workspace mailbox is the wrong tool for programmatic mail.
- **Resolution:** all Duravel transactional/lead mail goes through **Resend** on `send.duravel.app`. `guide_sent` in the Leads sheet = `yes` on a 2xx from Resend, `error:CODE` on an HTTP failure, `error` on an exception. First sends from a cold domain may land in Promotions/spam for a send or two, then settle.
- **Later (spec `07`/`12`):** the in-app lifecycle + acquisition-nurture emails build on this same Resend + `send.duravel.app` foundation.

---

## 3. What to do next — the plan

### A. DekaFit (Jul 25) — the only hard remaining task is PHYSICAL: print the card
The funnel is live. **Print lead time is the constraint.** Take **`marketing/Duravel_QR_Card_DekaFit_Tool.pdf`** to a local shop (FedEx Office/Staples, same/next-day is safer than online given the window). Print **one** test card, scan it to confirm it opens `duravel.app/deka?src=dekafit`, then order the batch. (Do NOT print the older `Duravel_QR_Card_DekaFit.pdf` / `qr/Duravel_QR_dekafit.png` — those point at the retired `/pace` version and are superseded.)

### B. Instagram launch (kit ready)
Execute **`Duravel_Instagram_Launch_Kit.md`** (Business plan folder): two-account system (**@duravel.app** brand + Levi's personal fitness account), light ~3-posts/week cadence, and a ready-to-post 3-week calendar with captions anchored to DekaFit. Set up both bios, post the launch + founder-intro pieces, and let the personal account carry authenticity.

### C. Business bank account + Stripe reroute (this week)
Per **`Duravel_Bank_Account_Setup.md`**: open a **business checking** account (recommended: **Mercury**, or **Relay** for expense buckets) once the stamped Certificate is in hand — use a **real TX address**, not the registered-agent address. Then immediately **repoint Stripe payouts** to it and **update Stripe's entity** (legal name Duravel LLC + EIN). Downstream: **D-U-N-S** (gates Apple) → Garmin developer app.

### D. HYROX → credible full (next dev block, ~late Aug target)
Per `docs/future-phases/00-ROADMAP.md`, Wave 1, in order: **`10` Typed Supabase** → **`07` Trial-ending / lifecycle emails** (now unblocked — Resend is live; reuse `sendViaResend` pattern / the `send.duravel.app` domain) → **`04` Social proof** on pricing.

### E. Triathlon (flagship expansion)
Start only after HYROX conversion is proven. Finish `ProgramType` abstraction → 3-sport periodization → content/generation → logging/zones. Thin MVP (sprint+olympic) then full (→70.3, adaptive). Dates in §4.

### The real constraint (unchanged)
Building is cheap at Levi's velocity; **distribution and retention are scarce.** Win HYROX/DEKA conversion before spreading across sports. Instagram + race activations are the current top-of-funnel bets.

---

## 4. Build timeline (recalibrated, unchanged from 15c)

| Milestone | Effort (Levi's hrs) | Target |
|---|---|---|
| HYROX thin MVP | done | **Live now** |
| DekaFit funnel (/deka + card + email) | done | **Live now (2026-07-16)** |
| HYROX credible full (`10`/`07`/`04`) | ~25–35 | **~late Aug 2026** |
| Triathlon thin MVP (sprint+olympic) | ~45–55 | **~mid-Sep 2026** |
| Triathlon full MVP (→70.3, adaptive) | ~+55–65 | **~late Oct 2026** |

Does NOT compress: email reputation warm-up (wall-clock), the TX move + race activations overlapping the high-capacity window, and **build-complete ≠ validated ≠ converting.**

---

## 5. Where everything lives

- **Repo (local):** `C:\dev\duravel` (outside OneDrive). Remote GitHub `main` (`leviloveless/Duravel`) → auto-deploys to Vercel.
- **DekaFit / marketing:** `public/deka.html` (estimator), `public/pace.html` (HYROX capture), `public/hyrox-pacing-guide.pdf`, `next.config.ts` (`/deka` + `/pace` rewrites), `marketing/apps-script/pace-capture.gs` (Sheets + Resend backend), `marketing/qr/Duravel_QR_deka.png`, `marketing/Duravel_QR_Card_DekaFit_Tool.pdf` (print card).
- **Business-plan deliverables:** `…/Training Program App/Business plan/` — `Duravel_LLC_Formation_Plan.md`, `Duravel_Budget_and_Expense_Tracker.xlsx`, `Duravel_Build_Timeline.html`, `Duravel_Instagram_Launch_Kit.md`, `Duravel_Bank_Account_Setup.md`, this handoff, plus `CP_575_G.pdf` (EIN — sensitive).
- **Future-phases specs + roadmap:** `docs/future-phases/` (`README`, `00`–`13`).
- **Migrations:** `supabase/migrations/` (through **`0019`**). Local + prod share one Supabase project.
- **Leads:** Google Sheet "Duravel — Pace Leads." **Resend** dashboard for email logs/deliverability.
- **Project memory:** `project_memory_read`.

---

## 6. How work gets done here (read before touching anything)

- **Billing AND email are LIVE.** Never touch Stripe, the DB, prod env, the Apps Script deployment, or Resend casually — mistakes charge/un-entitle real customers or break lead delivery.
- **Levi runs his own git.** Do NOT run git write/refresh via `device_bash` on `C:\dev\duravel` (the sandbox can't delete `index.lock` → corrupt reads). Author files via `device_bash` (fine); hand Levi a **scoped** `git add <files>` + commit + push. Reading/grepping via `device_bash` is fine.
- **Apps Script changes:** author the `.gs` on disk, have Levi paste it into the editor and **Deploy → Manage deployments → Edit → New version** (keeps the same `/exec` URL). Secrets (Resend key) live in **Script Properties**, never in code/git. Adding a new scope (e.g. `UrlFetchApp`) requires Levi to **re-authorize** (run a function once and approve).
- **`next build` is the real gate.** Type-check with `tsc --noEmit`. Stop `npm run dev` before `npm run build`.
- **Migrations** are applied by Levi in the Supabase SQL editor; treat as irreversible (local+prod share one DB); apply before deploying dependent code.
- **Secrets:** never enter/store API keys, Stripe secret, webhook secrets, or the Resend key. Tell Levi where each goes; he pastes them.
- **Output locations:** business/plan deliverables → *Business plan* folder; code → `C:\dev\duravel`. Keep `CP_575_G.pdf` + `_phase3_draft/` out of git.
- **Line endings:** committed `.gitattributes` normalizes to LF; working tree is clean (the old "everything modified" quirk is gone).

---

## 7. Open loose ends (not blocking)

- **Print the DekaFit card** — the one time-critical item before Jul 25 (§3.A).
- **`/deka` run-vs-zone split is modeled**, not empirical (finish totals ARE real). To make it data-driven, sample ~40 athletes' detail pages across the percentile range and measure actual run/zone ratios — offered, not yet done. Constants live in the `deka.html` CONFIG block.
- **Email placement:** first Resend sends may hit Gmail Promotions/spam on a cold domain; mark "Not spam," reputation builds with volume. Consider leaner (less-HTML) email if Primary-tab placement matters later.
- **Tri calendar-day reset is UTC** (migration 0019) — add `profiles.timezone` for per-user local midnight.
- **Two minor sync-linking polish nits** (see `duravel-sync-linking-e2e`).
- **`_phase3_draft/`** superseded (specs 12/13) — gitignore or delete. A `.gitignore` for `CP_575_G.pdf` + `_phase3_draft/` was offered, not yet created.
- **Save this handoff to the repo/Business plan folder** — the device bridge was offline when it was drafted; it was delivered in-chat and should be written to disk (and update the `MEMORY.md` "new session" banner to point at Rev 2026-07-16) when the desktop reconnects.

---

## 8. Strategic conclusions (advisory — context, not commitments)

- **Growth/churn:** fitness monthly churn ~10–13% median (your 6% is optimistic); plan ~10–12% early → ~7–8%. Annual plans churn ~½ as fast.
- **Annual mix:** expect ~30% of new payers annual (if annual is the lead offer), drifting to ~45–50% of the active base.
- **Inference COGS:** realistic ~$1–1.5/user/mo, within ~70% GM. Rate-limit caps (gen 2/7d, adapt 1/calendar-day) are the wall against power-user blowouts.
- **Traction realism:** 435 paying at 24mo ≈ ~$10k MRR — a top-quartile *indie* outcome, not a base case. Distribution is the bottleneck; founder-led social (your named moat) is the cheapest lever.
- **Multi-sport:** the coherent path is a **hybrid-athlete platform** (HYROX + DEKA + triathlon + running/strength as concurrent training), sequenced — not parallel single-sport products. Cut standalone bodybuilding.

---

## 9. Notes
- Contact / product decisions: Levi Loveless (**levi.loveless@duravel.app**).
- Everything in `docs/future-phases/` is a **proposal for Levi to review**, not a committed decision.
- Repo/folder/infra were historically "hyroxai"; now GitHub + Supabase = **"Duravel,"** local folder `C:\dev\duravel`, all user-facing strings "Duravel."
