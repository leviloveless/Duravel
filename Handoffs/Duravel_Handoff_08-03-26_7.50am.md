# Duravel Handoff — 08-03-26 7:50am

## What shipped

Weekly day balance. Two structural problems, reported from week 1 of a 7-day program: Monday sat empty while Friday, Saturday and Sunday each carried two sessions, and all the cardio was bunched into Thursday–Sunday, leaving Monday/Tuesday/Wednesday with no aerobic work at all.

## Root causes — both different from the first guess

**The cardio clustering was not a sequencing problem.** The Zone 1–2 blocks are not engine slots; the engine has no `cardio` session kind. They are filler added later by `reconcileWeekVolume`, and its placement score read:

    (preferDays.includes(day) ? 100 : 0) - sessions.length * 10

The weekend term led, so a Saturday already holding the long run scored 100 − 10 = 90 against an empty Monday's 0. Every filler block went to Sat/Sun. That weekend preference was added in an earlier round to satisfy "Sat and Sun should be the biggest days" — it worked, and it caused this.

**The empty day comes from the pinning passes.** `assignDays` deals sessions round-robin across all seven days, which would never strand one. What strands it is what runs afterwards — long run forced to its day, hybrid anchored to the weekend, lifts re-dealt onto spread targets. None of those checked whether it had just emptied a day. Note that "Rest" in the UI is indistinguishable from "stranded": any day ending with no sessions gets a `{kind:"rest"}` appended.

**And a third, found on the way.** `separateLifts`, `pairLegLiftWithCardio`, `spreadRuns` and `capSessionsPerDay` all ran only under `if (counts.researchLifts)` — true only for a band-table sport with an hours budget. On an ordinary program none of them ran at all.

## Changes

`lib/generation/reconcile.ts`

- New `dayHasCardio()` — runs, hybrids, bikes, swims, bricks and the reconciler's own Zone 1–2 blocks all count; a lift-only day does not.
- `leastLoadedUnderCap` now ranks cardio-free days above the weekend. Aerobic frequency across the week beats which day is biggest.
- New `pickCardioDay()` places each block on a cardio-free day **only while doing so keeps that day at or under the heaviest weekend day**, so Sat/Sun stay biggest by minutes. Once spreading would overtake the weekend, the block goes to the weekend instead.
- Block count now targets one per cardio-free day rather than one per free weekend day.

`lib/engine/sequencing.ts`

- New `fillEmptyDays()`. While a selected training day is empty and another holds 2+, move the most-movable session from the fullest day. Deliberately outranks the hybrid/lift pins. Never moves the long run or a race, never creates a second lift on the destination, never touches a preferred rest day.

`lib/engine/slots.ts`

- The four daily-load rules are ungated and now apply to every program, with `fillEmptyDays` running last so it levels out whatever the caps leave behind.

## The constraint worth knowing about

`MIN_CARDIO_TOTAL` is 45 minutes — every cardio session is at least that. So "pair a lift day with a short easy spin" cannot mean 20 or 30 minutes without lowering that floor for every program, which is a training-content decision, not plumbing. On a light week a single 45-minute block can still outweigh a weekend day; when that happens the ceiling test sends it to the weekend and the lift day stays dry. That is the deliberate trade-off: weekend-biggest wins over cardio-frequency when the two genuinely cannot both hold.

## Golden snapshot

Eight snapshots moved (six golden HYROX, two prompt oracle; the time-budget snapshot is untouched). Before accepting, session kinds, run types and lift types were tallied per block and per week, old against new.

Everything is placement-only except one week: week 11 of the 20-week `A@20 + B@10` fixture, the week immediately after the B race, where an easy run became a fartlek. Session kinds are identical there (1 rest, 6 runs, 1 lift, 1 hybrid) and both runs carry `goalZone: 2`, so the intensity is unchanged. `applyPostBRaceRecovery` prunes and re-homes that week based on day order, so a different run instance survived. Benign, and the only composition change in 100 weeks of fixtures.

## Tests

New `lib/engine/day-balance.test.ts` (8 tests) and a new block in `lib/generation/reconcile.test.ts` (4 tests).

Both sets were checked against a reverted build to confirm they are not vacuous: with `fillEmptyDays` disabled the day-balance sweep fails, and with the reconcile scoring reverted two of the cardio tests fail. A first attempt at this check silently failed to apply the revert and appeared to pass — worth repeating the check properly rather than trusting one run.

Full verification: `vitest run` 79 files / 772 tests passing, project-wide `tsc --noEmit` exit 0, `next build` exit 0.

## What was NOT demonstrated

The golden fixtures show no measurable improvement — 100 weeks, one week with an empty day beside a doubled day and six weeks with a 3+ day aerobic gap, both before and after. That is expected: those fixtures use 4–6 training days where the empty days are genuine preferred rest days, and they stop at the engine skeleton, before the generation stage where cardio filler is added. The improvement is real but only visible in the new targeted tests and on a live 7-day program.

Confirm on a regenerated program: no empty day beside a doubled one, no three-day aerobic gap, and Sat/Sun still the biggest days by total minutes.
