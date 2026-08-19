# Duravel handoff — 2026-08-19, 8:10am CT

Two commits made locally. **Neither is pushed and neither is verified live.**

```
d511e9a  adapt: off-plan extras count toward the weekly adjustment
7c178d9  hybrid: a low-volume week gets a hybrid it can afford
69830ac  (previous HEAD, = origin/main)
```

Working tree is clean apart from this file. Full suite green: **1179 tests, 113 files**,
`tsc --noEmit` clean against the real tsconfig, prettier clean on every touched file.

---

## 1. `7c178d9` — a low-volume week gets a hybrid it can afford

Levi's in-progress work from 08-17, finished and committed.

**The symptom.** Asking the engine for 4, 5 or 6 mi/week all produced the same 8.1 mi week — 8.1 was
just the sum of the two things that could not shrink, the hybrid and the long run.

**The rule.** Below `LOW_VOLUME_MILEAGE_THRESHOLD` (12 mi) the inter-station run legs get a mileage
budget, `HYBRID_LEG_BUDGET_SHARE` (20%) of the week. Shorten the legs first; drop couplets only once
the legs hit the 500 m floor. At or above 12 mi nothing changes.

**Finished this session:**

- **The budget is the WEEK's, divided by the number of hybrids in it.** It was being applied per
  session, and `h0_5` / `h10_20` / `h20_30` all schedule TWO hybrids — so those bands spent 40% of the
  week on legs alone and still handed 62% of their running to the hybrids at 11 mi. Race simulations
  are excluded from the divisor, since they are exempt from the budget.
- **`lib/generation/low-volume-week.test.ts`** — an end-to-end guard. Both new behaviours travel
  through OPTIONAL parameters with legacy defaults (`assignDays` → `buildRunSlots`, and
  `replaceHybrids` → `hybridRunPlan`), so dropping an argument leaves every unit test passing while
  the behaviour silently reverts. That is the liftType failure mode exactly.

**Measured against a pristine `main` clone (deterministic sweep, no AI):**

| | main | now |
|---|---|---|
| h5_10, start 4 / 5 / 6 / 7 mi | all 8.1 | 6.5 / 6.5 / 6.5 / 7.0 |
| hybrid share of a 1-hybrid week | 48% | 35% |
| hybrid share of a 2-hybrid week @ 11 mi | 65% | 42% |
| low-mileage weeks carrying a threshold run | 0 of 692 | 469 of 692 |
| weeks missing their mileage target (1440-week sweep) | 0 | 0 |

Snapshot blast radius: only the two `h0_5` blocks (HYROX + DEKA FIT). Golden HYROX oracle and prompt
oracle byte-identical.

**Two known warts, both deliberate:**

1. A cliff at the 12 mi boundary for 2-hybrid weeks — 3×500 m at 11.9 mi, 4×1000 m at 12.0. Removing
   the threshold entirely would smooth it but would move real programs.
2. At the very bottom the restored threshold run does not survive assembly: the skeleton plans
   `[threshold, interval, long]` and the reconciler drops all but the long run for lack of room. The
   week honestly carries no quality running at that size.

## 2. `d511e9a` — off-plan extras count toward the weekly adjustment

Reverses the 08-13 display-only decision.

Extras reached the week header's Actual line and nothing else. Safe for the CREDIT rules, wrong for the
LOAD rules: ACWR exists to catch a load spike, and a spike assembled out of self-added sessions was
invisible to the one metric whose job is seeing it — two hard extra sessions on an increase week and
the engine could still hand out an `earned_bump`.

`computeWeekSignals(week, logs, extras)` now folds extras into compliance, strain, session-RPE load,
the per-day buckets behind Foster monotony, and actual volume. `week-card` passes them into that same
call rather than adding them afterwards, so the card and the review screen cannot disagree; the
dashboard streak sees them too.

**Four limits hold:**

- compliance clamps at 100% — over-delivery surfaces as load, not as a percentage that reads as nonsense
- PLANNED totals never move
- key sessions stay planned-only: `protect_long_run` still asks about the PLANNED long run
- no RPE means no load

`adapt-week.ts` loads extras across the FULL ACWR window. Loading only the reviewed week would raise
acute load against a baseline that never counted extra work, so a consistent extra habit would read as
a fresh spike every week.

15 of the 22 new tests fail against pristine `main` on behaviour.

---

## Next

1. **`git push`** — both commits exist only on this machine.
2. Live-verify each: add an extra workout to a week and open the weekly review (the reason string
   should name it and the ACWR should move); generate a low-mileage program and read week 1.
3. The intensity-distribution decision is still open — the leg budget pulls the low end back but does
   not answer whether the hybrid should deliberately substitute for the quality run.
4. The standing "17% of weeks land over their mileage target" finding did not reproduce: a 1440-week
   sweep across four bands, three experience levels and eight starting mileages found zero over-target
   weeks on either `main` or the new code. Re-derive it from the original settings before spending
   time on it.
