# Duravel Handoff — 08-03-26 9:45am

Experience-tiered session and day caps.

## Spec

| level | session | day |
|---|---|---|
| beginner | 90 min | 3 h |
| intermediate | 105 min | 3.5 h |
| advanced | 120 min | 4 h |

Which level applies depends on the sport family:

- `station_hybrid` (HYROX + all five DEKA variants) → **running experience**. Session length here is a running-durability question; the stations are short by comparison.
- `triathlon` (all three distances) and `general_fitness` → **lowest of running / hybrid / lifting**. These spread load across modalities, so the least-trained quality is what limits session length.

## Two things worth knowing before reading the diff

**The day cap cannot currently bind.** It is exactly twice the session cap in every tier, and the engine already limits a day to two workouts — so two sessions both at the cap land precisely on the day cap and never exceed it. It is implemented as a guard against a future change that allows a third session, not as a constraint that fires today.

**Runs and Zone 1–2 blocks were already counted separately.** `MAX_RUN_TOTAL` capped both independently; there was never a summed cap. The real change is that the flat 90 becomes 90/105/120, so intermediate and advanced athletes now get longer maximum sessions than before. Beginners are unchanged.

## Implementation

New `lib/engine/caps.ts` — pure, no I/O:

- `capExperience(family, exp)` — the sport-family rule above.
- `trainingCaps(family, exp)` → `{ session, day }`.
- `DEFAULT_CAPS` — the beginner tier, used when nothing is supplied.

`ProgramSkeleton.caps` and `SkeletonInput.caps` carry it, populated in `toEngineInput` from the athlete's profile and sport. `assembleProgram` passes `skeleton.caps` through `buildWeek` into `reconcileWeekVolume`, which now takes a `caps` parameter.

Inside the reconciler the flat `MAX_RUN_TOTAL` constant is gone; `sessionCap` is threaded explicitly through `maxMiles`, `sizeRuns`, `enforceLongRun`, `writeRun`, `buildEasyRuns`, `trueUpMileage` and `splitCardio`.

A first pass used a module-level mutable `let MAX_RUN_TOTAL` reassigned per call. That works only because everything downstream is synchronous within one invocation — it is shared state across calls and would break the moment a helper ran outside that window. Replaced with explicit parameters before shipping. Worth not repeating.

The filler placement also gained a day-cap guard (`dayTotalMinutes(d) + MIN_PAIRED_CARDIO <= caps.day`).

## Snapshots

Sixteen moved. The whole diff, de-duplicated, is one additive line per skeleton:

    >   "caps": undefined,

`undefined` because the engine fixtures construct `SkeletonInput` directly rather than going through `toEngineInput`, so they carry no caps and fall back to the conservative default. Behaviour in the fixtures is unchanged. The prompt-oracle snapshot is untouched.

## Tests

New `lib/engine/caps.test.ts` (10 tests): the family rule for each sport family, tier mapping, the day-cap-equals-two-sessions invariant, the default, and two that run the real `toEngineInput` path to confirm caps actually reach the skeleton — a HYROX beginner runner with advanced lifting gets 90/180, a 70.3 athlete with beginner lifting gets 90/180.

`lib/generation/reconcile.test.ts` gains a session-cap block: no session exceeds its tier at 90/105/120, an advanced athlete gets a longer single session than a beginner on the same week, the default is the conservative 90, and a run plus a cardio block on one day are capped separately rather than summed.

`vitest run` 794 tests passing. `tsc --noEmit` exit 0. `next build` exit 0.

## Next

Week 11 of the previous test program was the case that prompted this — Tuesday at 130 minutes (easy run + Zone 1–2 cardio) against a 115-minute Sunday. Under the new caps that day is legal for an intermediate or advanced athlete but each session is individually bounded. Regenerate and check that no single session exceeds the athlete's tier.
