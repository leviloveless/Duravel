# Duravel Handoff — 07-28-26 9:11pm (updated 07-29-26 2:05pm)

Continues the 2:21pm handoff. All items SHIPPED + deployed READY.

## 1. Compromised running (SHIPPED)
Commit `8015ac4`, pushed, Vercel READY (`dpl_7JMfyQvK83qrPed7Woxho4zJjXWf`). Long
runs are plain aerobic long runs; compromised running is trained + explained only
on hybrid/HYROX sessions. `compromisedLong`/`RunSlot.compromised` fully removed.
See [[duravel-compromised-running]].

## 2. Profile separated from Settings + change email/password (SHIPPED)
Commit `0ebdb93`, pushed, Vercel READY (`dpl_C9TubmgjDiRFqUqXw4FA3iqKCpRQ`).
- `/profile` is its own top-nav item (`components/nav-bar.tsx`); removed from the
  Settings hub. Settings now lists Connections, Email preferences, Billing.
- Profile gained an **Account & security** section (`app/profile/account-security.tsx`):
  sign-in email + inline **Change email** / **Change password**.
- `app/account/actions.ts`: `changeEmail` → `updateUser({ email }, { emailRedirectTo:
  .../auth/confirm?next=/profile })` (`/auth/confirm` verifies any OTP type, so
  `email_change` works with NO route change); `changePassword` → `updateUser({ password })`.
- **⚠️ Change-email depends on Supabase config:** "Change Email Address" template must be
  enabled; with "Secure email change" ON (default), the user confirms from BOTH old and
  new inboxes. Password change is instant. → still worth an end-to-end test.

## 3. Unlimited-testing account (PARTIAL — prod action still needed from Levi)
- Unlimited generation gated by env `GENERATION_UNLIMITED_EMAILS` (comma list;
  `app/api/generate/route.ts` gives listed emails a 1,000,000 cap).
- **Added `levi.loveless@duravel.app` in `.env.local`** — but `.env.local` is git-ignored /
  LOCAL DEV ONLY, does NOT reach production.
- **TODO (Levi, in Vercel):** set `GENERATION_UNLIMITED_EMAILS` (Production) to
  `levi.loveless@alyxconsulting.com,levi.loveless@duravel.app`, then redeploy.
- `ADMIN_EMAILS` (separate `/admin` gate) is only in Vercel prod; value not visible here.
  No MCP connector can edit Vercel env — dashboard / Claude-in-Chrome / CLI only.

## 4. Interval + threshold runs — brief pace-aware how-to (SHIPPED)
Three commits, all pushed + Vercel live:
- `e2a1da5` — interval/threshold made per-level (beginner/intermediate/advanced) with
  work:rest ratios (interval 1:1, threshold 2:1), per the metsperformance article.
- `f49cb85` — FIX: the program week view (`WeekCard` → `SessionDetail`) rendered only a
  run's distance, never `session.description`, so run how-tos never showed on the program
  page (only `session-card.tsx` rendered them, and it is unused there). Now renders run +
  hybrid descriptions.
- `31ddcf8` — reworked interval/threshold to a BRIEF, literal how-to built from the
  athlete's VDOT paces (Levi wanted the wordy prose gone). Example:
    Warm up: 1 mile easy (10-15 min) with 3-4 short strides
    Work: 5 x 1km at 7:49/mi (4:51/km) with 4:50 easy jog/rest between reps
    Cooldown: 1 mile easy
    Work:rest 1:1 - your rest equals your work time.
  Reps show pace in min/mi AND min/km; rest is COMPUTED from pace (interval 1:1 = the 1km
  work time; threshold 2:1 = half the 1-mile work time), rounded to 5s; no-benchmarks
  fallback = "equal-time / half-rep-time" wording. `paces` threaded through
  `describeSessions`; multi-line render via `whitespace-pre-line` (WeekCard + SessionCard).
  The long "why" narrative moved to the program glossary (new "Interval and threshold
  work:rest ratios" term). Per-level reps: interval 4/5/6 × 1km; threshold 2/3/4 × 1 mile.
  687 tests pass, tsc clean. See [[duravel-interval-threshold-ratios]].

  ⚠️ Descriptions are baked into a program at generation time — EXISTING programs (e.g.
  `bc3ccbdd…`) keep their old stored text; REGENERATE to get the brief pace-aware format.
  New programs get it automatically.

## 5. Save HYROX results to profile + pre-fill on new programs (SHIPPED)
Commit `906f368`, pushed, Vercel live. Cloud-verified: 687 tests pass, tsc clean.
- Diagnosis: onboarding already SAVED HYROX splits to `profiles.benchmarks`, but new
  programs pre-filled benchmark fields from `initial` (the edit path) only, never the saved
  profile — so athletes re-looked-up their result every time.
- Profile page: new **HYROX results** section (`app/profile/hyrox-results.tsx`) — view saved
  splits, look up an official result (reuses `HyroxLookup`) to auto-fill, edit, and save. New
  action `saveHyroxResults` (`app/profile/actions.ts`) MERGES the hyrox* fields + race type
  into `profiles.benchmarks` (preserves 5K/strength); uses `.update()` on an existing row
  (guards: "save profile details first" if no row).
- Onboarding (`app/onboarding/onboarding-form.tsx`): new `benchDefault(name)` falls back to
  `profile.benchmarks` on a NEW program (`initial` still wins when editing a program); ALL
  benchmark + HYROX-split fields now pre-fill, still fully editable.

## Open items
- Levi: set Vercel prod `GENERATION_UNLIMITED_EMAILS` (+ optionally `ADMIN_EMAILS`) and redeploy.
- REGENERATE any existing program to pick up the brief pace-aware interval/threshold
  descriptions (old programs keep their stored text).
- End-to-end test the change-email flow once the Supabase "Change Email Address" template
  is confirmed.
- Live-test the HYROX save + prefill: save a result on /profile, then start a new program and
  confirm the splits pre-fill.
- `vitest.config.ts` has an uncommitted local env-block change (pre-existing; the cloud
  verify adds it temporarily, never commits it — needed for `admin.test.ts`).
