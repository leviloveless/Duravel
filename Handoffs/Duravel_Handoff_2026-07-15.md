# Duravel — Project Handoff

_Last updated: July 15, 2026 (**Rev 2026-07-15c**). Supersedes Rev 2026-07-15b._
_This rev adds: LLC formed + EIN, email/account migration to duravel.app, GitHub/Supabase renamed, git line-endings normalized, the generation/adaptation rate-limit change (migration 0019, deployed), the DekaFit capture-page wiring + Google-Sheets backend (uncommitted), and a recalibrated build timeline. Several §6 conventions changed — re-read it._

This is the single starting point for anyone (a person or a new Cowork session) picking up Duravel. Read this first, then follow the pointers below.

---

## 0. START HERE

### If you are a NEW COWORK SESSION picking this up, do this in order:
1. **Read project memory first.** `project_memory_read` (no args) → read `MEMORY.md`, then the topic files — especially `duravel-llc-formation`, `duravel-accounts-and-email`, `duravel-repo-git-ops`, `duravel-dekafit-capture`, `duravel-rate-limits`, `duravel-build-timeline`, and `duravel-billing-golive`.
2. **Read the roadmap** in `docs/future-phases/` — `README.md`, then `00-ROADMAP.md`, then specs `01`–`13` as relevant.
3. **Read §6 of this doc ("How work gets done here")** before touching anything — the conventions changed this session.
4. **Then lead Levi one action at a time** (see §3–§4). Confirm before anything irreversible (a live-DB migration, a git commit, a prod deploy).

### If you are Levi:
Jump to **§3 — What to do next**. Short version: **DekaFit (Jul 25) is imminent — deploy the capture page and print cards first.** Then the HYROX-to-full block (`10` typed-Supabase, `07` trial-ending emails, `04` social proof), then triathlon. Build dates are in §4.

---

## 1. What Duravel is

An AI-driven endurance training app, single-founder (Levi). It generates personalized, periodized **HYROX** programs, tracks performance vs. plan, and adapts upcoming weeks from that. The brand is deliberately sport-agnostic; the flagship expansion is **triathlon** (Levi is near-expert in tri programming and will race it next year — self-validation). Production domain: **duravel.app**.

---

## 2. Current state (2026-07-15) — what's true now

### Business / legal
- **LLC formed.** **Duravel LLC**, a **Texas single-member LLC**, filed via **Northwest Registered Agent** (also the registered agent). SOS name check clear; USPTO TESS knockout on "Duravel" clear. **EIN acquired** through the IRS portal (confirmation `CP_575_G.pdf` in the Business plan folder — sensitive, keep out of git). Bootstrapped, no VC.
- **Tax election:** stay **default disregarded entity** for now. Revisit S-corp when durable annual net profit approaches **~$50k** (breakeven analysis in the budget workbook). No BOI/CTA report required (domestic-entity exemption). First TX Public Information Report due **May 15, 2027** (no tax due, but filing is mandatory).
- **Deliverables:** `Duravel_LLC_Formation_Plan.md`, `Duravel_Budget_and_Expense_Tracker.xlsx` (Business plan folder).

### Accounts / infrastructure
- **Primary email is now `levi.loveless@duravel.app`** (new Google Workspace on duravel.app; migrated off the alyxconsulting address). Switched on Supabase, Vercel, GitHub, Stripe, Northwest, + added to Anthropic Console. **Exception:** Claude Console / claude.ai stays on `levi.loveless@alyxconsulting.com` (platform won't allow changing it). **Going forward, use `levi.loveless@duravel.app` for every new account.**
- **GitHub repo and Supabase project both renamed to "Duravel."** Git remote updated to `https://github.com/leviloveless/Duravel.git`. Local repo still at `C:\dev\duravel`.
- **Domain stays at Vercel** (do NOT transfer to Northwest). Branded mailbox on Google Workspace; product/transactional email via Resend on a `send.duravel.app` subdomain (per spec `07`).
- **Line endings normalized:** a committed `.gitattributes` (`* text=auto eol=lf`) fixed the old CRLF drift. **The working tree is now clean — the "everything shows as modified" quirk is GONE.** (Old handoff guidance to preserve CRLF is obsolete — see §6.)

### Product / code
- **Billing is LIVE** (since 2026-07-14): **$19.99/mo · $149/yr**, 14-day no-card trial (`profiles.trial_started_at`). Stripe webhook is the sole entitlement writer. `BILLING_ENABLED=true` on prod. (Note: the revenue model uses illustrative $25/$159.60; live prices are $19.99/$149.)
- **Sync-linking (Strava → training) complete + E2E-verified.** Garmin still a scaffold pending API approval.
- **Rate-limit change shipped this session (committed, pushed, migration applied — LIVE):**
  - Program generation: **2 per rolling 7 days** (`app/api/generate/route.ts`).
  - Weekly adaptation: **1 per CALENDAR day** (`app/api/adapt/apply/route.ts`), enforced by migration **`0019_calendar_day_rate_limit.sql`** (adds a `p_calendar_day` flag to `claim_generation_slot`; resets at 00:00 **UTC** — no per-user tz yet).
  - `components/program/adapt-review.tsx` now shows a confirmation popup before applying ("adapt once per calendar day"). Dismiss stays free/unlimited.
  - `tsc --noEmit` clean. **Migration 0019 already applied in Supabase; code pushed.**
- **Engine audit finding (grounds the tri estimate):** `lib/engine` (~5,080 LOC / 21 modules) has **zero DB/env coupling** and a `ProgramType` enum/seam already — the sport abstraction is ~80% done; triathlon is architecturally supported. The long pole for tri is domain correctness + content, not plumbing.

### In-flight (started this session, NOT finished)
- **DekaFit lead-capture page — wired but UNCOMMITTED in the working tree.** `public/pace.html` (page, Privacy → `/privacy`), `public/hyrox-pacing-guide.pdf`, a `/pace → /pace.html` rewrite in `next.config.ts`, and the Google-Sheets backend (`marketing/apps-script/pace-capture.gs`; the page is wired for it with a `text/plain` + `no-cors` POST). QR verified: `marketing/qr/Duravel_QR_dekafit.png` decodes to `https://duravel.app/pace?src=dekafit`. **Nothing is live until Levi commits + pushes.** See `Duravel_DekaFit_GoLive_Checklist.md` and `Duravel_Sheets_Backend_Setup.md`.
- **Annual-mix sensitivity model** built (10/30/50% scenarios; monthly vs annual cohorts, annual churn ×0.5, upfront cash) — verified, ready to send if wanted.

---

## 3. What to do next — the plan

### A. DekaFit (Jul 25) — TIME-SENSITIVE, do first
Print lead time is the constraint. From `Duravel_DekaFit_GoLive_Checklist.md`:
1. Deploy the Google-Sheets backend (`Duravel_Sheets_Backend_Setup.md`) — create the Sheet, paste the Apps Script, **Deploy → Web app, Execute as Me, Access = Anyone**, copy the `/exec` URL.
2. Fill two values in `public/pace.html`: `FORM_ENDPOINT` (the `/exec` URL) and the CAN-SPAM mailing address (Northwest registered-agent address).
3. `npm run build` → commit `public/pace.html`, `public/hyrox-pacing-guide.pdf`, `next.config.ts` → push (Vercel auto-deploys).
4. Phone-test `https://duravel.app/pace?src=dekafit` (confirm the row actually lands in the Sheet — success is shown optimistically).
5. **Print the QR cards now** (local shop, same/next-day, is safer than online given the window).

### B. HYROX → credible full (the next dev block, ~late Aug target)
Per `docs/future-phases/00-ROADMAP.md`, Wave 1, in order:
1. **`10` Typed Supabase** — remove untyped casts, protect the live entitlement writer; de-risks future migrations.
2. **`07` Trial-ending emails** — highest-ROI conversion lever; finishes `_phase3_draft`; needs Resend domain warm-up (wall-clock ~1–2 wks) + the LLC postal address in the footer.
3. **`04` Social proof** on the pricing page.

### C. Triathlon (the flagship expansion)
Start only after HYROX conversion is proven. Sequence: finish `ProgramType` abstraction → tri periodization (3-sport) → content/generation → logging/zones. Thin MVP (sprint+olympic) then extend to full (→70.3, adaptive). Dates in §4.

### D. LLC downstream (as the state approval lands)
Open the **business bank account** (needs the stamped Certificate + EIN) → **move Stripe onto the LLC entity** (update legal name/EIN/bank) → start **D-U-N-S** (gates Apple) and the **Garmin developer application**. Move Duravel business accounts onto the `duravel.app` email.

### E. The real constraint (don't lose sight of it)
Building is cheap at Levi's velocity; **distribution and retention are the scarce resources.** The honest traction question — can Duravel reach ~65 paying by month 6 and ~435 by month 24 — runs on a user-acquisition clock that shipping faster does not move. Win HYROX conversion before spreading across sports.

---

## 4. Build timeline (recalibrated + 25% buffer)

Anchored to Levi's actual velocity (**entire product so far ≈ 50 hrs / 10 days**, AI-leveraged). Capacity: 30–40 hrs/wk for ~5 weeks, then 15 hrs/wk. Build-complete targets (with a 25% schedule buffer):

| Milestone | Effort (Levi's hrs) | Target |
|---|---|---|
| HYROX thin MVP | done | **Live now** |
| HYROX credible full (`10`/`07`/`04`) | ~25–35 | **~late Aug 2026** |
| Triathlon thin MVP (sprint+olympic) | ~45–55 | **~mid-Sep 2026** |
| Triathlon full MVP (→70.3, adaptive) | ~+55–65 | **~late Oct 2026** |

Does NOT compress: email deliverability warm-up (wall-clock); the TX move + DekaFit/SLC overlapping the high-capacity window; and **build-complete ≠ validated ≠ converting**. Visual: `Duravel_Build_Timeline.html` (Business plan folder + the "duravel-build-timeline" desktop artifact).

---

## 5. Where everything lives

- **Repo (local):** `C:\dev\duravel` (outside OneDrive). Remote: GitHub `main` (`leviloveless/Duravel`) → auto-deploys to Vercel.
- **Future-phases specs + roadmap:** `docs/future-phases/` (`README`, `00`–`13`).
- **Business-plan deliverables (this session):** `C:\Users\Levi Loveless\OneDrive\Documents\Claude\Projects\Training Program App\Business plan\` — `Duravel_LLC_Formation_Plan.md`, `Duravel_Budget_and_Expense_Tracker.xlsx`, `Duravel_Email_Transition_Checklist.md`, `Duravel_Build_Timeline.html`, this handoff, plus `CP_575_G.pdf` (EIN — sensitive).
- **DekaFit / marketing:** `marketing/` (QR cards + PNGs, pacing-guide PDF, capture-page source, `apps-script/pace-capture.gs`), repo root (`Duravel_DekaFit_GoLive_Checklist.md`, `Duravel_Sheets_Backend_Setup.md`, `Duravel_GoLive_Runbook_CapturePage.md`, `Duravel_Resend_Deliverability_Runbook.md`, `Duravel_Pace_Page_Copy.md`).
- **Migrations:** `supabase/migrations/` (through **`0019`**). Local + prod share one Supabase project.
- **Desktop artifact:** "duravel-build-timeline" (the timeline visual).
- **Project memory:** `project_memory_read`.

---

## 6. How work gets done here (read before touching anything — CHANGED this session)

- **Billing is LIVE.** Never touch Stripe, production env, or the DB casually or unattended — mistakes charge/un-entitle real customers.
- **Levi runs his own git — and now MUST, more than before.** Do **not** run git through `device_bash` on `C:\dev\duravel`: the cloud sandbox can't delete files, so git can't clean up its own `index.lock`, leaving stale locks that corrupt reads. Author code in the working tree (writing files via `device_bash` is fine); hand Levi a **scoped** `git add <specific files>` + commit + push. Reading/grepping via `device_bash` is fine.
- **Line endings are now handled.** A committed `.gitattributes` normalizes to LF; the working tree is clean. Do **not** re-apply the old "preserve CRLF" workaround — it's obsolete.
- **`next build` is the real gate** (untyped Supabase client → view components only fail at build). Type-check edits with `tsc --noEmit` on the device (`node_modules/.bin/tsc` present). Stop `npm run dev` before `npm run build`.
- **Migrations are applied by Levi in the Supabase SQL editor.** Write the numbered `.sql`, then give Levi the SQL to run. Local + prod share one DB → treat as irreversible; confirm first. (Deploy ordering: apply a migration **before** deploying code that depends on it.)
- **Secrets:** never enter/store API keys, the Stripe secret, or webhook secrets. Tell Levi where each goes; he pastes them. The Stripe MCP connector is LIVE mode.
- **Output locations:** save **Duravel business/plan deliverables** to the *Business plan* folder; save **code** to `C:\dev\duravel`. Keep `CP_575_G.pdf` (EIN) and `_phase3_draft/` out of git.

---

## 7. Open loose ends (not blocking)

- **DekaFit page is uncommitted** — deploy per §3.A before Jul 25.
- **Tri calendar-day reset is UTC** — to reset at the user's local midnight, add `profiles.timezone` and use `date_trunc('day', now() at time zone tz)` (comment in migration 0019).
- **Two minor sync-linking polish nits** (see `duravel-sync-linking-e2e` memory): "Imported 1 activities" plural; in-view unlink not clearing the "Synced" badge until reload.
- **`_phase3_draft/`** excluded from build, superseded by `07`/`12`; gitignore or delete.
- **A `.gitignore`** for `CP_575_G.pdf` + `_phase3_draft/` was offered but not yet created.

---

## 8. Strategic conclusions from this session (advisory — for context, not commitments)

- **Growth/churn:** fitness monthly churn benchmarks ~10–13% median (your model's 6% is optimistic); plan ~10–12% early improving to ~7–8%. Annual plans churn ~½ as fast.
- **Annual mix:** expect ~30% of new payers annual (if annual is the lead offer), drifting to ~45–50% of the active base — your model's 10% is too low.
- **Inference COGS:** realistic ~$1–1.5/user/mo (recalcs dominate; program creation is per-block, not per-week), well within a ~70% GM. The rate-limit caps are the wall against power-user cost blowouts.
- **Traction realism:** 435 paying at 24 mo ≈ ~$10k MRR — a top-quartile *indie* outcome, not a base case; most consumer fitness apps never reach it. Comps: Runna ~90k+ members but with £8M + ~150 staff; RoxFit ~150k *users* (mostly free) in 12 mo with £800k + 2 founders. Paying counts are undisclosed and far smaller than headline "users."
- **Multi-sport:** the coherent path is a **hybrid-athlete platform** (HYROX + triathlon + running-as-a-component + strength *as concurrent training*), sequenced — not five parallel single-sport products. **Cut standalone bodybuilding** (most saturated category, wrong user). Triathlon improves economics (longer arcs, higher WTP); mass strength would drag them.

---

## 9. Notes
- Contact / product decisions: Levi Loveless (**levi.loveless@duravel.app**).
- Everything in `docs/future-phases/` is a **proposal for Levi to review**, not a committed decision.
- Repo/folder/infra were historically named "hyroxai"; GitHub + Supabase are now **"Duravel"**, local folder is `C:\dev\duravel`, and all user-facing strings are "Duravel."
