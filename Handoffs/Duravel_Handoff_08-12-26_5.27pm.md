# Duravel Handoff — 2026-08-12, 5:27pm CT

## What was asked

> "Add a function to the program view for the user to sync workouts from all connected api sources."

## What shipped

A **"Sync workouts"** button in the program-view header (next to *Edit inputs* / *Regenerate*)
that pulls from **every** connected API source in one click, then refreshes the page so newly
imported activities appear in the "Synced workouts ready to link" banner without a manual reload.

Before this there was no such action anywhere: `/activity`'s **Sync now** pulls **Strava only**
even when Oura is connected, and `/settings/connections` makes you press one button per
connection. An athlete on Strava + Oura had no single way to bring their program up to date.

### Base

`d0d7de6` (= `origin/main` at time of writing). Device worktree was clean of code changes;
the two modified files md5-matched `HEAD` before patching.

### Files

| File | State |
|---|---|
| `lib/wearables/sync-all.ts` | **NEW** — provider registry + `syncAllConnected()` + `summarizeSyncAll()` |
| `lib/wearables/sync-all.test.ts` | **NEW** — 12 tests |
| `app/api/wearables/sync/route.ts` | **NEW** — `POST /api/wearables/sync` |
| `components/program/sync-all-button.tsx` | **NEW** — the header control |
| `components/program/program-view.tsx` | modified — optional `sync` prop → renders the button |
| `app/program/[id]/page.tsx` | modified — reads `getConnectionStatuses(user.id)` in the existing `Promise.all`, passes `{connectedCount, lastSync}` down |

Patch for the 2 modified files: `_to_delete/session26-sync-all.patch` (already applied).
The 4 new files were written whole via `device_commit_files` — the bridge cannot unlink, so a
patch can't create them.

## Design decisions (Levi's calls, 2026-08-12)

1. **Placement — program header**, next to Edit/Regenerate. Rejected "inside the suggestions
   banner", because that banner only renders when there ARE suggestions — you could never sync
   when nothing was pending, which is exactly the moment you want to.
2. **Apple Health is reported, not hidden.** It is **push-only**: the phone POSTs to
   `/api/ingest/healthkit` on its own schedule and there is *nothing to pull* server-side. The
   result line says `… · Apple Health syncs from your phone` so a connected source is never
   mysteriously absent. It never inflates the import count.
3. **The existing per-provider buttons stay.** Settings keeps per-connection control (useful for
   debugging one integration); `/activity` is unchanged and still Strava-only. The program-view
   button is the everyday one-click path.

## How it works

`PULL_SYNCS` is a registry — `{ strava: syncStrava, oura: syncOura }`. Adding WHOOP or Garmin
later is **one entry**, and both the endpoint and the UI pick it up for free. `PUSH_ONLY_PROVIDERS`
is `["apple_health"]`.

Three invariants, each pinned by a test:

1. **Only CONNECTED providers are pulled.** `syncStrava` throws `"Strava is not connected."` when
   there's no row — calling it unconditionally would turn a fine sync into a visible failure.
2. **One provider failing does not take the others down.** Every provider is settled
   independently and its error rides on its own row. A dead Oura refresh token still lets Strava
   import. The route returns 200 with `ok: false` on that provider, not a 400 for everything.
3. **Push-only sources are reported, never pulled, never counted.**

Providers run concurrently (`Promise.all`) — two independent HTTP round-trips shouldn't serialize
behind each other on a 60s function budget.

I/O is **injected** (`SyncAllIo`) because this repo mocks nothing — `vi.mock` appears nowhere in
it, so a parameter is the only honest seam. The test fakes **count calls**, which is precisely
what invariant 1 is about.

`summarizeSyncAll()` lives in the lib, not the component, so the status string is unit-testable
and identical wherever it's shown:

- `Imported 4 workouts (Strava 3, Oura 1).`
- `Imported 1 workout (Strava 1).` — singular, not "1 workouts"
- `Imported 2 workouts (Strava 2) · Oura failed: Oura token expired.`
- `Imported 2 workouts (Strava 2) · Apple Health syncs from your phone.`
- `Nothing to pull · Apple Health syncs from your phone.` — push-only-only setup
- `No sources connected — connect Strava or Oura in Settings.`

With **zero** sources connected the button is replaced by a **"Connect a workout source"** link to
`/settings/connections`, rather than a button that can't do anything. A failed sync tints the
status line amber.

## Verification (cloud clone of `d0d7de6` + these changes)

- `npx vitest run` → **1028/1028 passed**, 99 files (was 1016; +12 new)
- `npx tsc --noEmit` → clean
- `npx next build` → **Compiled successfully**; `ƒ /api/wearables/sync` present in the route table
- `npx prettier --check` on all 6 touched files → clean
- `git diff | grep "^-"` → the only removed lines are the single `Promise.all` block I
  intentionally reshaped. **No prettier churn on pre-existing code.**
- All 6 files md5-match between the cloud build and `C:\dev\duravel` after `git apply`.

## No migration

Nothing schema-side. `wearable_connections` already has everything this needs.

## Next steps for Levi

1. **Commit + push**: `git add app components lib` — nothing else is in this change.
2. **Verify live** on `https://duravel.app/program/<uuid>`: the header should show **Sync workouts**
   with `Last sync: …`. Click it; with Strava connected you should see
   `Imported N workouts (Strava N).` and the link-suggestions banner should update on the refresh.
   Reload and read the console before declaring either success or a regression (React #418
   hydration artifacts have faked both before).
3. Worth checking the **Oura** path specifically if it's connected — that's the leg that has never
   had a caller outside Settings.

## Still open (unchanged by this session)

- Migration `0041_workout_logs_strava_activity.sql` — confirm it has been RUN.
- 3 duplicate Strava activities to delete by hand (no API can).
- The 17%-of-weeks-over-target finding — still unexamined.
- Triathlon `h30_40` audit — Levi's decision.
- `CLAUDE.md` still says the app lives under `hyroxai/` — it does not.
- `app.duravel.app` returns Vercel `404: DEPLOYMENT_NOT_FOUND` (the iOS shell targets it).
- `Duravel_Roadmap_Planned_vs_Actuals.html` was **not** updated this session.
