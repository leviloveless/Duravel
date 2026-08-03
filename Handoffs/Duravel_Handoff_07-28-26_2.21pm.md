# Duravel Handoff — 07-28-26 2:21pm

## Task
Fix the "compromised running" programming. The engine was labeling the weekly
**long run** as a "long compromised run" (stations threaded into the long run).
That is wrong: compromised running is what the **HYROX / hybrid sessions** train
(weighted station -> run in the same workout). Long runs must be programmed as
plain aerobic long runs; the compromised-running explanation belongs on the
hybrid workouts.

## What changed (all on `main` working tree — NOT committed; awaiting review)

### Removed the "long compromised run" mechanism (fully)
- `lib/engine/skeleton.ts` — dropped `counts.compromisedLong = true`.
- `lib/engine/slots.ts` — removed `compromisedLong` from `SessionCountTables`,
  the `buildRunSlots` param, the `compromised: true` flag on the long slot, and
  the call-site arg.
- `lib/engine/types.ts` — removed `RunSlot.compromised`.
- `lib/engine/skeleton-schema.ts` — removed `compromised` from the run slot schema.
- `lib/schemas.ts` — removed `compromised` from `RunSessionSchema`.
- `lib/engine/run-descriptions.ts` — removed `compromisedLongDescription()`.
- `lib/generation/assemble.ts` — removed all compromised handling
  (placeholder, daySessions enforcement, describe branch, import).
- `lib/engine/compromised-long.test.ts` — deleted (replaced, see below).
- `components/program/format.ts` — removed "Long compromised run" labels.
- `components/admin/session-fields.tsx` — removed the "Compromised long run" checkbox.

Note: `COMPROMISED_FACTOR` in `pacing.ts` / `deka-pacing.ts` and
`compromisedRunFactor` in the sport config are the race-time PACE-PREDICTION
model (running slower on tired legs) — unrelated, left intact. The
`/science/volume-intensity` page already frames compromised running correctly.

### Added the compromised-running explanation on hybrid workouts + coach guidance
- `lib/engine/run-descriptions.ts` — new `hybridDescription()`: what compromised
  running is, why it's programmed, how the station->run format builds it, and an
  explicit note that the long run is a separate plain aerobic run.
- `lib/generation/assemble.ts` — `describeRuns` -> `describeSessions`, now also
  attaches `hybridDescription()` to every hybrid session (incl. Peak race sims).
- `lib/schemas.ts` — added optional `description` to `HybridSessionSchema`.
- `components/program/session-card.tsx` — renders the hybrid description.
- `lib/ai/philosophy.ts` — `HYBRID_GUIDANCE` now states hybrids ARE the
  compromised-running work and the long run must NOT have stations threaded in.
- `lib/engine/long-runs.test.ts` — new test: long runs never flagged compromised;
  long-run description has no stations; hybrid description covers what/why/how.

## Verification (run in a clean cloud clone of `main` @ 8620e98 — device
node_modules is Windows-built so vitest can't run in the device Linux VM)
- `npx vitest run -u` → **71 files / 687 tests pass**; 11 snapshots regenerated.
- `npx tsc --noEmit` → **clean (exit 0)**.
- Regenerated snapshots copied back to the device:
  `lib/engine/__snapshots__/time-budget-skeleton.test.ts.snap` (compromised
  lines gone) and `lib/ai/__snapshots__/prompts.test.ts.snap` (HYBRID_GUIDANCE
  text). `golden-hyrox` snapshot unchanged (golden path never set the flag).

## Remaining / next
- Review the diff, then **commit + push** (not done per request). Suggested msg:
  "Program long runs as plain long runs; move compromised-running framing to
  hybrid sessions".
- Stale `.git/index.lock` (created by git running in the device Linux VM) was
  moved to `_to_delete/index.lock.stale`. Obsolete test moved to
  `_to_delete/compromised-long.test.ts`. Both safe to delete.
