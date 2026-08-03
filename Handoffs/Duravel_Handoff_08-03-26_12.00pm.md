# Duravel Handoff — 08-03-26 12:00pm

Between-rep recovery now counts toward mileage and cardio minutes. Supersedes the open item in the 11:00am handoff.

## What was wrong

`durationMin` on a rep-based run is the REPS only. The recovery jogging between them appeared in the description and in no total anywhere:

    prescribed:  15 warmup + 20 reps + 10 cooldown              = 45 min
    actual:      15 warmup + 20 reps + 15 recovery + 10 cooldown = 60 min

Three consequences: every interval and threshold session under-reported its cardio time; the session cap was not a real cap; and the recovery jogging — which is running — added uncounted miles.

## Rep structure now lives in one place

New `lib/engine/interval-structure.ts`, dependency-free so `session-volume`, `run-descriptions` and the reconciler can all use it without a cycle. It owns the rep counts by experience and the work:rest ratios (interval 1:1, threshold 2:1 — unchanged, per instruction).

The subtlety it exists to get right: **N reps have N−1 gaps, not N.** At 1:1 with 5 reps the recovery is four rep-lengths against five of work — 0.8 of the work time, not 1.0. The earlier estimate in the calibration module used 1.0 and overstated an interval session by a full rep.

## Accounting

Consistent with the earlier decision — count it in what the athlete SEES, never in the work target:

- `RunSession.recoveryMin` and `.recoveryMiles`, stamped during reconciliation.
- `sessionTiming().work` now includes the recovery, so the session total and weekly cardio minutes are right. It goes in `work` rather than a new column because that is what it is: time inside the main set.
- `sessionMiles` adds recovery distance; `sessionWorkMiles` does not, so `targetMileage` still reconciles against reps alone.

A reference week for a beginner, 12.5 mi work target, 300 cardio minutes:

    thu interval:  work 27m/3.3mi | rec 20m/1.9mi | w-u+c-d 2.3mi | TOTAL 72m / 7.5mi
    fri threshold: work 27m/3.1mi | rec  6m/0.6mi | w-u+c-d 1.9mi | TOTAL 53m / 5.6mi
    sat long:      work 58m/5.5mi | rec  0m/0mi   | w-u+c-d 1.0mi | TOTAL 68m / 6.5mi
    WEEK: work 12.5mi (target, exact) | total 20.2mi | cardio 300 min (exact)

## The session cap was silently breached

Adding recovery exposed that the cap was being applied to rep time only, so a rep-based run overran it. Every clamp now goes through one `workBudget(cap, overhead, runType, exp)` helper that divides by `1 + recoveryFactor` — there were three such clamps and my first pass only fixed one, which showed up as 92-minute sessions under a 90-minute cap.

Then 92 became 91: double rounding. Work minutes round up, and the recovery derived from them rounded up again. Both the budget and the recovery are floored now, so reps plus recovery can never round past the cap. There is a sweep test across week shapes holding this.

## Two test fixtures were stale, not wrong

- The `sessionHrShape` expectations hardcoded the old 1.0 ratio. They now derive from `recoveryFactor` so they cannot drift from the implementation again.
- "pairs the lift days once every day is in use" started failing because the runs now supply more cardio, leaving no surplus to place at a 300-minute target. Raised to 420 so the test still exercises pairing rather than passing vacuously.

Neither was loosened to go green.

## Verification

`vitest run` 827 tests passing. `tsc --noEmit` exit 0. `next build` exit 0. No snapshot movement.

## Still open

The HR calibration module remains unwired — reading `avg_hr` / `max_hr` off linked activities and `actuals.avgHr` off logs, then surfacing the verdict in the adaptation review. `sessionHrShape` now reads the stored `recoveryMin` when present, so it is accurate on newly generated programs.
