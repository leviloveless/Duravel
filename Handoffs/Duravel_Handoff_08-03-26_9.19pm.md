# Duravel Handoff — 2026-08-03 9:19pm

## What shipped this session (committed to `main`, NOT yet pushed)

Two engine rule changes Levi asked for, plus a small chore. Three commits on
top of `7bdebf6`:

- `fdee524` **engine: size weekly running to total on-feet mileage**
- `45bdce6` **engine: never program full-body lifts on consecutive days**
- `3af8194` **chore: exclude _to_delete from typecheck and git**

### 1. Mileage = TOTAL on-feet distance (`fdee524`)
The starting-mileage number (e.g. 12.5) now represents the athlete's TOTAL
distance on feet for the week — warmups, cooldowns and between-rep recovery
jogging INCLUDED — not just the work/main-set distance it meant before.
Quality/work volume shrinks to make room (Levi's explicit choice).

- `lib/generation/reconcile.ts`: switched the reconciler's target metric from
  `weekWorkMileage` to `weekMileage` (work + overhead + recovery). Replaced the
  old single-pass true-up with a converge loop that stamps run overhead, then
  grows/shrinks run distances until `weekMileage` lands on the target (<0.05 mi),
  with a final single-run snap for any sub-tenth residual. Helpers added:
  `stampRunOverhead`, `setRunMiles` (clamps to session floor + cap), and
  `adjustRunMilesToTotal`.
- Tests (`reconcile.test.ts`, `peaking.test.ts`) flipped: total (`weekMileage`)
  `== target`, work (`weekWorkMileage`) `< target`. Infeasible extreme weeks are
  best-effort (sweep asserts `weekMileage >= target - 0.05`).

### 2. Full-body lifts never consecutive (`45bdce6`)
- HARD rule (met everywhere): two `liftType:"full"` lifts are never on
  calendar-consecutive days and are kept >= 2 days apart.
- SOFT rule ("tries to"): every weight session tries for >= 1 day of separation;
  remaining consecutive non-full pairs occur only in dense weeks and are left
  best-effort.
- `lib/engine/sequencing.ts`: new exported `separateLiftDays(days, protectedDays)`
  (+ helpers `calGap`, `requiredLiftGap`, `bestLiftDay`, `moveLiftTo`, `isFullLift`,
  `CAL_INDEX`). Calendar-day gaps (a rest day counts). Count-preserving swap.
- `lib/engine/slots.ts`: called in `assignDays` right after `capSessionsPerDay`.
- Snapshots regenerated (INTENTIONAL — verified pure day-position rearrangement,
  no sessions added/dropped; golden diff balanced 21 lift / 21 run both sides):
  `golden-hyrox.test.ts.snap`, `time-budget-skeleton.test.ts.snap`,
  `prompts.test.ts.snap`.

### 3. Chore (`3af8194`)
`tsconfig.json` excludes `_to_delete` from tsc (like `Apple`, `_phase3_draft`);
`.gitignore` adds `_to_delete/`. Does NOT untrack the 29 files already committed
under `_to_delete/` — run `git rm -r --cached _to_delete` to drop those (Levi's
call).

## Verification
- CLOUD clone (`/tmp/duravel-ci`, base `7bdebf6`): **827/827 vitest pass**, `tsc --noEmit`
  clean, prettier clean. Device tree = same base + byte-identical patch (md5
  `1d5af296…` matched on both sides), so it is verified-equivalent.
- `git diff 7bdebf6..HEAD --stat` = exactly the 10 intended files.

## TO DO (Levi)
1. **`git push origin main`** (cloud egress to GitHub is blocked — push needs you).
2. Optional: `git rm -r --cached _to_delete` then commit, to drop the tracked junk.
3. Delete `_to_delete/` yourself (rm is blocked over the bridge; I moved the
   transfer patch `_lift-mileage.patch` into it).
