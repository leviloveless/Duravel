# Duravel Handoff — 2026-08-04 12:54pm (session wrap)

## STATUS: everything below is COMMITTED + PUSHED + LIVE. `main` == `origin/main`, nothing outstanding.

This session shipped 6 commits on top of `7bdebf6`. Two themes: (A) mileage semantics
+ per-run display, (B) full-body-lift day separation — plus (C) a new manual-pace feature.

### Commits (oldest → newest)
- `fdee524` engine: size weekly running to TOTAL on-feet mileage
- `45bdce6` engine: never program full-body lifts on consecutive days (first pass)
- `3af8194` chore: exclude `_to_delete` from tsc/git
- `d1019cd` program: per-run displayed distance = total on-feet (not work reps)
- `f7891c6` engine: GUARANTEE full-body lifts never consecutive (real-bug fix)
- `32f1d99` program: manual easy/threshold/interval/tempo pace overrides

## A. Mileage = total on-feet distance (`fdee524` + `d1019cd`)
Levi's rule: the starting-mileage number (e.g. 12.5) = TOTAL distance on feet for the week
— work + warmup/cooldown + between-rep recovery jog + hybrid running — NOT work-only. Quality
volume shrinks to fit (his explicit choice).
- `reconcile.ts` targets `weekMileage` (total) via a converge loop (`stampRunOverhead` +
  `adjustRunMilesToTotal` + final single-run snap); helpers `setRunMiles` clamp to floor+cap.
- `d1019cd`: the per-run HEADLINE distance now uses `sessionMiles` (total on-feet) in
  week-card / `format.runLine` / session-card-data — previously showed only `distanceMiles`
  (work reps), so an interval run read "2.5 mi" while the athlete runs ~6.6. Stored
  `distanceMiles` (work) unchanged → logging/Strava matching unaffected. Display-only, so
  existing programs show corrected totals on refresh (no regenerate).
- VERIFIED LIVE: interval run reads ~6.6 mi; weekly mileage = total on-feet.

## B. Full-body lifts never on consecutive days (`45bdce6` → `f7891c6`)
Rule: two `liftType:"full"` lifts must NEVER be on consecutive calendar days; kept >=2 days
apart when possible; all lifts best-effort >=1 apart.
- `45bdce6` added `separateLiftDays` (relocate-a-lift approach). It was INSUFFICIENT: with a
  weekly-hours budget + advanced lifting the RESEARCH split fires (`counts.researchLifts`,
  skeleton.ts) → `researchLiftSplit(3)=[full,power,full]` = TWO full lifts. They landed on
  adjacent days that couldn't be moved (free days all protected: long run, weekend hybrid,
  key runs), and `applyPostBRaceRecovery` re-homed them onto Fri+Sat. Levi caught this on a
  live program ("Fall prep", Tue+Wed double-full); a Recalculate did NOT fix it → real bug.
- `f7891c6` FIX: `spreadFullLiftTypes` (sequencing.ts) RELABELS which lift day carries the
  heavy "full" vs the lighter "power" session — count-preserving, no day move — to spread the
  fulls (e.g. Tue-full/Wed-power/Fri-full). Called at the start of `separateLiftDays` AND
  after `applyPostBRaceRecovery` re-homes (skeleton.ts). No-op when already spaced → golden
  fixtures untouched. Wide scan (5 bands × 3 exps × 2 classes × 6 day-sets × 3 race-sets):
  2820 two-full weeks, 0 consecutive-full violations. Regression tests in
  `lib/engine/lift-spacing.test.ts`. time-budget snapshot = pure full<->power relabel.
- VERIFIED LIVE: "Fall prep" recalc → weeks that were Tue+Wed double-full now Tue/Fri; 0
  consecutive-full pairs in any week.
- ⚠️ generation-time: EXISTING programs need a RECALCULATE to pick up spacing.

## C. Manual pace overrides (`32f1d99`)
Athletes can enter their own easy/threshold/interval/tempo paces on the Benchmarks step, in
min/mile OR min/km (unit toggle). A manual pace REPLACES the VDOT-derived value for that run
type and drives BOTH the displayed pace AND the mileage math (easy override also moves long).
Blank = keep calculated. Disclaimer at input + amber "manual" badge on the VDOT tab.
- Central: `computePaces` → `applyPaceOverrides` (paces.ts). km→mi ×1.609344.
- KEY GOTCHA fixed: `assembleArgsFromInput` (assemble.ts) previously whitelisted only
  mile/5K/10K into `raceTimes`, which would strip overrides from the mileage math — now threads
  the pace fields through.
- Schema (`BenchmarksSchema`: easyPace/thresholdPace/intervalPace/tempoPace + paceUnit),
  onboarding action, onboarding form ("Know your paces?" card), vdot-card badge/disclaimer.
- Tests in `paces.test.ts`. VERIFIED LIVE: set threshold 7:00 → threshold runs + hybrid runs
  show 7:00/mi (were 8:48); weekly mileage shifted 16→15.9 (proves it drives the math).
- ⚠️ "Fall prep" currently has TEST overrides saved (easy 10:00, threshold 7:00). To revert:
  Edit inputs → clear those two boxes → Save & recalculate.
- NOTE: input takes a PACE (min/mi or min/km), NOT mph. Levi's "4.2 mph" ≈ 14:17/mi. If he
  wants the box to also accept mph, that's a small add (mph→min/mi on input) — not built.

## Verification tooling used
Cloud clone `/tmp/duravel-ci` (re-clone + re-auth each session): `npx vitest run` (835 pass),
`npx tsc --noEmit` (clean, exclude `_to_delete`), `npx prettier --write`. Transfer = SendUserFile
→ device_commit_files a .patch → `git apply` on device → commit via device_bash (move `.lock`s
aside first; inline `-c user.name/email`; add SPECIFIC files; filter "unable to unlink|tmp_obj").
Push ALWAYS Levi. md5 each patch both sides.

## Known latent (NOT fixed, pre-existing)
- `applyPostBRaceRecovery` (skeleton.ts) blindly overwrites the first 3 training days of the
  week after a B race and re-homes their sessions. We now re-spread full lifts after it, but
  the broader "rearranges the whole front of the week" bluntness remains.
- `_to_delete/` still has tracked junk (now tsc/git-excluded). Run `git rm -r --cached _to_delete`
  to drop the 29 tracked files; then delete the folder (rm blocked over the bridge — I moved
  this session's patches into it).

## Possible next-up (none committed to)
- mph input option for manual paces (Levi flagged 4.2 mph).
- Revisit whether week-1 target should sit closer to the entered starting mileage (Levi asked
  earlier why 12.5 start → 15.9 wk1; that's periodization ramp, separate from the mileage-metric
  change — not investigated).
