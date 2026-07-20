# Duravel — Session Handoff

**Saved:** 2026-07-20 (Mon) 11:26am ET · **Session type:** Go-live wiring — lifecycle email + growth-loop result cards
**Continues:** `Duravel_Handoff_07-20-26_7.10am.md` (Tasks.md batch + standalone Ironman engine). This handoff covers everything shipped after that: lifecycle-email go-live, `profiles.email`, and the result-card growth loop (increments 1 + 2).

---

## 1. Headline

Three things shipped and are **live in production**, all pushed to `main`:
1. **Lifecycle email is go-live** — Resend/Svix webhook, one-click unsubscribe, preference center, and the welcome / onboarding-nudge / receipt flows. `EMAIL_ENABLED=true` is set in prod and a real welcome email was verified delivered end-to-end.
2. **`profiles.email`** — auth email is now mirrored onto the `profiles` row (migration + trigger + onboarding upsert), so every profile carries the email it was created with.
3. **Growth-loop result cards** — an in-app result-card studio, plus a one-tap **Share** that auto-prefills a card straight from any logged workout. First shippable piece of the growth loop.

DMARC was also published (p=none monitoring) during email go-live.

---

## 2. What shipped (commits on `main`, pushed = YES)

- **`d3d3654`** — lifecycle-email go-live wiring.
- **`51b272a`** — CI fix (dropped unused `weekMinutesByKind` in `triathlon.test.ts`; a `tsc` no-unused error, not a runtime bug).
- **`e4734c6`** — mirror auth email onto `profiles.email`.
- **`d7215b6`** — result-card studio (growth loop), increment 1.
- **`e0084d0`** — auto-prefill a session result-card from a logged workout, increment 2.

### Lifecycle email (`d3d3654`)
- **Send choke point** stays `sendEmail()`; gate order: flag → recipient → suppression → unsub → category → freq-cap → CLAIM → late-entitlement → render → send → ledger. `emailEnabled()` = `env.EMAIL_ENABLED === "true" && !!RESEND_API_KEY` (value must be lowercase `true`).
- **`lib/email/svix.ts`** — dependency-free Svix signature verify. **`lib/email/webhook-status.ts`** — `eventToStatus` + advance-forward-only `nextStatus`.
- **Routes:** `app/api/webhooks/resend/route.ts` (verifies + advances `email_sends` status), `app/api/email/unsubscribe/route.ts` (GET branded page + POST RFC-8058 one-click).
- **Preference center:** `app/settings/email/{page.tsx,actions.ts}`.
- **Flows:** `lib/email/flows/{welcome,onboarding-nudge,due}.ts`. Welcome fires from `app/auth/confirm/route.ts` via non-blocking `after()`; onboarding nudge added to `app/api/cron/lifecycle/route.ts`; Stripe receipt on `invoice.payment_succeeded` (failure-isolated) + `canceled_at` stamp in `app/api/stripe/webhook/route.ts`.
- **Verified live:** new signup → welcome `delivered`; webhook advanced the row's status. (Welcome first landed in Gmail *Promotions*, which is expected/fine for a transactional-but-marketingish welcome.)

### profiles.email (`e4734c6`)
- **`supabase/migrations/0028_profiles_email.sql`** — adds `email` column, backfills from `auth.users`, and installs a `sync_profile_email()` trigger on `auth.users` (after insert/update of email).
- **`app/onboarding/actions.ts`** — `profileUpsertRow(userId, input, email)` now writes `email`; both call sites pass `user.email ?? null`.

### Result cards — increment 1 (`d7215b6`)
- **`components/program/result-card.tsx`** — presentational, forwardRef, 4 card types (race / session / PR / program) × story/square; scoped `rc-` styles; brand dark `#0a0e14` + lime `#c6ff3d`.
- **`result-card-studio.tsx`** — modal with type/format toggles, editable fields, live scaled preview, **Download PNG** via dynamically-imported `html2canvas`.
- **`result-card-launcher.tsx`** — client trigger + modal open-state.
- Wired into the `program-view.tsx` header seeded with a **program-done** card (program name + completed/total sessions + athlete first name). `page.tsx` threads `athleteName` from the profile; `package.json` adds `html2canvas`.

### Result cards — increment 2 (`e0084d0`)
- **`components/program/session-card-data.ts`** (new) — `sessionCardFromLog(session, log, athlete)` maps a completed `Session` + `WorkoutLog` into a `"session"` card seed. Headline from the plan (run dist@pace, lift patterns, hybrid station count, swim/bike type, brick, cardio); stats from **logged actuals** (distance / duration / avg HR) with a **planned fallback** when an actual wasn't entered; coach note from the log note or a default. Fully editable in the studio afterward.
- **`result-card-launcher.tsx`** — added optional `label` (default "Result card") + `className` for a compact inline **Share** variant.
- **`week-card.tsx`** — threads `athleteName`; renders a **Share** launcher on every completed session in **both** the mobile day list and the desktop table.
- **`program-view.tsx`** — passes `athleteName` through to each `WeekCard`.

---

## 3. Verification

- **Increment 2 type-checked in the cloud** (win32 node_modules can't run tooling in the Linux bridge, so the source was snapshotted + `npm install` + `tsc --noEmit` in the cloud container): **`tsc --noEmit` exit 0, clean.** tsconfig has `strict` + `noUnusedLocals` + `noUnusedParameters` — which is exactly the class of error that broke CI earlier (`51b272a`), so that gate is covered.
- Email + profiles.email + increment 1 were verified live earlier this session (welcome delivered, webhook advancing status, `select id, first_name, email from profiles` returning rows).
- **Not run here:** full `npm run build` / the engine vitest suite (untouched this session — these were UI + infra changes only). Let Vercel build confirm the app compile.

---

## 4. Next actions

1. Confirm the latest **Vercel deploy** is green (all five commits are pushed).
2. **Growth loop, remaining:** race/PR card auto-prefill (needs a benchmark-history / per-station splits feed — deferred, no data source yet) and **Strava branded activity-write**.
3. **Lifecycle email polish:** watch webhook status transitions in prod; optional deliverability tuning so welcome lands in Primary rather than Promotions.
4. **DMARC:** currently `p=none` (monitoring). Escalate to `quarantine` then `reject` in ~2–4 weeks once reports look clean.
5. Long-lead gate still open: **D-U-N-S + Apple Developer** org enrollment (blocks the whole iOS lane).
6. Still parked: WHOOP (needs a physical device); apply A/B/C periodization to HYROX/DEKA (deliberate golden-snapshot regen).

---

## 5. Where things live
- **Email:** `lib/email/**` (svix, webhook-status, flows), `app/api/webhooks/resend`, `app/api/email/unsubscribe`, `app/settings/email`. Env: `EMAIL_ENABLED` (lowercase `true`), `RESEND_API_KEY`, Resend webhook secret, `EMAIL_FROM` (note: a **space** before `<`, not an underscore).
- **profiles.email:** `supabase/migrations/0028_profiles_email.sql`, `app/onboarding/actions.ts`.
- **Result cards:** `components/program/{result-card,result-card-studio,result-card-launcher,session-card-data}.tsx/.ts`; launched from `program-view.tsx` (header) + `week-card.tsx` (per completed session).
- **Roadmap:** `Duravel_Roadmap_Planned_vs_Actuals.html` (updated this session — lifecycle email LIVE, result cards shipped).
- **Git-bridge gotcha (unchanged):** the mount allows rename but not unlink → git leaves stale `.git/*.lock` + `tmp_obj_*`; `mv` them aside before git ops. Commits authored as Levi Loveless <levi.loveless@duravel.app>, no AI-vendor references.
