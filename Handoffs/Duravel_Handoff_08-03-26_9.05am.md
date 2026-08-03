# Duravel Handoff — 08-03-26 9:05am

Retest of the priority-ordered filler, plus onboarding guidance on rest days.

## Retest result on `7664f8e`

Fixed since the previous round:

- **No day has two filler blocks** anywhere in 16 weeks (was week 8).
- **Weekend-biggest** holds everywhere except weeks 7, 10 and 16 — and those are the B/B/A race weeks where the weekend total is 0, so the comparison is vacuous rather than a violation. Weeks 13 and 14 (135 vs 115, 135 vs 108) are fixed.

Still failing: seven weeks had an empty day next to a doubled one, which is the athlete's HIGHEST priority. Two of those (weeks 3 and 12) are deloads where an empty day is intended. Weeks 8 and 15 were not — week 8 had Monday empty on a Build/Increase week with five other days doubled.

## Root cause — rest days conflated with stranded days

`assembleWeek` derived the reconciler's `avoidDays` by reading rest slots back off the skeleton:

    const restDayKeys = skel.days
      .filter((d) => d.sessions.length > 0 && d.sessions.every((x) => x.kind === "rest"))
      .map((d) => d.day);

`assignDays` appends a `{kind:"rest"}` slot to **any** day that ends up with no sessions. So a day the engine merely failed to use looked exactly like a day the athlete asked to keep clear, and the reconciler refused to put filler on it — guaranteeing it stayed empty while other days doubled. The mechanism actively defeated priority 1.

This is the same conflation flagged in the 7:50am handoff ("Rest in the UI is indistinguishable from stranded") — noted then as a UI wrinkle, but it was load-bearing in the generation path.

## Fix

`ProgramSkeleton` gains `restDays?: TrainingDayName[]`, populated from `input.restDays` (the athlete's real `dayPreferences.restDays`). `assembleProgram` passes it through `buildWeek` into `reconcileWeekVolume` as `avoidDays`. The skeleton inference is gone.

Now a chosen rest day still blocks filler; an incidentally-empty day is exactly where filler goes first.

## Onboarding guidance

The rest-day picker on the program builder (shared by `/onboarding` and the edit-inputs page) now reads:

> Only pick a day here if you genuinely can't train it, or know you don't want to. A rest day is held clear all the way through the plan, so every one you set is a day the program can't use — the more days it has to work with, the better it can space your hard sessions and spread your cardio across the week. Leave this empty and recovery days still get built in where they belong.

The long-run constraint note stays as its own line.

## Snapshots

Sixteen snapshots moved (six golden HYROX, ten time-budget). The entire diff is one additive line per skeleton:

    >   "restDays": undefined,

Verified by diffing old against new and de-duplicating every changed line — nothing else moved, and the prompt-oracle snapshot is untouched. No behavioural change in the fixtures; they carry no rest-day preference.

## Verification

`vitest run` 79 files / 778 tests passing. `tsc --noEmit` exit 0. `next build` exit 0.

New test pins the distinction: a day the engine merely left empty now receives filler, while a day passed in `avoidDays` still does not.

## Next

Regenerate with no rest days and re-check weeks 8 and 15 specifically — those are the non-deload weeks that were failing. Deload weeks 3 and 12 keeping an empty day is expected and correct.
