# Duravel Handoff — 2026-08-04 1:19am

## Follow-up to the total-mileage change (push pending)

`d1019cd` **program: show each run's total on-feet distance, not just work reps**
— committed to `main` on top of `3af8194`; **PUSH PENDING (Levi runs `git push origin main`).**

### Why
After `fdee524` made the weekly "Running mileage" count TOTAL on-feet distance
(work + warmup/cooldown + between-rep recovery + hybrid running), each run's
*headline* distance still showed only `session.distanceMiles` = the main-set reps.
So an interval run read "2.5 mi" (4x1km work) while the athlete actually runs
~6.2 mi, and the per-run numbers no longer summed to the weekly total. Levi spotted
it on a live-generated program (interval run total not matching the workout).

### Fix (display-only; Levi chose "total on-feet")
Switched the athlete-facing run distance from `session.distanceMiles` (work) to
`sessionMiles(session)` (total on-feet = work + `overheadMiles` + `recoveryMiles`,
the same figure `weekMileage` sums) in three places:
- `components/program/week-card.tsx` — the program-table run headline
- `components/program/format.ts` `runLine()` — used by session-card + workout-view
- `components/program/session-card-data.ts` — result-card seed (planned side; logged
  actuals still use the logged GPS distance)

`session.distanceMiles` (work) is UNCHANGED in storage — logging, Strava matching,
and the admin editor still use the raw work value. `overheadMiles`/`recoveryMiles`
are persisted on the run schema (lib/schemas.ts 273-279, stamped in reconcile.ts
634-641), so this reads correctly for any program generated after `fdee524`.

### No regenerate needed
The fix is display-only and reads already-persisted fields, so once pushed +
deployed, refreshing an EXISTING post-`fdee524` program shows the corrected
totals (interval run -> ~6.2 mi). No recalculate required.

### Verified
Cloud clone (base `3af8194` + this patch): **827/827 vitest pass**, `tsc --noEmit`
clean, prettier clean. md5 `b4b703c8…` matched device-side.

## TO DO (Levi)
1. **`git push origin main`** (push needs you).
2. After deploy, refresh the open program (7975359e) — the Monday interval run
   should read ~6.2 mi instead of 2.5 mi.
3. Delete `_to_delete/` yourself when convenient (rm blocked over the bridge; I
   moved `_run-distance-display.patch` in there).
