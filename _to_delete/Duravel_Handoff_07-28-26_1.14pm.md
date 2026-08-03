# Duravel Handoff — 07-28-26 1.14pm

## What was done
Fixed two bugs affecting **C ("tune-up") races** in generated programs. Reported by Levi on program
`a446a749-3099-4f31-a0a5-aeefd0c4048c` ("Fall Prep", 16wk goal event): a C race chosen for
**Sat 2026-09-19** rendered on **Sun 09-20**, and week 7 showed **21.2 running miles** (vs ~12.5 in wk 1).
A and B races were unaffected.

## Root causes
1. **Wrong race day (off-by-one).** `lib/engine/slots.ts` `assignDays()` always placed the race on the
   **last training day** of the week (`days[days.length-1]`), ignoring the real `race.date`. Levi trains
   all 7 days, so a Saturday race landed on Sunday. A/B looked fine only because those races fall on his
   last training day (Sunday).
2. **Inflated mileage.** `lib/generation/reconcile.ts` `reconcileWeekVolume()` did `if (hasRace) return;`,
   skipping mileage normalization for ANY week with a race. A/B are near-empty taper weeks so this was
   harmless, but a C race "trains through" a FULL week (`lib/engine/taper.ts` leaves volume untouched) —
   so the AI's unclamped run distances were never sized to the engine target.

## Changes
- `lib/engine/slots.ts`: added `raceDayIndex(days, isoDate)` — places the race on the training day
  matching `race.date`'s weekday (parsed LOCAL, like the calendar display). Falls back to the last
  training day when no date is given (engine week-space fixtures) or the weekday isn't trained →
  **golden snapshots stay byte-identical** (their races carry no `date`).
- `lib/generation/reconcile.ts`: skip reconciliation only for **A/B** races; **C** races now reconcile to
  the engine target. Race days are protected from receiving added run/cardio blocks
  (`isRaceDay` guard in `leastLoadedDay`/`leastLoadedUnderCap`).
- Tests: new `lib/engine/slots.test.ts` (6) + expanded `lib/generation/reconcile.test.ts` (C-race case).

## Verification
`vitest run lib/engine lib/generation` → **41 files, 457 tests, all pass** (incl. golden-hyrox +
time-budget-skeleton snapshots). Run in a cloud container (device node_modules are win32; no linux rollup).

## Still to do
- **Not deployed.** Fixes are committed to the local working tree only — deploy (Vercel) then have Levi
  hit **Recalculate** on the program to regenerate week 7 with the correct day + mileage.
- Left a scratch tarball at `_to_delete/lib-src.tgz` (already in the trash folder).
- Optional follow-up: A/B races share the same last-day placement path; they only look correct because
  they fall on Levi's last training day. The `raceDayIndex` fix also corrects them generally.
