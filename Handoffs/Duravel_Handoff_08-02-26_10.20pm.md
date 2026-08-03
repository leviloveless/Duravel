# Duravel Handoff — 08-02-26 10.20pm

## Trigger
Levi: "long run is on Saturdays each week but most Sundays have interval run workouts."
Investigated the live program `d1cb2226-76af-4931-8de7-d6b305eea789` ("Fall Hyrox", created Aug 3).
**Files written to the working tree, uncommitted.** Base verified current (HEAD `b3194ea`) before writing.

## Root cause — NOT a bug in the long-run work
Levi's actual inputs (read off `/edit`):
- long-run days: **Sat + Sun**   · rest day: **Mon**
- lift days: Tue,Wed,Thu,Fri     · **hybrid days: Tue,Wed,Thu,Fri,Sun**

Because he set explicit `hybridDays`, the weekend anchor was skipped by design (explicit preference
wins). Hybrids are pinned by walking the list **in order**, and there is only **~1 hybrid/week**, so it
always resolved to **Tuesday** — the first entry. Sunday was in his hybrid list but never got one, so
it fell through to whatever the round-robin left: a lift, or the interval run.

Two further problems found while investigating (he had not reported these):
1. **Monday was his REST day and the HEAVIEST day of the week** (wk1: interval 45m + cardio 48m = 93m;
   Tue 102m; Sat/Sun 60m each). `restSet` was all-or-nothing: with 7 training days − 1 rest = 6 slots
   and 7 sessions, the preference was abandoned entirely and the round-robin used all 7 days. The
   reconciler then dropped its filler cardio on the "least loaded" day — Monday.
2. **Item #4 (Sat/Sun = biggest volume) was therefore not met at all** — Mon/Tue were the biggest.

## Levi's decisions (08-02-26)
- Multiple preferred hybrid days → **prefer the weekend one**.
- Rest day when the week overflows → **honour partially, overflow last, lightest thing there**.
- **No quality run the day after the long run.**

## Changes (7 files)
- `lib/engine/slots.ts`
  - `weekendFirst()` — reorders a preference list so Sat/Sun come first (stable otherwise). Applied to
    `hybridDays` pinning, so the one weekly hybrid takes the weekend day.
  - Rest days now go **last** in `distributionDays` instead of the preference being dropped: every
    non-rest day fills before a rest day is touched.
  - Post-distribution swap: anything that *did* spill onto a rest day is traded for the lowest
    `slotPriority` session elsewhere, so a rest day can never hold the week's hardest work.
  - Calls `spaceHardRunAfterLongRun`.
- `lib/engine/sequencing.ts` — new `spaceHardRunAfterLongRun()`: relocates an interval/threshold/tempo
  run sitting the day AFTER the long run (swaps with an easy run, else moves to a free run-less day).
  Count-preserving, honours protected days, and won't create a new hard day immediately *before* the
  long run (so it correctly no-ops when there's nowhere safe).
- `lib/generation/reconcile.ts` — new `FillerPlacement` ({avoidDays, preferDays}): filler cardio and
  added easy runs never land on a rest day, and prefer Sat/Sun. `splitCardio` gained `minBlocks` so a
  large surplus is split across BOTH weekend days rather than stacked on Saturday.
- `lib/generation/assemble.ts` — computes the week's rest days from the skeleton and passes
  `{avoidDays: restDays, preferDays: ["sat","sun"]}` into the reconciler.
- NEW `lib/engine/weekend-load.test.ts` (11 tests).
- Both snapshot files regenerated.

## Result on Levi's exact config (replayed in the engine)
Before → after, per-day totals:
- Sat: 60m → **125–155m** (biggest day) · Sun: 60m → 85–94m in most weeks
- Mon (rest): **93m → 0–60m**, and never quality work
- Sunday is the **hybrid every training week**; no interval the day after the long run.

Honest caveat: **Tuesday can still edge out Sunday in some weeks** (~105m) because he pinned 4 lift
days Tue–Fri and lifts are a flat 60m. Sat is reliably #1; Sun is usually #2 but not always. Forcing it
further would mean overriding his own lift-day preferences.

## Verification
- `vitest run lib/engine lib/generation` → **44 files, 492 tests, all pass** (481 + 11 new).
- **Every snapshot in BOTH files keeps an identical session mix** — only day placement moved
  (verified by tallying `"kind"` + `"runType"` per snapshot block before accepting the update).
- Cloud `tsc` with `strict` + `noUncheckedIndexedAccess` over all changed files → clean.
  (On-device `tsc` timed out at 44s — not a failure, just slow; the cloud check covers these files.)
- Device files **md5-identical** to the tree the 492 tests ran against.

## To finish
```
cd C:\dev\duravel
del ".git\index.lock"
git add -A
git commit -m "engine: weekend carries the biggest volume; rest days stay light; no hard run after the long run"
git push
```
Then create a new program (or Recalculate) — existing programs don't change until regenerated.
Scratch files in `_to_delete\` (f2.tgz, fresh.tgz, lib-src.tgz, tsconfig.*.json) — safe to empty.

## Still open (unchanged from last handoff)
`applyPostBRaceRecovery` blindly overwrites the first 3 training days of the week after a B race,
silently deleting whatever sits there. Count-preserving in practice, but a real latent bug.
