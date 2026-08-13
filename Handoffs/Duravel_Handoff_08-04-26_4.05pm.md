# Duravel Handoff — 2026-08-04 4:05pm CT

## STATUS: FIVE patches APPLIED to the worktree, md5-verified, **NOT committed**. Base `fed63db`.

**881/881 vitest · `tsc` clean · golden-HYROX skeleton byte-identical.**
`.git/index.lock` cleared.

```
_to_delete/session-0804pm.patch    patch 1  quality-run reps + strength set ceiling
_to_delete/session2-0804pm.patch   patch 2  triathlon set volume + cardio capacity guard
_to_delete/session3-0804pm.patch   patch 3  chest_fly (8th pattern) + race-week placeholders
_to_delete/session4-0804pm.patch   patch 4  band session caps + Zone 1-2 cardio cap + 2/day enforced
_to_delete/session5-0804pm.patch   patch 5  day-count minimums + band hour ceiling + fewer/longer sessions
```

```
cd C:\dev\duravel
git add lib app
git commit -m "engine: honest session/day/band limits; quality-run reps follow distance; chest fly"
git push
```

⚠️ **All GENERATION-TIME. Existing programs need a RECALCULATE.**

---

## THE HEADLINE NUMBERS

840 non-taper weeks audited (5 bands × 3 experience × 2 class × 2 day-counts):

| invariant | before | after |
|---|---|---|
| sessions over their cap | **1 per week**, worst **1707 min (28 h)** | **0** |
| days with 3+ sessions | **29% of weeks**, worst **5 sessions / 6.4 h** | **0** |
| weeks exceeding the band's own hours | h20_30 → 32 h, h30_40 → **46 h** | **0** |
| weeks ≥15 min short of prescribed cardio | ~35% | **11.9%** (worst 492, all h30_40) |
| interval/threshold text ≠ stored distance | **87 of 87 (100%)**, worst 3.7 mi | **0** |
| worst single lift session | **40 working sets** | **24** |
| patterns trained once a week | 4.4 of 7 | **0** |

---

## 1. Levi's reported bug — threshold headline ≠ workout (FIXED, patch 1)

`INTERVAL_REPS`/`THRESHOLD_REPS` were fixed per-experience constants while `reconcile.ts` resized
`distanceMiles` to hit weekly mileage. Nothing reconciled them: the text said "3 × 1 mile" while the
stored distance was 1.8.

**Distance now drives reps.** `REP_DISTANCE_MILES` (interval = 1 km, threshold = 1 mile),
`repsForWorkMiles()`, `snapWorkMiles()` in `interval-structure.ts`. `setRunMiles()` snaps quality runs
to whole reps (the single place run distances are written). `redescribeQualityRuns()` (assemble.ts)
regenerates the how-to AFTER reconciliation. `recoveryMinutesForReps()` scales the jog to the real
rep count. **87 → 0 mismatches.** Weekly mileage accuracy verified unchanged vs a stashed `main`
baseline (40/225 weeks off target on both sides).

**Levi's second symptom (week-1 total low) is the stale-program issue** — `overheadMiles` /
`recoveryMiles` are STORED fields, absent pre-`7bdebf6`. Recalculate.

## 2. Race weeks (FIXED, patches 1 + 3)

`reconcileWeekVolume` returned early for A/B race weeks BEFORE `stampRunOverhead`, so every athlete's
final week reported work miles only. And an AI-omitted race-week run shipped as **"Easy run — 0 min @
/mile — 0 miles"**. Both fixed; sweep shows 719 runs, 0 zero-distance.

## 3. Strength (FIXED, patches 1 + 3)

`spreadPatternSessions()` gives each pattern a second lift day where the split allows;
`MAX_SESSION_SETS_PER_PATTERN = 6` and `MAX_SESSION_WORKING_SETS = 24` are backstops.
Volume passes moved into `lib/engine/strength.ts` on a structural `VolumeSession` interface so
triathlon can share them without a circular import. **Triathlon lifts now get 6/8/10** (sets only —
tri rep ranges/emphasis untouched). **`chest_fly` added as the 8th pattern**, forced to `endurance`
on every lift type (isolation movement). Prompt updated to "all 8"; prompt-oracle snapshot regenerated.

## 4. Session / day / band limits (FIXED, patches 4 + 5)

- **2 sessions a day is now actually enforced.** It never was.
- **Band-driven caps** (`lib/engine/caps.ts`): general session 10-20h → 120, 20-30h → 150, 30-40h → 180.
- **Zone 1-2 cardio has its OWN higher cap** (`BAND_CARDIO_SESSION_MINUTES`): 5-10h → 150, 10-20h →
  180, 20-30h → 240, 30-40h → 300. `TrainingCaps.cardioSession`; `day = session + cardioSession`.
- **Overflow is bounded.** `planFiller`'s last resort was `plan[last].minutes += overflow` commented
  "unavoidable" — that is how a week shipped a single **1707-minute** block. Now capped, remainder
  dropped, week lands honestly short.
- **`BAND_MIN_TRAINING_DAYS`** = 0-5h → **4**, 5-10h → **5**, 10+h → **7**. Validated client-side
  (`onboarding-form.tsx`) and server-side (`onboarding/actions.ts`).
- **`BAND_MAX_WEEKLY_MINUTES`** — the progression can no longer exceed the band the athlete chose.
  `clampCardioToBand()` in skeleton.ts clamps cardio to `bandMax − liftMinutes`.
- **Fewer, longer sessions**: `BAND_SESSION_CAP` (weekly NON-CARDIO session budget) 20-30h 10 → **8**,
  30-40h 12 → **8**. That frees slots for long Zone 1-2 blocks. h20_30 went from **441 min short to 22**.

Guarded by the new `lib/generation/session-legality.test.ts`.

---

## 🔴 OPEN — the one remaining decision

**h30_40 still lands ~490 min short in peak weeks** (2160 prescribed, 1668 delivered). Everything else
is clean. The diagnosis is exact:

Week 11, intermediate, 7 days, h30_40 — `targetMileage 84.9 mi`, `targetCardioMinutes 2160`:

```
SKELETON plans 8 sessions (the band budget): 3 runs + 4 lifts + 1 hybrid
Runs max out at maxMiles(caps.session = 180 min) ~= 20 mi each -> 60 mi
targetMileage is 84.9 -> the reconciler ADDS 3 easy-run sessions for the other 25 mi
That fills all 14 slots: only 3 remain for Zone 1-2, at the 300-min cap = 900 min
Cardio needed after runs: ~1396. Short ~490.
```

**The runs are eating the slots the long aerobic blocks need.** Two ways out — Levi's call:

- **(a) Give the long run a bigger cap at 30-40h** (e.g. 240 min), so fewer run sessions carry the
  same mileage.
- **(b) Scale `targetMileage` DOWN at the top bands** so the extra hours ride in low-impact Zone 1-2
  instead. 84.9 mi/week of running is already very high for a HYROX athlete; (b) is the more
  defensible training answer.

Related, still worth asking: **should 30-40h even be offered for HYROX/DEKA?** At 14 sessions a week
it implies three-hour runs. That band may belong to triathlon only.

## 🟡 LATENT

- `assignDays` can still place sessions without consulting the caps — the 2/day rule is enforced
  downstream, not at assignment. Worth moving upstream.
- `applyPostBRaceRecovery` still bluntly rearranges the front of the week after a B race.
- Legacy programs (no `weeklyHours`) bypass every band rule on recalculate. `weeklyHours` is required
  for new/edited programs but optional in the schema so old snapshots parse. Consider back-filling a
  band from the stored volume.

## ▶️ NEXT UP — per-workout Strava card + description (NOT STARTED, FULLY SCOPED)

All three questions answered this session:
1. **Content** → plan, swapping to **actuals** once logged/linked.
2. **Delivery** → copy to clipboard **AND** auto-write onto the linked Strava activity via
   `brandStravaActivity`. ⚠️ needs `activity:write` — **Levi must RECONNECT Strava** — plus
   `STRAVA_WRITE_ENABLED`.
3. **Text** → engine-generated deterministic summary.

Build a pure `lib/program/session-summary.ts` deriving `cardData` + a multi-line `stravaDescription`
from a `Session` (+ optional log/actuals + week/program context), with `brandTagLine()` as the footer
so branding stays idempotent. Render the launcher + a copy button on **every** session row (today it
only renders where `log?.status === "completed"`, week-card.tsx ~236 and ~544). The iOS app wraps the
same Next UI, so one implementation covers app and website.

## Process notes

- **NEVER run any git command on the device from a cloud session.** Each one leaves a
  `.git/index.lock` the bridge cannot unlink. `git apply` is worth the trade; clear the lock with
  `mv .git/index.lock _to_delete/x.bak` as the LAST step every time.
- Incremental patches: keep a `/tmp/base1` clone, commit each shipped patch into it, `cp -r` the
  current `lib`/`app` over, then `git diff --cached`.
- Deterministic audits (`assembleProgram(buildSkeleton(input), [], …)` with empty chunks) produced
  every number in this handoff, in seconds. Always diff against a stashed `main` baseline before
  calling something a regression — I did that twice today and it prevented two false alarms.
- `_to_delete/` now also holds `session-`…`session5-0804pm.patch` and `lock4-7.bak` — all junk.
