# Duravel Handoff — 2026-08-04 2:47pm CT

## STATUS: three patches APPLIED to the worktree, md5-verified, **NOT committed**. Base was `fed63db`.

`.git/index.lock` is cleared. **872/872 vitest, `tsc` clean, golden-HYROX skeleton snapshot byte-identical.**

```
_to_delete/session-0804pm.patch    → patch 1 (run text + strength volume)
_to_delete/session2-0804pm.patch   → patch 2 (triathlon lifts + cardio guard)
_to_delete/session3-0804pm.patch   → patch 3 (chest_fly + race-week placeholders)
```

Commit when ready (do NOT let a cloud session run git here — that is what recreates the lock):

```
cd C:\dev\duravel
git add lib
git commit -m "engine: rep counts follow real distance; per-session set ceiling; chest fly; tri set volume"
git push
```

⚠️ **All of this is GENERATION-TIME. Existing programs need a RECALCULATE.**

---

## 1. 🔴 Levi's reported bug: threshold run headline ≠ the workout (FIXED)

**Reported:** "the workout title says 1.8mi but the actual workout is about 3.8 miles."

**Root cause — not the stale-program answer the last handoff would have predicted.**
`INTERVAL_REPS` / `THRESHOLD_REPS` in `interval-structure.ts` are **fixed constants per
experience level** (interval 4/5/6 × 1 km, threshold 2/3/4 × 1 mile). `reconcile.ts` resizes every
run's `distanceMiles` up or down to hit the week's mileage target. **Nothing ever reconciled the
two.** The text kept prescribing "3 × 1 mile" while the stored work distance was 1.8.

Audit, 87 interval/threshold runs across 3 experience levels × 4 day-sets:

| | before | after |
|---|---|---|
| runs whose text ≠ stored distance (≥0.15 mi) | **87 (100%)** | **0** |
| worst gap | **3.7 mi** | — |

**Fix — distance drives reps, not the other way round:**
- `repsForWorkMiles(runType, workMiles, exp)` + `snapWorkMiles()` + `REP_DISTANCE_MILES`
  (interval = 1 km, threshold = 1 mile) in `lib/engine/interval-structure.ts`.
- `setRunMiles()` (reconcile.ts) now **snaps quality runs to a whole number of reps** — the single
  place run distances are written, so text and number can't drift again. The leftover fraction is
  picked up by the existing residual pass, which lands it on the long run (not rep-based, so exact).
- `recoveryMinutesForReps()` / `recoveryFactorForReps()` scale the between-rep jog to the REAL rep
  count instead of the experience default.
- `redescribeQualityRuns()` (assemble.ts) regenerates the how-to **after** reconciliation, from the
  distance the run actually ended at. `runDescription()` takes an optional `reps` override.

Verified WK13 threshold: work `3.0` mi against text "3 × 1 mile"; headline `6.0` mi =
3.0 work + 2.2 warmup/cooldown + 0.8 recovery jog.

**Weekly mileage accuracy is unchanged from `main`** — diffed the 225-week sweep against a stashed
baseline: 40 weeks off target both before and after, worst 4.3 → 4.4 mi. No regression.

**Levi's second symptom (week-1 total reading low) IS the stale-program issue** — `overheadMiles` /
`recoveryMiles` are stored fields, absent on programs generated before `7bdebf6` (08-03). Recalculate.

## 2. 🔴 Race weeks under-reported themselves (FIXED, found while verifying #1)

`reconcileWeekVolume` returned early for A/B race weeks **before** `stampRunOverhead`, so every
athlete's final week reported WORK miles only and undercounted against every other week. Race weeks
now get their overhead stamped while the taper prescription stays untouched.

Also: a run the AI omitted in a race week survived as its placeholder — **"Easy run — 0 min @ /mile
— 0 miles"** on the calendar in the most important week of the program. Those (and only those) are
now sized to the run type's own minimum. Sweep: **719 runs, 0 zero-distance / empty-pace.**

## 3. 🏋️ Strength: the ~46-sets-in-one-day problem (FIXED — Levi chose "cap AND spread")

A pattern trained once a week received its **whole** weekly target on that day. Real generated week,
advanced, 6 days: `Bench 10×8-10 / OHP 10×8-10 / Row 10×8-10 / Pull-Up 10×8-10` = **40 working sets**
against the 45-minute working block a strength session is billed at. **4.4 of the 7 patterns were
trained only once a week** — the common case, not a corner case.

Two-part fix, ordered — spread first, cap second:
- `spreadPatternSessions()` (strength.ts) gives every pattern a **second lift day** where the split
  allows, respecting `liftType` (`acceptsPattern` — a lower pattern never lands on an upper day).
  Same weekly sets, twice the practice, each session recoverable.
- `MAX_SESSION_SETS_PER_PATTERN = 6` and `MAX_SESSION_WORKING_SETS = 24` as backstops.
  `splitWeeklySets()` spills capped surplus onto sessions with headroom before dropping it;
  `capSessionWorkingSets()` MOVES sets to a lighter session training the same pattern.
  24 chosen so 3 lift days × 24 = 72 slots ≥ the heaviest weekly demand (advanced 7 × 10 = 70).

Audit, 450 lift-weeks:

| metric | before | after |
|---|---|---|
| worst single lift session | **40 sets** | **24** |
| patterns trained once/week | **4.4 of 7** | **0** |
| sessions over the 24-set ceiling | — | **0** |
| weeks hitting target on EVERY pattern | 100%* | **77%** |
| pattern-weeks short | — | 19%, avg **exactly 1 set** |

\* "100%" before was only true because the target was dumped into one unfinishable session.

**Refactor:** the volume passes moved from `assemble.ts` into `lib/engine/strength.ts`
(`PATTERN_HOME`, `acceptsPattern`, `spreadPatternSessions`, `capSessionWorkingSets`,
`applyWeeklySetVolume`) on a structural `VolumeSession` interface, so the triathlon builder can
share them without a circular import.

## 4. 🏊 Triathlon lifts now get the 6/8/10 rule (DONE)

`buildTriProgramData` / `triWeekToProgramWeek` / `rebuildTriWeek` take `liftingExp`;
`triWeekToProgramWeek` runs `spreadPatternSessions` + `applyWeeklySetVolume` over the week's lift
sessions. **Only `sets` is rewritten** — tri-specific patterns, rep ranges and emphasis are
untouched, so triathlon lifts deliberately still do NOT go through `applyStrengthSchemes`.
`generate-program.ts` passes `input.profile.liftingExp`; `rebuildTriWeek` reads it off the engine
input it already had.

## 5. 💪 `chest_fly` added as the 8th movement pattern (DONE — Levi's list had 8, the engine had 7)

`MovementPattern` enum + `REQUIRED_MOVEMENT_PATTERNS` + `PATTERN_HOME` (upper) + `EXERCISE_AB`
(Dumbbell / Cable Chest Fly). It is an **isolation** movement, so `patternEmphasis` forces
`endurance` (high-rep) on every lift type — like the lunge, for the opposite reason. Prompt updated
to "all 8 movement patterns"; **prompt-oracle snapshot regenerated** (intended — the AI has to know).
Golden-HYROX skeleton snapshot untouched: patterns are assembly-level.

---

## 🔴 OPEN — needs Levi's decision (the one blocker)

**Cardio volume vs. what a day can hold.** Levi's answer: *"Stick to the volume model cardio
prescription (1116) but add in more sessions. There will need to be multiple workouts per day
sometimes."*

**The arithmetic says raising the session count alone does nothing — the DAY CAP is what binds.**

Worst case in the audit — advanced, highly-trained, **3 training days**, week 11:

```
prescribed cardio          1116 min  (18.6 hours)
+ 3 lifts x 60                180 min
= total                      1296 min over 3 days = 432 min/day = 7.2 hrs/day
current advanced day cap      240 min/day
```

That day already carries **five** sessions (385 min) — so the 2-session limit is not the constraint;
`caps.day` is. To honour 1116 the advanced day cap has to roughly **double, 240 → ~432**.

And the reason 3-day athletes blow up: **the volume model is calibrated to ~6 training days.**
A 6-day athlete's peak week is 1260 cardio + 180 lift = 1440 / 6 = **exactly 240/day**, the current
cap. Every day fewer compresses the same weekly volume into fewer days.

**Question for Levi: what should the day cap become, and should it scale with training-day count?**

Also relevant: clamping `targetCardioMinutes` to capacity **at the skeleton** breaks the
golden-HYROX byte-identical gate (it clips the 6-day golden athlete's peak weeks at 1260). That is
why only the reconciler-level guard shipped.

**What DID ship:** `weekCardioCapacity(days, caps, avoidDays)` in reconcile.ts + a clamp so the
reconciler won't chase a target the days cannot hold. Honest, golden gate intact, but **near enough
a no-op** (156 → 159 weeks under target of 450). The real fix is the day-cap decision above.

## 🟡 LATENT — pre-existing, not touched

- **`assignDays` stacks sessions past the caps.** The worst audit week put **5 sessions / 385 min**
  on one Monday for a 3-day athlete. The 2-per-day rule is enforced in the reconciler's FILLER
  placement, not in the skeleton's day assignment.
- **60 cardio blocks over 120 min** (worst 575) still come from the "pile the overflow onto the last
  block" fallback. Same root cause as the open item above.
- ~40% of weeks land under `targetCardioMinutes` — unchanged, and it is the same story.
- `applyPostBRaceRecovery` still bluntly rearranges the front of the week after a B race.

## ▶️ NEXT UP — per-workout Strava card + description (NOT STARTED, but SCOPED)

**Levi answered all three queued questions this session:**
1. **Content** → plan, swapping to **actuals** once logged/linked.
2. **Delivery** → **copy to clipboard AND auto-write** onto the linked Strava activity via the
   existing `brandStravaActivity` path. ⚠️ needs `activity:write` scope — **Levi must reconnect
   Strava** — plus `STRAVA_WRITE_ENABLED`.
3. **Text source** → **engine-generated** deterministic summary.

Build per the previous handoff's shape: a pure `lib/program/session-summary.ts` deriving `cardData`
+ a multi-line `stravaDescription` from a `Session` (+ optional log/actuals + week/program context),
with `brandTagLine()` as the footer so branding stays idempotent. Render the launcher + a copy button
on **every** session row (today it only renders where `log?.status === "completed"`, week-card.tsx
~236 and ~544). The iOS app wraps the same Next UI, so one implementation covers app and website.

## Process notes

- **NEVER run `git add`/`commit`/`status` on the device from a cloud session.** Every git command
  leaves a `.git/index.lock` the bridge cannot unlink. `mv .git/index.lock _to_delete/x.bak` DOES
  remove it — that is the escape hatch, and it must be the last thing done after any git call.
- `git apply` on the device works fine and reports `unable to unlink` warnings that are harmless —
  the files are written correctly. Always md5-compare both sides afterward.
- Incremental patches: keep a `/tmp/base1` clone with each shipped patch committed, then
  `cp -r` the current `lib` over it and `git diff --cached` for the next one.
- `_to_delete/` now also holds `session-0804pm.patch`, `session2-0804pm.patch`,
  `session3-0804pm.patch`, `lock4.bak`, `lock5.bak`, `index.lock.bak2/3` — all junk.
- Deterministic engine audits without the AI remain the fastest way to find these:
  `assembleProgram(buildSkeleton(input), [], …)` with empty chunks. Every number in this handoff
  came from that, in seconds.
- Vercel: `fed63db` confirmed READY at session start; all three of the previous session's commits
  are live.
