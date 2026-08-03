# Duravel Handoff — 08-03-26 10:20am

Retest of the cap fix on `baa105d`, then the refactor that removes the fragility behind it.

## Retest — "Cap fix test"

HYROX, beginner running experience → 90 min per session, 180 per day. Across 16 weeks:

- **Session cap: clean.** Longest session in the program is exactly 90 minutes.
- **Day cap: clean.** Busiest day 138 against a 180 limit.
- **No day carries two filler blocks.**
- **Empty day beside a doubled day**: weeks 3, 6, 9 only — all Deload, which is intended.
- **Weekend biggest**: weeks 11 (130 vs 115) and 13 (135 vs 115) miss it. Weeks 7/10/16 register only because a race week's weekend total is 0.

Weeks 11 and 13 are the session cap correctly outranking a soft preference: both weekend days are already at two sessions, so no filler can be added there, and the only way to close the gap would be to breach the per-session cap. Right precedence.

## The refactor

`keepPreferredDaysBiggest` is gone, along with `splitCardio` and the `Placed`/`PlacedKind` tagging that existed only to tell that pass what it was allowed to touch.

It had produced three bugs in three rounds:

1. spliced from the wrong day's session list and silently deleted a lift;
2. grew a filler block past the athlete's session cap;
3. encoded the priority order implicitly in call sequence, so the order was a property of when things ran rather than of anything stated.

The common cause was the shape: place blocks, then mutate already-prescribed sessions until a soft preference is satisfied.

Replaced by `planFiller`, which decides the entire layout before writing any of it. It tries to spread onto as many days as possible, then backs off one day at a time until the weekend still comes out on top; the first layout that satisfies every rule is the one that gets written. Nothing is repaired afterwards because nothing is written until it is already correct.

Priority order is now explicit in the code: spread targets are built as `[empty days, then lift days without cardio]`, the weekend takes the remainder, and the back-off loop is what makes weekend-biggest rank above pairing. Hard limits that outrank all three — per-session cap, per-day cap, two workouts a day, exact cardio total — are checked as constraints during planning rather than patched afterwards.

When no layout can satisfy weekend-biggest (weeks 11 and 13 above), there is an explicit documented fallback that serves the higher priorities and lets the soft preference go.

`reconcile.ts` is 557 lines, down from 600-plus, with one fewer concept in it.

## Behaviour

Byte-identical on the reference weeks — the refactor changes structure, not output:

    FULL                                DELOAD
    mon  cardio 30            30m       mon  cardio 30           30m
    tue  lift 60              60m       tue  lift 60             60m
    wed  lift 60              60m       wed  —                    0m
    thu  run 52               52m       thu  —                    0m
    fri  run 47 + lift 60    107m       fri  lift 60             60m
    sat  run 68 + cardio 63  131m       sat  run 88 + cardio 42 130m
    sun  hybrid 40            40m       sun  hybrid 40           40m
    cardio = 300 exact                  cardio = 200 exact

## Tests

All 25 existing reconcile tests pass unchanged against the new planner — priority order, session caps, exact totals, one-block-per-day, rest-day avoidance. That they needed no edits is the main evidence the refactor is behaviour-preserving.

Three added, pinning what the old design broke: when the weekend cannot be biggest the caps and the exact total still hold; no planned lift, run or hybrid is ever removed or altered; and the same week in gives the same layout out.

`vitest run` 80 files / 799 tests passing. `tsc --noEmit` exit 0. `next build` exit 0. No snapshot movement.

## Next

Regenerate and confirm the live output is unchanged — this round should be a no-op on the program the athlete sees.
