# Duravel Handoff — 08-03-26 11:00am

Three things: the mileage/pace updates, the HR feedback loop's core, and one finding that needs a decision.

## 1. Mileage now counts warmup and cooldown

Cardio time already did — `sessionTiming` has always returned warmup + work + cooldown. Mileage did not: `sessionMiles` returned only `distanceMiles`, the work distance, so a 1-mile warmup and 1-mile cooldown were counted nowhere.

The two are now separate concepts:

- `sessionWorkMiles` / `weekWorkMileage` — the main set. **This is what the engine's mileage target reconciles against**, so counting the overhead does not quietly shrink anyone's quality volume. That was the athlete's explicit choice: raise the reported number, keep the work.
- `sessionMiles` / `weekMileage` — work plus warmup/cooldown distance. What the athlete actually runs, and what the weekly summary reports.

`RunSession.overheadMiles` carries the warmup/cooldown distance, stamped during reconciliation from the fixed overhead MINUTES at easy pace. Minutes stay the source of truth — session timing has always been built on them — and the distance is derived.

Rounding detail worth keeping: each leg is rounded separately and summed, so the counted mileage equals the two figures printed in the prescription. Rounding the combined minutes gave 2.4 against a printed 1.4 + 0.9 = 2.3, and a tenth-of-a-mile disagreement between the workout text and the total is exactly the kind of thing that generates support mail.

Four existing tests asserted `weekMileage === target`. They now assert `weekWorkMileage === target` and that the total is strictly greater. That is a deliberate semantic change, not a test bent to pass.

## 2. Warmup / cooldown / recovery now carry minutes, distance AND pace

Before: `Warm up: 1 mile easy (10-15 min)` — no pace, and a distance that disagreed with the timing model.

After:

    Warm up: 15 min easy (~1.4 mi) @ 10:33/mi with 3-4 short strides
    Work: 4 x 1km at 8:07/mi (5:02/km), with 5:00 of easy JOGGING between reps
          at 10:33/mi (jog, not walk — keep moving so your heart rate stays up)
    Cooldown: 10 min easy (~0.9 mi) @ 10:33/mi
    Work:rest 1:1 - your rest equals your work time.

Work:rest ratios are unchanged, per instruction.

## 3. HR feedback loop — the core

New `lib/engine/hr-calibration.ts`, pure and fully tested. It reads logged HR from quality sessions back against what was prescribed, and its lever is the PACE model — never the work:rest ratio.

### The trap it is built to avoid

A whole-session average HR is not comparable to the work-zone band. An interval session is ~15 min warmup, 20 min reps, 15–20 min recovery jogging and 10 min cooldown: only about a third is meant to be in Zone 5. Comparing its average against "175+ bpm" would report "under-shot" on every correctly-executed session, forever.

So a **peak** is judged against the work-zone floor, and an **average** against an EXPECTED average — the time-weighted blend of the zones the session actually prescribes. There is a test that demonstrates this rather than asserting a magic number: a session executed exactly to prescription reads `on_target` against the blend and `under` against the work floor.

### Guardrails

- Needs `MIN_SAMPLES` = 3 usable sessions before it will say anything.
- Suggested pace move capped at 3%, scaled by mean deviation.
- Deviation within 5 bpm counts as on-target.
- A single bad session averages out rather than firing the rule.

Direction: HR consistently BELOW target means the athlete is fitter than their 5K input implies → suggest faster paces / a re-test. Above target → paces too aggressive.

### On the reported session

Peaks of 170/175/175/180 against this athlete's own threshold-anchored Zone 5 floor of ~175: three of four reps in band, the first being the cardiac-lag ramp. There is a test pinning that. The competing read ("85% HRmax, below LT2") came from substituting a generic %HRmax scale for the threshold-anchored model the program actually uses — those disagree by roughly a zone.

### Not yet wired

The module is the decision core only. Still to do: read `avg_hr` / `max_hr` off linked wearable activities and `actuals.avgHr` off logs, feed them in, and surface the verdict in the existing adaptation review flow.

## 4. Finding that needs a decision — recovery time is uncounted

`durationMin` on an interval run is the REPS only. The between-rep recovery is in the description but in no total.

    prescribed:  15 warmup + 20 work + 10 cooldown  = 45 min
    actual:      15 + 20 reps + 15 recovery + 10    = 60 min

Three consequences: weekly cardio minutes under-count every interval and threshold session; the session cap is not a real cap (a "90 min" session can be 115); and the recovery jogging is running, so roughly 1.4 more uncounted miles.

Same class as the warmup/cooldown gap, and arguably larger. Not fixed — it changes weekly volumes again and deserves its own decision. `sessionHrShape` in the calibration module already computes the true structure, so the arithmetic is there when wanted.

## Verification

`vitest run` 822 tests passing. `tsc --noEmit` exit 0. `next build` exit 0. No snapshot movement.
