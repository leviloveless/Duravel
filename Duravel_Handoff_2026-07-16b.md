# Duravel — Project Handoff

_Last updated: July 16, 2026 (**Rev 2026-07-16b**). Supersedes Rev 2026-07-16._
_This rev adds: the **auth email + password story fully live** (signup confirmation now sends from Duravel via Resend SMTP and no longer shows a false error; a **forgot-password flow** was built and verified; on-brand HTML for all three auth emails), the **landing hero rewrite**, the **Instagram graphics** (launch carousel + DekaFit-week set, saved to disk), the **"age-grouper" → "amateur" brand rule** (age-grouper is now Ironman/triathlon-only), the **Typed-Supabase (spec 10) tooling scaffold**, the **Mercury business-account** progress, and a **critical operational lesson: the device bridge to `C:\dev\duravel` does not write through in cloud sessions** (see §6). Re-read §2, §3, §6, §7._

This is the single starting point for anyone (a person or a new Cowork session) picking up Duravel. Read this first, then follow the pointers below.

---

## 0. START HERE

### If you are a NEW COWORK SESSION picking this up, do this in order:
1. **Read project memory first.** `project_memory_read` (no args) → read `MEMORY.md`, then the topic files — especially `duravel-positioning`, `duravel-accounts-and-email`, `duravel-auth-email-confirm`, `duravel-marketing-and-spec10`, `duravel-device-bridge-write-failure`, `duravel-mercury-postapproval-checklist`, and `duravel-llc-formation`.
2. **Read §6 ("How work gets done here")** before touching anything — billing and email are LIVE, and **repo edits via the device bridge do NOT reach the user's Windows git** (do them on-computer or hand Levi native Git Bash commands).
3. **Then lead Levi one action at a time** (see §3). Confirm before anything irreversible (a live-DB migration, a git push, a prod deploy, an Apps Script redeploy, a Stripe change).

### If you are Levi:
Jump to **§3 — What to do next.** Short version: the DekaFit funnel, billing, email, and auth are all live and working. What's left is **physical/optional** — **print the tool card (Jul 25 deadline)**, **launch Instagram** (all graphics are built and saved), and **open the Mercury business bank account** (waiting on your physical-address doc). Then the Typed-Supabase cleanup and the HYROX-to-full dev block, then triathlon.

---

## 1. What Duravel is

An AI-driven endurance training app, single-founder (Levi). It generates personalized, periodized **HYROX** programs, tracks performance vs. plan, and adapts upcoming weeks from that. Brand is deliberately sport-agnostic — a **hybrid-athlete platform** (HYROX + DEKA FIT + other hybrid comps today; **triathlon/Ironman** is the flagship expansion, which Levi will race next year for self-validation). Production domain: **duravel.app**.

**Positioning (locked; use everywhere; see `duravel-positioning` memory):** the quality and experience of a **personal coach** who builds a program personalized to you and **adapts it over time** based on your performance — for a **small fraction of a coach's price.** Not "just an AI app." Hybrid-athlete framing on all materials.

**Landing hero copy (updated this session, live in `app/page.tsx`):**
> Coach-level training programs for hybrid and endurance athletes — personalized to you, adaptive to your performance, and periodized to peak you for race day. For a fraction of a coach's price.

**Brand-voice rule (new this session):** "**age-grouper**" language is **Ironman/triathlon-only**. For HYROX / DEKA / general materials, use "**amateur**" (e.g. founder line "I'm an amateur. Not a pro."). This was applied across the repo and business docs this session.

---

## 2. Current state (2026-07-16b) — what's true now

### Business / legal
- **Duravel LLC** — Texas single-member LLC (Northwest Registered Agent), **EIN acquired** (CP_575_G.pdf, sensitive, now gitignored). Bootstrapped. Tax: disregarded-entity for now; revisit S-corp near ~$50k durable annual net profit. No BOI/CTA report (exempt). First TX Public Information Report due **May 15, 2027**.
- **Mercury business bank account — in progress.** Application nearly complete; **only blocker is a document confirming a physical US address** (Levi is mid-relocation). A **business description** was drafted this session (SaaS subscription, Stripe-processed; NAICS 511210). Post-approval action chain is held in memory (`duravel-mercury-postapproval-checklist`) — do NOT surface unprompted; fire it when the account is approved.

### Accounts / infrastructure
- **Primary email `levi.loveless@duravel.app`** everywhere (except Claude Console/claude.ai, stuck on the alyx address).
- **Social handles secured:** Instagram **@duravel.app** · X **@DuravelApp** · TikTok **@Duravel42** · Threads **@Duravel.App**. IG bios/titles/links drafted this session (see `Duravel_Instagram_Launch_Kit.md` + chat).
- **GitHub repo + Supabase project both "Duravel."** Remote `https://github.com/leviloveless/Duravel.git`. Local repo `C:\dev\duravel`. Domain + DNS at **Vercel** (do NOT transfer).
- **Email sending = Resend (LIVE).** Transactional/lead mail sends via **Resend on `send.duravel.app`** (verified). **Supabase Auth also now uses Resend custom SMTP** (see Auth below).

### Product / code
- **Billing is LIVE** (since 2026-07-14): **$19.99/mo · $149/yr**, 14-day no-card trial. Stripe webhook is the sole entitlement writer. `BILLING_ENABLED=true`.
- **Auth (updated + verified this session):**
  - **Signup email confirmation now works correctly and sends from Duravel.** Root cause of the old "confirmation error but it still logs me in" bug: Supabase's default `{{ .ConfirmationURL }}` template verified on Supabase's side and redirected to `/auth/confirm` without a `token_hash`, so the route always hit the error path. Fixed by (a) hardening `app/auth/confirm/route.ts` to handle `token_hash`+`type`, PKCE `?code=`, and already-authenticated cases, and (b) switching the Supabase "Confirm signup" template to the token-hash link + enabling **custom SMTP via Resend** so the sender is Duravel. Full detail: `duravel-auth-email-confirm` memory.
  - **Forgot-password flow built + verified working** (`/forgot-password` → email → `/auth/confirm?type=recovery` → `/account/update-password`). Files: `app/login/actions.ts` (`requestPasswordReset`, `updatePassword`), `app/login/login-form.tsx` ("Forgot password?" link), `app/forgot-password/*`, `app/account/update-password/*`.
  - **On-brand HTML for all three auth emails** (Confirm signup, Magic Link, Reset Password) pasted into Supabase. **Magic Link is inert** — no `signInWithOtp` sign-in is wired in the app yet (deferred by Levi).
- **DekaFit funnel is LIVE:** `/deka` pacing estimator (`public/deka.html`), Google Sheets + Resend backend (`marketing/apps-script/pace-capture.gs`, now sends via `sendViaResend`). The print card `marketing/Duravel_QR_Card_DekaFit_Tool.pdf` was **verified print-ready this session** (QR → `duravel.app/deka?src=dekafit`, correct branding/date).
- **HYROX `/pace` guide page** stays live as the free product for future HYROX races (SLC/Boston/Dallas).
- **Sync-linking (Strava → training) complete + E2E-verified.** Garmin still a scaffold pending API approval.
- **Engine:** `lib/engine` (~5,080 LOC / 21 modules), zero DB/env coupling, `ProgramType` seam — sport abstraction ~80% done; triathlon architecturally supported.

### Instagram graphics (new this session — all saved to disk)
- **Location:** `…\Training Program App\Business plan\Marketing\Instagram Graphics\` (OneDrive, cloud-synced). Also delivered in chat.
- **Launch carousel** (7 × 1080×1080): hook → the gap → personalized → adaptive (orange hero) → hybrid → price → CTA, for kit post ①. Plus the editable HTML template.
- **DekaFit-week set** (12): post ③ free-tool drop (5 slides), post ④ "3 runs that decide your DEKA time" (6), post ② founder-intro cover (1, "I'm an amateur. Not a pro.").
- Design system: orange `#FF591F`, near-black `#0D1116`, paper `#F5F2EC`; Inter + Montserrat; orange-dot DURAVEL wordmark. Story (1080×1920) versions **offered, not yet built.**

---

## 3. What to do next — the plan

### A. DekaFit (Jul 25) — the only hard remaining task is PHYSICAL: print the card
The card is verified print-ready. Take **`marketing/Duravel_QR_Card_DekaFit_Tool.pdf`** to a local shop (FedEx Office/Staples), print **one** test card, scan it to confirm it opens `duravel.app/deka?src=dekafit`, then order the batch. It's a **two-sided 6×4** card — print double-sided, flip on the long edge.

### B. Instagram launch — all assets are built
Set the **@duravel.app** bio/Name field/links and the personal-account bio (drafted in chat + `Duravel_Instagram_Launch_Kit.md`), create the 5 Highlights, then post the launch carousel (post ①) and the DekaFit-week graphics (③/④, +② founder cover). Captions are in the kit. Want more reach → ask for the **Story (1080×1920) versions with tappable link stickers** (offered, not built). Note: feed-image "buttons" aren't clickable — the real link is the bio link + Story link stickers + DMs.

### C. Mercury business account + Stripe reroute (this week)
Once the physical-address document is in hand, finish the Mercury application (use a real TX address, not the registered-agent address). On approval, fire the held checklist (`duravel-mercury-postapproval-checklist`): fund → debit card → **repoint Stripe payouts** → **update Stripe entity** (Duravel LLC + EIN) → move recurring expenses → then **D-U-N-S** (gates Apple) → Garmin dev app.

### D. Typed Supabase (spec 10) — run ON HIS COMPUTER
Tooling is scaffolded (`gen:types` npm script + `types/README.md`, committed). It's an M-effort/multi-day migration. First step needs Levi: `npx supabase login` + `npx supabase link --project-ref <ref>`, then `npm run gen:types`. Then wire `createServerClient<Database>` + the service-role admin client, add `types/db.ts` + `types/db-overrides.ts`, and remove `as` casts module-by-module (billing → engine persistence → adaptation reads → wearables → rest). **Do this on-computer** (bridge write issue, §6). Plan: `docs/future-phases/10-typed-supabase.md`.

### E. HYROX → credible full (next dev block)
Per `docs/future-phases/00-ROADMAP.md`: **`07` Trial-ending / lifecycle emails** (unblocked — Resend live; reuse `sendViaResend` / `send.duravel.app`) → **`04` Social proof** on pricing. (`10` Typed Supabase is the prerequisite tech-debt item in D.)

### F. Triathlon / Ironman (flagship expansion)
Start after HYROX conversion is proven. Finish `ProgramType` abstraction → 3-sport periodization → content/generation → logging/zones. This is the ONE area where "age-grouper" language belongs.

### The real constraint (unchanged)
Building is cheap at Levi's velocity; **distribution and retention are scarce.** Win HYROX/DEKA conversion before spreading across sports. Instagram + race activations are the current top-of-funnel bets.

---

## 4. Build timeline (unchanged)

| Milestone | Effort (Levi's hrs) | Target |
|---|---|---|
| HYROX thin MVP | done | **Live now** |
| DekaFit funnel (/deka + card + email) | done | **Live now** |
| Auth email + forgot-password | done | **Live now (2026-07-16)** |
| HYROX credible full (`10`/`07`/`04`) | ~25–35 | **~late Aug 2026** |
| Triathlon thin MVP (sprint+olympic) | ~45–55 | **~mid-Sep 2026** |
| Triathlon full MVP (→70.3, adaptive) | ~+55–65 | **~late Oct 2026** |

---

## 5. Where everything lives

- **Repo (local):** `C:\dev\duravel` (outside OneDrive). Remote GitHub `main` (`leviloveless/Duravel`) → auto-deploys to Vercel. **Latest push: commit `08b3fbb`** (age-grouper→amateur, gen:types scaffold, gitignore, Resend `pace-capture.gs`).
- **Auth:** `app/auth/confirm/route.ts`, `app/login/*`, `app/forgot-password/*`, `app/account/update-password/*`. Supabase dashboard holds SMTP + email templates (NOT the repo).
- **DekaFit / marketing:** `public/deka.html`, `public/pace.html`, `marketing/apps-script/pace-capture.gs`, `marketing/Duravel_QR_Card_DekaFit_Tool.pdf` (print card).
- **Instagram graphics:** `…\Training Program App\Business plan\Marketing\Instagram Graphics\` (20 files).
- **Business-plan deliverables:** `…\Training Program App\Business plan\` — `Duravel_LLC_Formation_Plan.md`, `Duravel_Budget_and_Expense_Tracker.xlsx`, `Duravel_Instagram_Launch_Kit.md`, `Duravel_Bank_Account_Setup.md`, this handoff, `CP_575_G.pdf` (EIN — sensitive, gitignored in the repo copy).
- **Future-phases specs + roadmap:** `docs/future-phases/` (`README`, `00`–`19`).
- **Migrations:** `supabase/migrations/` (local + prod share one Supabase project).
- **Leads:** Google Sheet "Duravel — Pace Leads." **Resend** dashboard for email logs.
- **Project memory:** `project_memory_read`.

---

## 6. How work gets done here (read before touching anything)

- **⚠️ The device bridge does NOT reliably write to `C:\dev\duravel` in cloud sessions.** Confirmed 2026-07-16: both `device_bash` in-place edits and `device_commit_files` failed to reach the user's Windows git (the mount orphaned files into `.fuse_hidden*` placeholders; `git status` showed nothing). **Reading/grepping the mount is fine; writing is not.** For repo edits: either hand Levi exact **native Git Bash** commands (NOT `cmd` — `rm`/`perl`/`grep` fail there; and note pasting a big multi-line block into Git Bash/MinTTY mangles it, so feed commands ONE LINE AT A TIME), **or run the Cowork task on his computer** (desktop app → "Run this task" → On your computer), where edits hit real files directly. Details: `duravel-device-bridge-write-failure` memory. (Note: `device_commit_files` to the OneDrive **Business plan** folder DOES work — that's how the graphics were saved.)
- **Billing AND email AND auth are LIVE.** Never touch Stripe, the DB, prod env, the Apps Script deployment, Resend, or Supabase auth settings casually — mistakes charge/un-entitle real customers or break sign-in/lead delivery.
- **Levi runs his own git.** Hand him **scoped** `git add <files>` + commit + push. `next build` is the real gate (`tsc --noEmit` to type-check; stop `npm run dev` first).
- **Supabase auth email** (SMTP + templates) is configured in the **dashboard**, not the repo. The recovery/confirm links must route through `/auth/confirm` with the token-hash pattern.
- **Apps Script changes:** author the `.gs`, have Levi paste it and Deploy → Manage deployments → Edit → New version. Secrets (Resend key) live in Script Properties.
- **Migrations** are applied by Levi in the Supabase SQL editor; treat as irreversible.
- **Secrets:** never enter/store API keys, Stripe secret, webhook secrets, or the Resend key. Tell Levi where each goes.

---

## 7. Open loose ends

- **Print the DekaFit card** — the one time-critical item before Jul 25 (§3.A).
- **Instagram Story (1080×1920) versions** — offered, not built.
- **Verify the Instagram Launch Kit doc** (`Business plan/Duravel_Instagram_Launch_Kit.md`) actually shows "amateur" — its age-grouper edit went through the flaky bridge and may not have taken. Re-hand if needed.
- **Typed Supabase (spec 10)** — scaffolded, not migrated; run on-computer (§3.D).
- **Magic Link** sign-in — template ready but no `signInWithOtp` wired (deferred).
- **`/deka` run-vs-zone split is modeled**, not empirical (finish totals ARE real). To make data-driven, sample ~40 athletes' detail pages across the percentile range.
- **`_phase3_draft/`** superseded and now gitignored (still on disk; delete at leisure). It still contains one stray "age-group" string (ignore — it's excluded from git).

---

## 8. Strategic conclusions (advisory — context, not commitments)

- **Growth/churn:** fitness monthly churn ~10–13% median; plan ~10–12% early → ~7–8%. Annual plans churn ~½ as fast.
- **Annual mix:** expect ~30% of new payers annual (if annual is the lead offer), drifting to ~45–50% of the active base.
- **Inference COGS:** realistic ~$1–1.5/user/mo, within ~70% GM. Rate-limit caps are the wall against power-user blowouts.
- **Traction realism:** 435 paying at 24mo ≈ ~$10k MRR — a top-quartile *indie* outcome, not a base case. Distribution is the bottleneck; founder-led social (the named moat) is the cheapest lever.
- **Multi-sport:** the coherent path is a **hybrid-athlete platform** (HYROX + DEKA + triathlon + running/strength), sequenced — not parallel single-sport products.

---

## 9. Notes
- Contact / product decisions: Levi Loveless (**levi.loveless@duravel.app**).
- Everything in `docs/future-phases/` is a **proposal for Levi to review**, not a committed decision.
- Repo/folder/infra were historically "hyroxai"; now GitHub + Supabase = **"Duravel,"** local folder `C:\dev\duravel`, all user-facing strings "Duravel."
- **"age-grouper" = Ironman/triathlon-only; "amateur" everywhere else.**
