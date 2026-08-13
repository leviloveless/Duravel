# Duravel Handoff — 2026-08-06 6:37pm ET

## STATUS: patch 25 APPLIED to the worktree, md5-verified (8/8), **NOT committed**. Base `b192a0a`.

**1008/1008 vitest · `tsc` clean · `next build` clean · prettier clean on every touched file.**

```
_to_delete/session25-autopost-idempotency.patch
```

```
cd C:\dev\duravel
git add app components lib supabase
git commit -m "strava: one logged session owns one activity, and an activity Duravel posted signs itself"
git push
```

**Migration `0041_workout_logs_strava_activity.sql` must be run in the Supabase SQL editor.**
The code is defensive without it — the `.select()` 400s, `logRow` comes back null, and the
auto-post reverts to today's behaviour (post every time) rather than breaking the log — so the
patch is safe to deploy before the migration. It just does nothing until 0041 lands.

> **⚠️ Two new files could NOT be patched in the normal way.** The device bridge cannot unlink
> files, so `git apply` can neither create-then-revert nor delete them. They were written whole via
> `device_commit_files` and are already on disk, md5-matched:
> `lib/wearables/strava-autopost-idempotency.test.ts` · `supabase/migrations/0041_….sql`.
> The patch file itself covers only the 6 MODIFIED files. `git add lib supabase` picks up both.

---

## ✅ First: everything from the 11:13am handoff is now closed

- **Migration 0040 applied (by Levi) and patch 23 VERIFIED LIVE.** The program-page banner dropped
  from **"Synced workouts ready to link (4)" → "(2)"**, and the two that remain are genuine
  third-party activities (Weight Training, Ride). `/activity` reads **"Posted by Duravel"** with no
  Link button on Duravel's own posts. No console errors on reload.
- **Patch 24 committed, pushed AND verified live** — `b192a0a`. Every Hybrid (HYROX) session renders
  `Warm up: 10 min easy (~0.8 mi) @ 13:20/mi` … `Cooldown: 5 min easy (~0.4 mi) @ 13:20/mi`, split
  10/40/5, miles counted.

### 🌐 Two things the live check turned up that nobody had recorded

1. **`app.duravel.app` returns Vercel `404: DEPLOYMENT_NOT_FOUND`.** The app is served from
   **`duravel.app`** — `/dashboard`, `/program/<uuid>`, `/activity`, `/settings`; there is no
   `/program` index route. **The iOS Capacitor shell is specced against `app.duravel.app`**, so that
   open iOS blocker ("confirm app.duravel.app renders in a WKWebView") is now confirmed as real:
   the hostname resolves to no deployment at all.
2. **`CLAUDE.md` is stale** — it says the app lives under `hyroxai/`. It does not; the Next.js app is
   at the REPO ROOT (`app/`, `lib/`, `components/`).

---

## 1. 🔁 Patch 25a — one logged session owns ONE Strava activity

`POST /api/logs` UPSERTS the log on `(program_id, week_number, day, session_index)` — so a correction
edits one row — and then called `createManualActivity` **unconditionally**. Every save left another
copy on Strava. Live on 2026-08-06 that produced **three activities for one threshold run**
(`19626903555`, `19628136284`, `19628388163`).

### ⚠️ The constraint that decided the design — check this before proposing anything cleverer

Strava's `UpdatableActivity` accepts **name, description, type/sport_type, gear_id, commute, trainer,
private — and nothing else.** Not `distance`, not `elapsed_time`, not `start_date`. And **the v3 API
exposes no DELETE for activities.**

So "post it again with the right numbers" and "delete the duplicates" are both impossible. Once an
activity exists, its numbers are frozen. **Levi's call: correct text beats a duplicate.**

- `workout_logs.strava_activity_id` (mig 0041) holds the activity a session posted. The upsert
  payload deliberately omits the column, so a re-log preserves it.
- `syncAutoPost(existingId, io)` is the rule, **with its I/O injected** — the repo mocks nothing
  (`vi.mock` appears NOWHERE), so a parameter is the only honest seam. No id → create. Id → refresh
  the text, never create. Id but the PUT 404s → the athlete deleted it, so post fresh (Levi's call);
  `updateActivityDescription` now throws a distinct `strava_activity_missing` for that.
- `buildAutoPostText` is the single source for the create AND refresh payloads, so a re-log can never
  retitle an activity into a different format.
- The route persists the id **only when it changed** — a refresh returns the id it was given. That
  write is best-effort like the post itself: failing it costs a duplicate next time, never the log.
- `markSelfPosted` now fires **only on create**. A refresh touches an activity that was claimed the
  first time round and has since been filled in properly by the sync.

**The duplicates already on Strava cannot be removed by us** — no DELETE endpoint. Levi has to delete
those three by hand in the Strava UI if he wants them gone.

## 2. 🏷️ Patch 25b — auto-posted activities sign themselves

Levi, mid-session: *"the automatic strava upload needs to include Duravel branding and bottom of the
post."*

`AUTOPOST_FOOTER = "— Duravel · duravel.app"`, appended by `withAutoPostFooter` inside
`buildAutoPostText`.

**This is a deliberate, narrow exception to the 2026-08-05 decision.** That day Levi asked for "a
clean description — the workout and nothing else", and `branding.ts` dropped `BRAND_MARKER` from the
block for exactly that reason. That rule still governs the **Copy** button and the manual
**"To Strava"** write — both stay unbranded. An activity Duravel *created* is Duravel's own post, so
it signs itself, and only there. Levi chose both the copy and the scope explicitly.

Short on purpose: the description already opens with `Week 1 - Thursday - Threshold Run`, so a footer
repeating session/week/program would say everything twice.

Two idempotency properties, both tested:

- `withAutoPostFooter` is a no-op on text that already ends with the footer — the refresh path
  rewrites an already-footered description on every correction.
- `stripWorkoutBlock` cuts from the `Week N - …` title line to the END, so the footer sits *inside*
  the block it removes. It can never be stranded above a rewritten one, and an athlete's own text
  above the block survives untouched.

## 3. 📷 Patch 25c — the result-card nudge (Levi's choice: log confirmation)

The card capability shipped long ago; the gap was always discovery. A save that turns a session
GREEN now raises a small bottom sheet — *"Nice work — share it?"* → **Result card** — seeded from the
SAME `sessionSummary().cardData` the row's Share link uses, so the image offered is the image Share
builds. Self-clears after 12s; dismissible; partials and skips get nothing.

`week-card.tsx` now computes `shareSummary` **once per row** and feeds both `LogSession` and
`SessionShare` — it was being built twice in each of the two layouts.

## 4. 🧪 Tests

`lib/wearables/strava-autopost-idempotency.test.ts` — **10 cases, all 10 fail against a pristine
`main` clone.** Be honest about *why*: they fail by ABSENCE (the new exports don't exist on main),
not because main computes a different answer. The one that would still be meaningful if the
functions existed is *"three corrections in a row leave ONE activity, not three"* — it counts
`create` calls against a fake, which is precisely what went wrong live.

One existing assertion changed: `strava-autopost.test.ts` "posts the prescription as the description"
now expects the footer. That is the feature, not a fudge.

## ▶️ NEXT
1. Run migration **0041**, commit + push patch 25, then verify live: log a session twice and confirm
   **one** Strava activity, its text refreshed, footer present and NOT doubled.
2. Delete the three duplicate activities by hand on Strava (no API can do it).
3. The 90-weeks-over-target finding — pre-existing, unexamined.
4. Triathlon h30_40 audit — needs Levi's call: bigger long-run cap at 30–40h, or scale
   `targetMileage` down at the top bands.
5. Fix `CLAUDE.md`'s `hyroxai/` path, and decide what to do about `app.duravel.app`.

## 🟡 STILL OPEN
- Migration 0041 unapplied; patch 25 uncommitted.
- Three orphan duplicate activities on Strava.
- `app.duravel.app` resolves to no deployment — blocks the iOS shell as specced.
- 17% of weeks land over their stated mileage target (pre-existing, worst +4.5 mi).
- The legacy BAND back-fill — still needs Levi.
- 120 two-lift days on the bandless legacy path, by the patch-22 scope decision.
- iOS parked; its unapplied `notification_prefs.sql` declares a rival `timezone` column.
- Lifecycle email: needs `EMAIL_ENABLED` + `RESEND_API_KEY` + DNS.
- `BILLING_ENABLED` still on the old strict env parser.
- hyresult: price hyroxresultapi.com / the Apify scraper first.

## Process notes
- **Read the third-party API's limits BEFORE designing around them.** The whole shape of patch 25 —
  refresh-not-repost, and "the numbers are frozen once posted" — falls out of `UpdatableActivity`
  having seven fields and there being no DELETE. Ten minutes of doc-reading; the alternative designs
  were all impossible.
- **`git status` at repo root TIMED OUT at >45s again, but `git status --short | head -40` returned
  in ~20s.** Useful when you actually need the file list.
- **The bridge cannot unlink, so a `git apply -R` leaves new files behind.** Reversing patch v1 to
  apply v2 restored all six MODIFIED files to pristine main (md5-checked against a clean clone) but
  left the two NEW files on disk with v1 content, which made `git apply` of v2 fail on "already
  exists". Fix: patch only the modified files, ship new files whole via `device_commit_files`.
- **Prettier churn caught a fourth time** — it wanted to collapse a 4-line import into one line.
  `git diff | grep "^-"` before packaging caught it; the fix was to let prettier have that one line
  and re-check that nothing else moved. Note `components/program/log-session.tsx` ALREADY fails
  `prettier --check` on main — do not "fix" it, that is exactly how unrelated churn gets in.
- **A live verification pass paid for itself again** (third time in two days): checking patch 23
  surfaced the `app.duravel.app` 404 and the stale `CLAUDE.md` path, neither of which anyone was
  looking for.
