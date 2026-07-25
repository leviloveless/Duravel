# Engine + view — daily-load guards & training-time tiles

Three requested changes.

## 1. No more than 2 workouts per day  (rule #1)
New `capSessionsPerDay(days, protectedDays, max=2)` in `lib/engine/sequencing.ts`:
relocates any 3rd+ session on a day to the emptiest eligible day. Keeps lifts and
the long run put (moves cardio / easy runs first), never lands a 2nd lift on a
day, and never uses a preferred rest day. Count-preserving, best-effort.

## 2. Runs double up only once every day already has a run  (rule #2)
New `spreadRuns(days, protectedDays)`: while a day stacks ≥2 runs and an
unprotected day has none (with room ≤2), it moves the most-movable run onto the
emptiest run-less day — so runs fan out across the week before any day gets two.
The long run stays on its (pinned) day. For Levi (3 runs, 7 days) every run lands
on its own day.

Both run in the existing `if (counts.researchLifts)` block in `slots.ts`, after
`separateLifts` / `pairLegLiftWithCardio`, in order: spreadRuns → capSessionsPerDay.
**Gated on the weekly-hours band**, so the golden HYROX oracle (no band) is
byte-identical. Band skeletons may shift → the band snapshots regenerate (`-u`).

## 3. Program view tracks weightlifting time + total training time
`components/program/week-card.tsx` header now shows **Strength time** and **Total
training** next to Cardio time / Running mileage, via the existing
`weekTimeByCategory(week)` (`strength` = lift minutes at a flat 60/session,
`total` = strength + cardio + running + non-running cardio). Display-only; updates
live with coach edits since it's derived from the sessions.

## Files
- `lib/engine/sequencing.ts` — `spreadRuns`, `capSessionsPerDay` (+ helpers).
- `lib/engine/slots.ts` — import + call both in the band guard block.
- `lib/engine/sequencing-guards.test.ts` — tests for both new guards.
- `components/program/week-card.tsx` — Strength time + Total training tiles.

## Verify (comment-free — Windows CMD safe)
    npm run build
    npm test -- -u
    git add -A
    git commit -m "engine: max 2 workouts/day + spread runs before doubling; view: strength+total time"
    git push

`-u` because the band skeleton snapshots may shift as sessions are re-spread
(golden stays green untouched). New sequencing-guard tests pass. `lib/admin.test.ts`
still fails on missing env — pre-existing. Then redeploy for it to reach duravel.app.
