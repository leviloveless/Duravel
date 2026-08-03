# Duravel Handoff — 08-03-26 8:40am

Testing the 8:10am round on a no-rest-day program surfaced two bugs and one thing that turned out to be arithmetic, not a defect.

## The conflict, stated properly

Four goals are in play and on a low-volume week they cannot all hold:

1. use every selected training day
2. keep Sat/Sun the biggest days by total minutes
3. pair every lift day with cardio
4. never two cardio sessions on a day while a lift day is dry

Week 3 of the test program is a deload: after the runs are sized there are ~75 surplus cardio minutes. Pairing three lift days costs 90. Also filling three empty days costs another 90. The minutes do not exist, so something has to give.

The athlete's ranking, now encoded directly in the code: **use every day → keep the weekend biggest → pair the lift days.** Pairing is what yields.

Empty days on deload and taper weeks are explicitly NOT a defect — fewer sessions than days is what a deload is. What still matters on those weeks is that the work is spread rather than bunched at one end.

## Bug 1 — two filler blocks on one day

Week 8 came back with `tue: cardio + cardio`. Phase 1 placed a paired block on a day that started empty; phase 2 then saw the day still under the 2-session cap and added another. Precisely the pattern this work exists to remove, introduced by the previous round.

Phase 3 now excludes any day that already took a block, by adding those days to `avoidDays` for the remainder pass.

## Bug 2 — the rebalancer deleted a lift

`keepPreferredDaysBiggest` removes a filler block when it is too small to trim, and it spliced from `over.sessions` — the offending day. After the fallback was added, `source` can be a pairing block on a *different* day, so `indexOf` returned -1 and `splice(-1, 1)` removed that day's LAST session. In the reference week that deleted a lift and left the cardio total at 330 against a target of 300.

It now splices from `source.day.sessions`, with a guard if the block is already gone. Caught only because the debug harness printed the cardio total and lift count — worth keeping that habit.

## Structure

The gap fill is now three explicitly named phases matching the priority order, with each placed block tagged `fill` / `pair` / `remainder`:

- **Phase 1, fill** — a 30-min block on every empty eligible day, before any occupied day gets a second session.
- **Phase 2, pair** — a 30-min block on lift days that still have no aerobic work.
- **Phase 3, remainder** — the rest, weekend first, at the 45-min floor, skipping days that already took a block.

`keepPreferredDaysBiggest` then protects the weekend, and the tag tells it what it may raid: a `pair` block may be surrendered, a `fill` block never is. That is the priority order expressed as a data structure rather than as ordering luck.

## Reference weeks

    FULL                                DELOAD
    mon  cardio          30m            mon  cardio          30m
    tue  lift            60m            tue  lift            60m
    wed  lift            60m            wed  —                0m
    thu  run             52m            thu  —                0m
    fri  run + lift     107m            fri  lift            60m
    sat  run + cardio   131m            sat  run + cardio    130m
    sun  hybrid          40m            sun  hybrid          40m
    cardio = 300 exact                  cardio = 200 exact

Every day used where the minutes allow, weekend biggest in both, totals exact, all lifts and hybrids preserved.

## Tests

`lib/generation/reconcile.test.ts` reworked around the priority order: uses an empty day before pairing; pairs the lift days once every day is in use; never two filler blocks on one day; preserves every planned session while rebalancing (pinning bug 2); weekend biggest; exact total; rest day clear.

`vitest run` 79 files / 777 tests passing. `tsc --noEmit` exit 0. `next build` exit 0. Golden snapshot unmoved.

## Next

Regenerate with no rest days and re-check: no empty day beside a doubled one on normal weeks, no day with two filler blocks, weekend biggest, and lift days paired wherever the minutes stretch.
