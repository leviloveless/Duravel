# Duravel — Project Handoff

_Last updated: July 14, 2026_

This document is the single starting point for anyone picking up Duravel. It covers what the product is, how it's built, what's already working, and — most importantly — what still needs to be done, in priority order.

---

## 1. What Duravel is

Duravel is an AI-driven endurance training-program app. It generates personalized, periodized HYROX training programs, tracks how the athlete actually performs against the plan, and adapts upcoming weeks based on that performance. It is built for a single founder operation and is intended to expand from HYROX into triathlon/Ironman under the same "Duravel" umbrella brand.

The name was chosen to be a coined, low-trademark-conflict brand (replacing the earlier trademark-risky "HyroxAI"). The production domain is **duravel.app**.

---

## 2. Tech stack & architecture

- **Framework:** Next.js 16 (App Router — server components, server actions, route handlers), React 19.
- **Language:** TypeScript in strict mode (`noUnusedLocals`, `noUncheckedIndexedAccess`, etc.). This matters: code that "looks fine" can still fail the build on unused locals or unchecked index access.
- **Database/Auth:** Supabase (Postgres + Auth). Row-Level Security is on for user data (read/write-own policies). A service-role admin client is used server-side for privileged operations (e.g. wearable secrets). The Supabase client is **untyped** (`createServerClient` with no `Database` generic), which is why queries cast results with `as` and inserts accept plain objects.
- **AI:** Anthropic Haiku generates the concrete session content; the deterministic engine owns program structure, volume, and zones. AI output is validated with Zod before use.
- **Billing:** Stripe (web), currently **disabled** via an unset `BILLING_ENABLED` flag. The free tier is a **14-day, no-credit-card trial**, enforced app-side through `profiles.trial_started_at`.
- **Wearables:** Strava (live OAuth + activity sync) and Garmin (scaffold only, pending API approval).
- **Hosting:** Vercel, deploying from the GitHub `main` branch.

### Core domain concept worth internalizing

**Linking a synced workout = writing a `workout_log`.** The adaptation engine already consumes `workout_logs` (for session RPE, ACWR, monotony, readiness). So when a synced Strava/Garmin activity is "linked" to a planned session, the app simply writes a `workout_log` for that session carrying the activity's actuals plus a pointer back to the activity. This means **synced workouts feed the training science with zero engine changes** — a deliberate design choice that keeps the whole sync-linking feature additive.

---

## 3. Where things live

- **Repository (local):** `C:\dev\duravel` — deliberately **outside OneDrive**. The repo was previously inside a OneDrive-synced folder, which caused file reverts and directory-lock errors during git operations. Keep it out of any cloud-sync folder.
- **Remote:** GitHub `main` → auto-deploys to Vercel.
- **Domain:** duravel.app (custom domain configured in Vercel).
- **Local env file:** `.env.local` in the repo root (not committed).
- **Docs/specs:** repo `docs/` folder (e.g. `Duravel_Sync_Linking_Spec.md`). Project planning docs are named with the `Duravel_*` prefix.

---

## 4. What's built and working

Core product (Phase 1 + Phase 2):

- Onboarding + profile capture (experience, benchmarks, HR inputs, day preferences, division, goal finish time).
- AI program generation with a deterministic periodization engine (phases, microcycles, zone distribution, volume reconciliation).
- Full program view: phase timeline, week navigation, per-week session tables (desktop) and stacked day lists (mobile), weekly summary sidebar, calendar dates.
- Personalized HR zones (custom bands → threshold-HR → resting-HR → sex-specific %HRmax) and race pacing plan.
- **Performance logging:** per-session quick logger (status, RPE, optional actuals, note), with frozen-week protection once a week's review has been applied.
- **Adaptation engine + weekly review:** computes signals from logs and proposes/apply revisions to upcoming weeks.
- Readiness check-ins feeding the review.
- Stuck-generation recovery (programs killed mid-generation flip to "failed" with a retry path).
- **Settings hub** (`/settings`) → Profile, Connections, Pricing.
- **Wearables (Phase 1):** Strava OAuth connect + activity sync (live); Garmin OAuth scaffold (not yet functional). Connections managed at `/settings/connections`.

### The sync-linking feature (complete — all five original rules)

This was the most recent body of work. It lets an athlete connect a wearable, see synced workouts, and link each to a planned session so it counts toward training and adaptation. There are **three entry points**, all sharing the same server actions (`linkActivityToSession`, `unlinkActivity` in `app/activity/actions.ts`):

1. **Activity dashboard** (`/activity`, "Activity" nav tab) — lists all synced workouts with Linked/Unlinked state; link/unlink manually via a program → session picker (rules #2.3 manual selection, #2.4 placement on any day). Has a **"Sync now"** button in the header (shown when Strava is connected) that pulls recent Strava activity on demand — via the same `POST /api/wearables/strava/sync` endpoint the Connections panel uses — and refreshes the page so newly imported workouts and their suggestions appear immediately. Shows the last-sync time beneath it.
2. **Same-day suggestions banner** (top of the program view) — surfaces unlinked synced workouts whose calendar date lands on a planned day; confirm the match, with a picker when the day has multiple sessions (rules #2.1, #2.2).
3. **In-view per-session control** (in the week table, next to each session's Log button) — link any unlinked synced workout to any session, or view/unlink the one already attached. This is the most direct path and covers "link directly from the program view."

Plus **move-day logging (rule #5):** when logging a session, a "Day completed" selector lets the athlete record that a session was done on a different day than planned. Choosing a different day triggers a confirmation modal with the exact recovery-awareness copy, and stores `actual_day` while keeping the planned day/session position intact.

**Data model (migration `0017`):** `workout_logs` gained `wearable_activity_id` (FK → `wearable_activities`, unique when non-null so an activity maps to at most one session), `source` (`manual`/`strava`/`garmin`), and `actual_day`.

**Key files:**
- `lib/wearables/link.ts` — pure, unit-tested helpers (session labels, program flattening, date→(week,day) matching, `resolveActualDay`). 16 passing tests in `link.test.ts`.
- `lib/wearables/activities.ts` — `getUserActivities()` (activities + link status).
- `lib/wearables/link-data.ts` — `getLinkableSessions()` for the Activity dashboard picker.
- `lib/wearables/suggest-data.ts` — `getProgramSyncData()` returns suggestions + in-view linking maps from a single activities load.
- `app/activity/{page,actions}.tsx` — dashboard + server actions.
- `components/activity/activity-linker.tsx` — dashboard link control.
- `components/activity/sync-now-button.tsx` — on-demand "Sync now" control on the Activity page.
- `components/program/sync-suggestions.tsx` — suggestions banner.
- `components/program/session-link.tsx` — in-view per-session link control.
- `components/program/log-session.tsx` — logging modal incl. the move-day confirmation.

---

## 5. Environment variables

Set in Vercel (and mirrored in local `.env.local`). Scope matters on Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public, all environments.
- `SUPABASE_SERVICE_ROLE_KEY` — secret; Production + Preview.
- Strava OAuth: client ID/secret (secret; Production + Preview).
- `NEXT_PUBLIC_SITE_URL` — Production only, **no trailing slash** (a trailing slash breaks `${origin}/api/...` redirect URLs). This is baked at build time because it's `NEXT_PUBLIC_`.
- `BILLING_ENABLED` — currently unset (billing off). Flip on for Stripe go-live.
- Stripe keys + webhook secret — to be added at go-live.

---

## 6. Database migrations

Migrations `0001`–`0017` live in `supabase/migrations/`. Highlights: `0001` init (profiles/programs), `0005` workout_logs, `0006` adaptations, `0010` readiness, `0014` subscriptions, `0015` profile trial, `0016` wearables, `0017` workout_log links (the sync-linking columns). **All are already applied to the live database.** No pending migration exists as of this handoff — the recent sync-linking increments all run on `0017`.

---

## 7. Develop, test, and deploy

**Local dev:** clone/pull to `C:\dev\duravel`, `npm install`, ensure `.env.local` is present.

**Testing conventions:**
- Pure logic (anything with no I/O — the engine, `lib/wearables/link.ts`, formatters) is unit-tested with **vitest**. Keep new pure logic in pure modules so it's testable without a browser or DB.
- `next build` is the real gate for anything touching Next.js/Supabase/React types, because the Supabase client is untyped and view components can't be compiled in isolation.

**Deploy workflow (from `C:\dev\duravel`):**
```
npm run build          # local gate — must pass
git add -A
git commit -m "..."
git push               # main → Vercel auto-deploy
```
For DB changes, apply the new numbered migration in Supabase **before** the code that depends on it goes live.

---

## 8. Known hazards & conventions (gotchas)

- **Keep the repo out of OneDrive** (or any sync folder). It caused silent file reverts and git directory-lock failures. Pausing OneDrive was not enough previously — a full relocation fixed it.
- **`session_index` is the true index within a day's `sessions` array, including race slots.** When mapping sessions, don't renumber after skipping races — logs and links key on the real position.
- **Frozen weeks:** once a week's review is applied, its logs are locked. Logging, linking, and unlinking all refuse on frozen weeks (server-enforced). UI hides/greys the controls accordingly.
- **Upsert semantics:** log/link writes upsert on `(program_id, week_number, day, session_index)`. Columns omitted from the payload are preserved on conflict — this is intentional so linking a synced workout doesn't wipe a manual RPE/note.
- **Untyped Supabase client:** expect `as` casts on reads; inserts take plain objects. Don't assume generated types exist.
- **`NEXT_PUBLIC_*` vars bake at build time** — changing them requires a redeploy, not just an env edit.

---

## 9. What's left to do

Ordered roughly by priority / immediacy.

### A. In-flight (do first)
1. **Deploy the in-view linking increment.** The most recently shipped code (per-session link control in the week table, `session-link.tsx` + `week-card.tsx` edits) needs `npm run build` + commit + push to be live. `week-card.tsx` is the one complex file that couldn't be build-verified remotely — watch the build output for it specifically.
2. **End-to-end test the full sync-linking flow** on a real account: connect Strava → sync → link from all three entry points (Activity dashboard, suggestions banner, in-view control) → confirm the linked workout appears as a completed log and flows into the weekly review → test move-day logging and its confirmation copy → test unlink.

### B. Launch / monetization
3. **Stripe go-live.** Create the products/prices (**$19.99/mo**, **$149/yr**), add Stripe keys + webhook secret to Vercel, wire and test the checkout + webhook, flip `BILLING_ENABLED` on, and connect the 14-day trial expiry to the paywall. Verify the trial→paid transition and cancellation paths.
4. **Garmin integration.** Complete Garmin's API/developer approval, then finish the ingest wiring (currently a scaffold in `lib/wearables/garmin*.ts`). Once live, Garmin activities flow through the same sync-linking pipeline as Strava with no further UI work.

### C. Growth / content (from the original 4-gap work plan)
5. **Traction, reviews, and social proof** — testimonials, ratings, results, credibility on the marketing surface.
6. **Brand + community** — the connective tissue around the product (community space, brand presence).
7. **Nutrition module** — guidance/planning to complement training.
8. **Video library** — exercise/technique demos, especially for HYROX stations and lifting movements.

### D. Bigger bets
9. **Native mobile app (Phase 2 mobile).** Blocked on forming the **LLC**, which is needed to register the Apple Developer account (the account exists but isn't registered). Unblock the LLC first, then the App Store path opens.
10. **Triathlon / Ironman program module.** The umbrella-brand rationale for "Duravel" exists specifically to support this. Requires an engine/program-type expansion beyond HYROX and corresponding onboarding/benchmarks (swim/bike/run). This is the main product-diversification bet.

### E. Tech debt / polish (nice-to-have)
- **Suggestions banner "dismiss" is session-local** — a dismissed same-day suggestion reappears on refresh. Consider persisting dismissals if it becomes noisy.
- **Unlink deletes the link-created log.** A purely manual log (no `wearable_activity_id`) is never touched, but if a user manually logged a session and *then* linked a workout onto it, unlinking removes the whole row. Low-frequency edge; revisit only if users hit it.
- **Consider a typed Supabase client** (generated `Database` types) to remove the `as` casts and catch schema drift at compile time.
- **Garmin scaffold cleanup** once the real integration lands.

---

## 10. Quick start for a new session

1. Pull `C:\dev\duravel`, `npm install`, confirm `.env.local`.
2. Read `docs/Duravel_Sync_Linking_Spec.md` for the most recent feature's intent.
3. Make changes in pure modules where possible; add vitest coverage for pure logic.
4. `npm run build` before every push — it's the real gate.
5. Ship: `git add -A && git commit && git push` → Vercel deploys `main`.
6. DB change? Add the next numbered migration and apply it in Supabase before the dependent code goes live.

---

_Contact point for product decisions: Levi Loveless (levi.loveless@alyxconsulting.com)._
