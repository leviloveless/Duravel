# Duravel — Multi-Discipline Cardio Composition Spec (v2)

**Status:** Draft for review · **Date:** 2026-07-18 · **Owner:** Levi
**Companion to:** *Duravel — Multi-Sport Strength Architecture Spec (v4)*
**Scope:** Extend the engine from a single running discipline (+ an
undifferentiated cross-training bucket) to **swim / bike / run as first-class
disciplines**, with per-discipline volume, pacing, zones, and brick sessions —
so the **triathlon race types (Olympic / 70.3 / 140.6)** can actually generate.
Reuses the existing Base → Build → Peak → Taper skeleton and microcycle math
unchanged.

> **v2 change:** the à-la-carte general-fitness modality mode was removed from the
> companion strength spec (archived, not implemented). This spec is now scoped to
> **race-based** program types only — triathlon needs the discipline machinery
> below; HYROX and DEKA keep running + cross-training + hybrid as today.

> The strength spec owns the barbell side; **this spec owns the aerobic side.**
> Together they cover every program type in Duravel. HYROX and the DEKA family
> are unaffected — they keep running + cross-training + hybrid exactly as today.

---

## 1. The problem

Today (`skeleton.ts` → `reconcile.ts`) the engine models endurance as:

- one weekly **running mileage** target + one **total cardio-minutes** target,
  progressed by the microcycle engine;
- running sized to the mileage target at Daniels **VDOT** paces
  (`paces.ts`, running only);
- **everything else** poured into a single generic *"Zone 1–2 cross-training
  (bike / row / ski / elliptical)"* block to top up the minutes.

There is no swim distance, no bike power/volume, no discipline-specific pacing or
zones, and no brick. **A triathlete's plan can't be built from this** — the swim
and bike legs have nowhere to live, so tri programs would degenerate into a run
plan with cross-training filler.

---

## 2. Invariants preserved

1. **Base → Build → Peak → Taper**, Base largest (`mesocycles.ts`).
2. **Microcycle progression** (rebound/increase/deload; masters 3-week) drives
   volume — we progress a **total endurance load** and split it, rather than
   inventing a second progression engine.
3. **Engine owns the numbers; AI fills content.**
4. **Backward compatibility:** a running-only athlete (HYROX/DEKA/run-only)
   resolves to today's running + cross-training output.

---

## 3. Core model — one budget, split by discipline, expressed in native units

Three steps, each reusing something that already exists:

1. **Total endurance budget (minutes).** The microcycle engine already
   progresses `targetCardioMinutes` per week (`volume.ts`,
   `sequenceMicrocycles`). Keep it as the master aerobic-time budget.
2. **Discipline split.** Multiply the weekly budget by the program type's
   **discipline-share weights** (§5) → per-discipline weekly minutes
   (swimMin / bikeMin / runMin / …).
3. **Native units + sessions.** Convert each discipline's minutes to its native
   prescription via that discipline's pace model (§4): run → miles at VDOT pace
   (today's path), bike → distance/power at FTP zones, swim → yards/meters at CSS
   pace. Then place sessions and size them to hit each discipline's minutes
   exactly (a per-discipline generalization of `reconcileWeekVolume`).

Running **mileage** becomes a *derived* display value (runMin ÷ run pace), not
the master unit — this is the one conceptual change, and it's what lets swim and
bike (which have no "miles" in the running sense) sit alongside running under one
progressed budget.

---

## 4. Disciplines and their intensity models

| Discipline | Native unit | Intensity model | Benchmark source |
|---|---|---|---|
| **run** | miles | Daniels **VDOT** (existing `paces.ts`) | mile / 5K / 10K |
| **bike** | minutes + distance/power | **FTP** power zones; fallback HR; fallback RPE | 20-min power test (→ FTP = 95%); fallback assault-bike cals already collected |
| **swim** | meters/yards | **CSS** (critical swim speed), pace per 100 | 400 m + 200 m (or 100 m) TT |
| **cross-training** | minutes | Zone 1–2 only (existing generic block) | — |
| **hybrid** | (HYROX) | threshold runs + stations (existing) | — |
| **brick** | composite | bike leg (FTP) → run leg (VDOT, compromised) | §6 |

Notes:
- **Bike FTP zones** (Coggan): Z1 <55%, Z2 56–75%, Z3 76–90%, Z4 91–105%, Z5
  >106% of FTP. Map to the app's 5-zone HR model for display parity.
- **Swim CSS**: `CSS = (400m − 200m distance) / (t400 − t200)`; prescribe easy/
  threshold/interval swim as offsets from CSS pace/100. Fallback: effort/RPE +
  stroke-rate cue when no TT on file.
- **Compromised run pace** (off the bike) runs ~15–30 s/mi slower than fresh VDOT
  pace — used for the run leg of bricks and for the tri run discipline's race
  pace (the strength spec's economy work supports this).

---

## 5. Discipline-share tables (fraction of the weekly endurance-minute budget)

Training-time shares (bike-dominant, as real tri training is), tunable:

| Program type | Swim | Bike | Run | Notes |
|---|---|---|---|---|
| **tri_olympic** | 20% | 45% | 35% | shorter/faster; run share highest of the tri set |
| **tri_70_3** | 18% | 52% | 30% | bike-dominant |
| **tri_140_6** | 15% | 55% | 30% | most bike volume; long-ride centric |
| **HYROX / DEKA** | — | — | 100% run | endurance = running only (+ Z1–2 cross-training filler + hybrid); the split is a no-op — today's path |

Shares shift slightly by phase: **Base** leans a touch more to bike/swim
(low-impact aerobic volume is cheap); **Peak** shifts toward race-specific
balance and adds bricks. Long-course keeps one weekly **long ride** and **long
run** that dominate their discipline's minutes.

---

## 6. Brick sessions

A **brick** = bike leg immediately followed by a run leg, training the
neuromuscular transition and compromised running that define triathlon.

- **Programming:** introduced in **Build**, emphasized in **Peak**; one per week
  for Olympic, building to long race-simulation bricks for 70.3 / 140.6.
- **Structure:** bike at race-effort (Z3–4 / FTP sweet-spot to threshold) → run
  off the bike at compromised race pace. Peak bricks rehearse race proportions.
- **Accounting:** the brick's bike and run minutes count toward each discipline's
  budget; the run leg uses compromised pace (§4).
- **Slot:** a new composite session kind placed by `slots.ts` on a
  low-interference day (never the day before a key long ride/run).

---

## 7. Zones per discipline + the modality-HR offset

The current zone budget (20/60/10/5/5) mixes running and station HR at equal
effort, which the Training-Science Review flagged. Fix for multi-discipline:

- **Track zone distribution per discipline**, then sum — don't assume one HR
  curve across modalities.
- Apply a **modality HR offset** at equal metabolic effort (approx., tunable):
  run 0 (reference) · **bike −5 to −8 bpm** · **swim −10 to −15 bpm** · row/ski
  −5. So a "Zone 2" bike sits at a lower bpm than a Zone 2 run.
- Keep the **80/20 easy:hard** intensity distribution as the whole-program target
  (Seiler); swim and bike can carry extra Z2 volume cheaply (low impact), which
  is *why* their shares are high — it builds the aerobic engine without the
  injury cost of equivalent run volume.

---

## 8. Session schema additions (`schemas.ts`)

Extend the `Session` discriminated union (all additive; existing kinds
untouched):

```ts
SwimSessionSchema  = { kind:"swim",  durationMin, distanceMeters, pacePer100, goalZone, focus? }
BikeSessionSchema  = { kind:"bike",  durationMin, distanceMiles?, powerTarget?, goalZone, indoor? }
BrickSessionSchema = { kind:"brick", bike: BikeLeg, run: RunLeg, goalZone, simulation? }
```

`weekCardioMinutes` / `sessionTiming` (`session-volume.ts`) extend to count swim,
bike, and brick minutes toward the cardio total (weightlifting still excluded).

---

## 9. Benchmarks to collect (`BenchmarksSchema`)

Add optional inputs so the discipline models have anchors (all optional →
graceful RPE fallback):

- **Swim:** 400 m time + 200 m (or 100 m) time → CSS.
- **Bike:** 20-min power (watts) → FTP; or FTP directly. (Existing
  `bike20MinCals` stays for the HYROX assault-bike need but isn't a cycling FTP.)

These also feed a future **needs analysis** extension (swim/bike engine scores)
paralleling the existing run/erg/strength domains — noted, not required for v1.

---

## 10. Discipline-aware taper

The existing A/B/C taper (`taper.ts`) cuts total volume; for triathlon, cut each
discipline but **protect swim technique** (swim volume drops least — feel is lost
fastest), trim **bike** volume most (biggest fatigue source), and keep short
race-pace **run** touches. Intensity stays near race effort until the final days
(existing philosophy). This is a per-discipline weighting on the same taper
factors, not a new taper.

---

## 11. Integration — code changes (additive, backward-compatible)

| File | Change |
|---|---|
| `lib/schemas.ts` | Swim/Bike/Brick session schemas; extend `Session` union; add swim/bike benchmarks; add `disciplineShares` carry-through. |
| `lib/engine/disciplines.ts` *(new)* | Discipline definitions, per-sport **share tables** (§5), phase share shifts, modality HR offsets, brick rules. |
| `lib/engine/paces.ts` | Add **bike FTP zones** + **swim CSS** pace derivation alongside VDOT (keep VDOT path identical). |
| `lib/engine/volume.ts` / `microcycles.ts` | Master budget stays cardio-minutes; add the discipline split (minutes × share). No change to the progression math. |
| `lib/engine/skeleton.ts` | Carry **per-discipline weekly minute targets** on `WeekSkeleton`; apply per-discipline long-session + minimum constraints. |
| `lib/engine/slots.ts` | Place swim/bike/brick slots by discipline frequency; brick in Build/Peak; interference-aware day placement. |
| `lib/generation/reconcile.ts` | Generalize the run-only reconciler into a **per-discipline reconcile**: size each discipline to its minute target in native units; generic cross-training remains the make-up for any residual Z1–2 gap. |
| `lib/zones.ts` | Per-discipline zone bands + modality HR offset; per-discipline distribution accounting. |
| `lib/session-volume.ts` | Count swim/bike/brick toward cardio minutes. |
| `lib/ai/philosophy.ts` | Swim/bike/brick session guidance; tri phase character; discipline-share hints. |

**Guarantee:** a program whose only endurance discipline is running (HYROX, DEKA,
run-only) resolves to today's exact output — the discipline split is a no-op at
100% run.

---

## 12. Backward compatibility & unaffected sports

- **HYROX / DEKA:** unchanged. They already use running + hybrid + the generic
  Z1–2 cross-training block; none of the new discipline machinery activates
  unless swim/bike shares are non-zero.
- **Existing single-5K users:** VDOT path is byte-for-byte preserved.

---

## 13. Interference with the strength spec (triathlon)

The strength spec's concurrent-training guardrails hold across disciplines: heavy
lifts sit ≥6 h (ideally ≥24 h) from each discipline's key session, and **bricks
and long rides/runs count as key sessions** for that spacing. Triathlon carries
the lowest strength dial (`tri_*` profiles) precisely so lifting protects, rather
than competes with, the aerobic work. Strength volume is unchanged by this spec;
it only informs day placement. (The archived à-la-carte modality mode is out of
scope — see strength spec Appendix A.)

---

## 14. Open decisions

1. **Master unit:** confirm moving the master budget from *mileage* to
   *cardio-minutes* (mileage becomes derived). Cleaner for multi-discipline;
   slightly changes how run-only volume is expressed internally (output identical).
2. **Discipline shares:** are the §5 tri splits (e.g., 15/55/30 for 140.6) the
   right starting defaults, or do you want to set them from your own athletes'
   data?
3. **Bike intensity anchor:** FTP power (needs a power meter / smart trainer) as
   primary, HR fallback — acceptable, or HR-first given equipment assumptions?
4. **Swim benchmarks:** require 400 m + 200 m TT for CSS, or start effort/RPE-only
   and add CSS later?
5. **Needs analysis:** extend limiter detection to swim/bike engine scores now, or
   defer (v1 runs neutral for those disciplines)?
6. **New program types vs. flags:** ship `tri_olympic` / `tri_70_3` / `tri_140_6`
   as distinct program types (matches the strength spec), confirmed.

---

## 15. References

Daniels VDOT pace model (implemented in `paces.ts`): Daniels, *Daniels' Running
Formula*. Cycling FTP/power zones: Allen & Coggan, *Training and Racing with a
Power Meter*. Critical swim speed: Wakayoshi et al. 1992 (CSS validation).
80/20 intensity distribution: Seiler 2010; Stöggl & Sperlich 2014. Concurrent
training / interference (shared with the strength spec): Coffey & Hawley 2017;
Robineau et al. 2016.
