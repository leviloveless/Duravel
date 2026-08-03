# Duravel Handoff — 08-02-26 9.50pm

## Scope
Levi's 4-item long-run list: (1) multi-day long-run selection, (2) a selected day must actually get
the long run, (3) default to Sat/Sun when unset, (4) biggest-volume days default to Sat/Sun.
**All four implemented — engine, schema, AND onboarding UI. Files are in the working tree,
uncommitted.**

## ⚠️ Read this first: the earlier patch was STALE
An initial version of this work was built against `9b07808`. By the time it was delivered, HEAD had
advanced **7 commits** (to `906f368`) — including `8015ac4` "Program long runs as plain long runs;
move compromised-running framing to hybrid sessions", which **removed the `compromised` flag from
`RunSlot`**. Those commits touched the exact files being changed (`slots.ts`, `assemble.ts`,
`schemas.ts`, `types.ts`, `skeleton.ts`). Applying the old patch would have reverted real work.
Caught by md5-comparing the working tree against the base copy before writing anything —
**do this check every session** (see [duravel-device-bridge-write-failure]).
`Duravel_longrun.patch` (delivered in chat earlier) is obsolete — **do not apply it.**

## Design decisions (Levi chose)
- Volume rule → **anchor the top 2 sessions**: long run + next-heaviest (hybrid / race sim) to
  Sat/Sun. Not a full weekly re-rank.
- Multi-day pick → **same day every week** (first selected day), for routine.
- Rest vs long-run conflict → **blocked in the UI** (pills grey out both ways).

## Root cause of #2
`lib/generation/assemble.ts` matched AI sessions to engine slots **by `kind` only** and pushed the
AI's session through verbatim. It force-corrected `liftType: "power"` but never `runType`. So when
the engine planned "Saturday = long run" and the model returned an *easy* run there, the easy run was
assembled and the long run effectively moved to whatever day the model chose. Confirmed on program
`a446a749…`: long run on Monday (the un-preferenced round-robin slot) in weeks 1 and 7, and Monday
was also the heaviest day (95 min) — exactly what item #4 wants on the weekend.

## Changes (12 files, all in the working tree)
Engine / schema:
- `lib/schemas.ts` — `DayPreferences.longRunDays: TrainingDay[]`; legacy `longRunDay` kept +
  deprecated so saved profiles keep working.
- `lib/engine/types.ts` — `EngineInput.longRunDays`.
- `lib/engine/slots.ts` — `normalizeLongRunDays()`, `resolveLongRunDay()` (first selected trained
  day → else Sat → else Sun → else leave alone), `forceSessionOn()` (hard, count-preserving),
  weekend anchor for the biggest non-long session, **race-day exclusion**.
- `lib/engine/sequencing.ts` — `spreadRuns` / `capSessionsPerDay` may no longer relocate the long
  run (protected-day checks only ever guarded a *destination*).
- `lib/engine/skeleton.ts` — threads `longRunDays`; normalizes at `toEngineInput`.
- `lib/generation/assemble.ts` — **the fix**: match on (kind + runType) first, fall back to kind,
  then force the engine's `runType` + `goalZone`.
- `lib/supabase/queries.ts` — `longRunDays` on the profile row type.
- `__snapshots__/golden-hyrox.test.ts.snap` — regenerated (see below).
- NEW `lib/engine/long-run-day.test.ts` (20), NEW `lib/generation/assemble-runtype.test.ts` (5).

UI:
- `app/onboarding/onboarding-form.tsx` — long-run picker is now multi-select `DayPills`
  (`longrunday_*`) instead of a `<select>`; `DayPills` gained a `disabledKeys` prop; long-run and
  rest-day pills mutually grey each other out; state seeds from `longRunDays ?? [longRunDay]`.
- `app/onboarding/actions.ts` — reads `longrunday_*` into `dayPreferences.longRunDays`.

## ⚠️ Gotcha found + fixed
Forcing the long run to Saturday put it **on the C-race day**, and the race overwrites its own day's
sessions wholesale in `assignDays` — so the C-race week ended up with **no long run at all**.
`resolveLongRunDay` now takes an `excludeDay` (the race day) and the race day joins `protectedDays`.

## ⚠️ Golden-HYROX snapshots changed (4 of 6) — intentional
The header says a diff means the refactor is wrong; that gate is for *unintended* drift, and item #3
deliberately changes the no-preference default. Verified before accepting:
- The 2 weekday-only fixtures (`mon–fri`) are **byte-identical** — `resolveLongRunDay` returns
  `undefined` when neither weekend day is trained, so weekday athletes are untouched.
- 3 of the 4 changed fixtures keep an **identical session mix** — only day placement moved.
- 1 fixture (multi-race A@20 + B@10) trades a hybrid for the long run in week 11. Cause:
  `applyPostBRaceRecovery` blindly overwrites the first 3 training days of the week after a B race.
  It *already* destroyed a session (the long run, which used to sit on Monday); now the long run
  survives on Saturday and the hybrid swapped onto Monday is destroyed instead. **Session count
  unchanged (8 → 8)** and keeping the keystone long run is the better outcome — left as-is.
  **Follow-up worth doing: `applyPostBRaceRecovery` silently deletes whatever sits on those days.**

## Verification
- `vitest run lib/engine lib/generation` on the rebased tree → **43 files, 481 tests, all pass**
  (includes Levi's newer `long-runs.test.ts` + extended `slots.test.ts`). Run in the cloud container;
  device `node_modules` are win32 so vitest can't run there.
- The 10 lib files on disk are **md5-identical** to the tree those 481 tests ran against.
- On-device scoped `tsc` with the REAL `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`) over
  the engine files **and both UI files** → clean.

## To finish
```
cd C:\dev\duravel
del ".git\index.lock"
git add -A
git commit -m "engine+onboarding: multi-day long-run selection, weekend volume defaults, enforce planned run type"
git push
```
Then Recalculate a program (or make a new one) to see it. Note: existing programs don't change until
regenerated. Scratch files left in `_to_delete\` (fresh.tgz, lib-src.tgz, tsconfig.lrcheck.json) —
safe to empty.
