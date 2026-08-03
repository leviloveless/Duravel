# Duravel Handoff — 08-03-26 8:10am

Follow-up to the 7:50am day-balance round. Verifying that work against a fresh 16-week program surfaced three problems; two were defects in what had just shipped.

## Defect 1 — fillEmptyDays was a no-op where it mattered

Wednesday was empty in weeks 3, 6, 9, 12 and 15 while Friday carried run + lift.

`fillEmptyDays` was handed the full `protectedDays` set. That set holds not only the athlete's preferred rest days but every pin — the long-run day, the hybrid anchor, and each preferred lift day. Wednesday is a preferred lift day; on a week with fewer lifts than preferred days it stayed pinned *and* empty, and the rule refused to touch it.

The stated requirement was that filling an empty day outranks the pins. It now receives only the rest days plus any race day, so a pinned-but-empty day is fair game.

## Defect 2 — the weekend ceiling was bypassed

14 of 16 weeks had a weekday bigger than the weekend (week 12: Tuesday 107 min vs Saturday 69), a regression against a requirement set two rounds earlier.

`pickCardioDay` applied the ceiling on its primary path, but when that path rejected every candidate it fell through to `leastLoadedUnderCap` — which had also been given a cardio-free-day bonus, and no ceiling. The guard was skipped in exactly the case it existed for.

## The underlying conflict, and how it resolves

Spreading cardio onto lift days and keeping Sat/Sun biggest by total minutes cannot both hold at the old 45-minute cardio floor: a 60-min lift plus a 45-min block is 105, against a Saturday whose long run is only 60 in early base weeks.

Resolved by adding `MIN_PAIRED_CARDIO = 30` — a block paired onto a day that already has a lift sits below the standalone 45-minute floor, because a paired spin is a bolt-on rather than a session in its own right. Standalone and weekend blocks keep the 45-minute floor.

The gap fill is now two explicit phases:

1. **Spread** — a 30-minute block onto each day with no aerobic work yet, lift-bearing days first. Taking days in calendar order spent the budget on Monday and left Tuesday's lift dry, so the ordering matters. Always reserves one paired block's worth for the weekend.
2. **Remainder** — the rest, weekend first, at the normal floor.

Then `keepPreferredDaysBiggest` moves *minutes* from an offending weekday's filler block to a weekend one rather than refusing to spread. Total cardio is preserved exactly; only the distribution shifts. Moving X minutes closes the gap by 2X, so it converges in a couple of passes; a block that would fall under the paired floor is removed outright and its whole duration handed over.

`leastLoadedUnderCap` reverted to its original weekend-first scoring. It is the remainder path only — spreading is explicit in phase 1 now, and having the bonus in both places double-counted it.

## Result on the reference week

    mon  —                        0m
    tue  lift 60 + cardio 30     90m
    wed  lift 60 + cardio 30     90m
    thu  run                     52m
    fri  run                     47m
    sat  long run 68 + cardio 33 101m
    sun  hybrid                  40m
    total cardio: 300 (exact)

Every lift day paired, no three-day dry stretch, weekend still the biggest day, prescribed volume unchanged.

Across the athlete's exact preference shape (rest Mon, lift Tue–Fri, long run Sat/Sun, hybrid incl. Sun), all twelve phase/micro-week combinations now come back with no empty day beside a doubled one.

## Tests

`lib/engine/day-balance.test.ts` gains a pinned-but-empty-day sweep; `lib/generation/reconcile.test.ts`'s cardio block was rewritten around the new intent — pair every lift day, never leave a lift day dry while another doubles, no three-day gap, weekend biggest, exact total, rest day clear.

Both were checked against reverted builds: with `fillEmptyDays` given `protectedDays` again the pinned-day sweep fails; with the spread budget zeroed three cardio tests fail.

`vitest run` 79 files / 775 tests passing. `tsc --noEmit` exit 0. `next build` exit 0. **The golden snapshot did not move this round** — these changes affect configurations the fixtures don't cover.

## A note on the earlier report

The "empty Monday" that started this was not a bug: `restday_mon` is set in the athlete's own inputs, so the engine was right to keep it clear. Worth confirming that was intended.

## Next

Regenerate and re-check: no empty day beside a doubled one, no three-day aerobic gap, every lift day paired, and Sat/Sun biggest by total minutes.
