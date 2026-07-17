# Duravel — Triathlon Sport-Family Build Spec (Ironman 70.3 & 140.6)

**Author:** Claude (senior-engineer build spec), for Levi
**Date:** 2026-07-16
**Status:** Implementation-ready. Maps the Triathlon family (Family B) onto the locked P0 abstraction contract.
**Conforms to:** `/tmp/duravel-P0-abstraction-design.md` (the `SportConfig` / `ProgramType` interface).
**Consistent with & references:** `docs/future-phases/01-triathlon-engine.md` (owns DB schema, discipline vocab, benchmark RPC, generation queue, load ladder §5.4/§8, brick data-model). This doc owns the **engine `SportConfig`/`ProgramType` mapping + tiering + distance numbers**; it does not restate or contradict the DB/queue/RPC detail there.
**Source data:** `/tmp/research-triathlon.md` (all numeric anchors), `/tmp/duravel-multisport-spec.md` §3.7/§3.8/§4.

> **Reading guide.** §1 gives the two concrete `SportConfig` literals. §2 is the `race_peaking`-for-Family-B control flow (per-discipline volume → TSS, bricks, discipline-balance shift, caps/taper). §3 flags every place the P0 interface must be extended for triathlon. §4 finalizes experience tiering. §5 is the 140.6 beginner duty-of-care gating rule. §6 is the vitest plan + open questions.
>
> **Naming.** `SportId` values are `tri_70_3` and `tri_140_6` (from P0 §2.1). `family = "triathlon"`. `programType = "race_peaking"`. Disciplines use the canonical vocab from 01-triathlon-engine §3.0: `swim | bike | run | brick`.

---

## 0. Scope & the one-paragraph mental model

Triathlon is **Family B**: it breaks the two HYROX assumptions the engine was born with — (1) one volume currency (running miles + cardio minutes) and (2) the `run|lift|hybrid` session spine. Family B replaces (1) with a **per-discipline hours ledger reconciled to a single TSS load currency** and (2) with the `swim|bike|run|brick` modality set. Everything else in the deterministic core — mesocycle allocation (`mesocycles.ts`), microcycle 3:1/2:1 progression (`microcycles.ts`), taper math (`taper.ts`), HR-zone resolution (`zones.ts`), needs/limiter relative-gap detection (`needs.ts`), the engine-owns-numbers/AI-fills-content boundary — is reused. `tri_70_3` and `tri_140_6` are two `SportConfig` literals over the **same** `race_peaking` Family-B behavior; they differ only in data (program length, hours, discipline splits, caps, taper length, intensity tilt, fueling gates).

---

## 1. `SportConfig` literals

These conform to the P0 `SportConfig` interface (P0 §2.1). Fields that require a **P0 interface extension** are marked `⟨EXT-n⟩` and defined precisely in §3. Where P0 already has a field, the literal fills it directly.

### 1.0 Shared Family-B sub-config building blocks

Authored once in `lib/engine/sports/triathlon/shared.ts`, referenced by both literals so 70.3/140.6 differences are explicit deltas, not copy-paste.

```ts
// lib/engine/sports/triathlon/shared.ts
import type { Discipline } from "@/lib/domain/disciplines"; // "swim"|"bike"|"run"|"brick" (01-tri §3.0)

export const TRI_MODALITIES = ["swim", "bike", "run", "brick", "strength", "rest", "race"] as const;
// strength optional (durability/injury-prevention, 1×/wk, opt-in); rest/race always valid (P0 §2.1).

/** CSS pace-offset zones (sec/100m relative to CSS). research §"Key sessions/swim". ⟨EXT-4⟩ */
export const SWIM_CSS_ZONE_OFFSETS = {
  z1_easy:   { loSec: +8,  hiSec: +12 }, // recovery / easy aerobic
  z2_steady: { loSec: +6,  hiSec: +8  }, // aerobic endurance (majority)
  z3_mod:    { loSec: +4,  hiSec: +6  }, // moderate / "steady-strong"
  z4_thresh: { loSec:  0,  hiSec: +2  }, // CSS = threshold
  z5_vo2:    { loSec: -6,  hiSec: -4  }, // above CSS
} as const;

/** Bike power zones as %FTP (Coggan). research §"Key sessions/bike". ⟨EXT-4⟩ */
export const BIKE_FTP_ZONES = {
  z1: { loPct: 0,   hiPct: 55  },        // active recovery
  z2: { loPct: 56,  hiPct: 75  },        // endurance (long ride)
  z3: { loPct: 76,  hiPct: 90  },        // tempo; sweet-spot = 88–94 (primary FTP builder)
  z4: { loPct: 91,  hiPct: 105 },        // threshold / FTP intervals
  z5: { loPct: 106, hiPct: 120 },        // VO2 (more 70.3-relevant)
  z6: { loPct: 121, hiPct: 150 },        // anaerobic (rare in long course)
} as const;
export const BIKE_SWEETSPOT = { loPct: 88, hiPct: 94 } as const;

/** Representative IF per (discipline × zone) used to convert prescribed hours → target TSS.
 *  IF = intensity factor; TSS = 100 × hours × IF². Center of the zone's sustainable IF. ⟨EXT-3⟩ */
export const ZONE_IF: Record<Exclude<Discipline, "brick">, Record<1|2|3|4|5, number>> = {
  swim: { 1: 0.62, 2: 0.72, 3: 0.85, 4: 0.98, 5: 1.05 }, // IF = swimSpeed/CSSspeed
  bike: { 1: 0.50, 2: 0.65, 3: 0.83, 4: 0.98, 5: 1.10 }, // IF = NP/FTP
  run:  { 1: 0.62, 2: 0.72, 3: 0.85, 4: 0.98, 5: 1.06 }, // IF = threshSpeed/actualSpeed (rTSS)
};

/** hrTSS / RPE fallback calibration (load ladder rungs 5–6, 01-tri §5.4). ⟨EXT-3⟩ */
export const LOAD_FALLBACK = {
  hrTSS_if_by_zone: { 1: 0.60, 2: 0.72, 3: 0.85, 4: 0.97, 5: 1.05 }, // IF from HR vs threshold HR
  rpe_to_if: (rpe1to10: number) => 0.55 + 0.05 * rpe1to10, // RPE6→0.85, RPE10→1.05; ×duration→TSS
} as const;
```

### 1.1 `tri_70_3`

```ts
// lib/engine/sports/triathlon/tri_70_3.ts
import type { SportConfig } from "@/lib/engine/sports/types";
import { TRI_MODALITIES, SWIM_CSS_ZONE_OFFSETS, BIKE_FTP_ZONES, ZONE_IF } from "./shared";

export const tri_70_3: SportConfig = {
  id: "tri_70_3",
  family: "triathlon",
  displayName: "Ironman 70.3",
  programType: "race_peaking",

  modalities: [...TRI_MODALITIES], // swim|bike|run|brick|strength|rest|race

  // ── Per-discipline, per-phase session COUNTS by run/experience level. ⟨EXT-1⟩
  // Indexed [beginner, intermediate, advanced]. Totals honor research workouts/wk:
  // 70.3 beg 6–8, int 7–9, adv 9–11. (research §"Weekly volume".)
  sessionCounts: {
    swim:  { base: [2,2,3], build: [2,2,3], peak: [2,2,3], taper: [1,2,2] },
    bike:  { base: [2,3,3], build: [2,3,3], peak: [2,3,3], taper: [2,2,2] },
    run:   { base: [3,3,3], build: [3,3,4], peak: [3,3,4], taper: [2,3,3] },
    brick: { base: [0,0,1], build: [1,1,1], peak: [1,1,2], taper: [0,0,0] },
    strength: { base: [1,1,1], build: [1,1,1], peak: [0,1,1], taper: [0,0,0] }, // opt-in
  }, // e.g. adv Build = 3+3+4+1(+1) = 11/wk ✓

  // ── Per-discipline zone distribution per phase (5-zone; engine ZoneDistribution). ⟨EXT-2⟩
  // Base polarized → Build/Peak pyramidal. Run kept most easy; bike carries the Z3 sweet-spot
  // block in Build; swim tolerates the most threshold. (research §"Intensity distribution".)
  disciplineZoneTargets: {
    swim: {
      base:  { z1: 20, z2: 55, z3: 12, z4: 8,  z5: 5 },
      build: { z1: 15, z2: 50, z3: 15, z4: 12, z5: 8 },
      peak:  { z1: 15, z2: 48, z3: 15, z4: 14, z5: 8 },
      taper: { z1: 18, z2: 52, z3: 14, z4: 10, z5: 6 },
    },
    bike: {
      base:  { z1: 20, z2: 62, z3: 8,  z4: 6,  z5: 4 },
      build: { z1: 15, z2: 50, z3: 20, z4: 10, z5: 5 }, // sweet-spot heavy (z3)
      peak:  { z1: 15, z2: 54, z3: 18, z4: 9,  z5: 4 }, // + some VO2 (70.3-relevant)
      taper: { z1: 18, z2: 57, z3: 13, z4: 8,  z5: 4 },
    },
    run: {
      base:  { z1: 25, z2: 65, z3: 6,  z4: 3,  z5: 1 },
      build: { z1: 20, z2: 66, z3: 9,  z4: 4,  z5: 1 },
      peak:  { z1: 18, z2: 67, z3: 11, z4: 3,  z5: 1 }, // race-pace tempo/brick
      taper: { z1: 20, z2: 66, z3: 9,  z4: 4,  z5: 1 },
    },
  },
  // P0 `phaseZoneTargets?` (whole-program single distribution) is left UNSET for tri;
  // the per-discipline table above supersedes it. ⟨EXT-2⟩

  // ── Discipline-balance splits (% of weekly training TIME) by phase. ⟨EXT-5⟩
  // 70.3 practical band S20–30 / B45–50 / R25–30 (research §"Discipline balance").
  disciplineBalance: {
    base:  { swim: 27, bike: 46, run: 27 }, // most balanced
    build: { swim: 22, bike: 51, run: 27 }, // bike share peaks (runs → bricks)
    peak:  { swim: 18, bike: 48, run: 34 }, // run up, swim trimmed first
    taper: { swim: 20, bike: 47, run: 33 }, // hold peak shape; cut run volume least
  }, // brick minutes are attributed to their segments (bike+run) during reconciliation (§2.2).

  // ── Volume: hours/wk by level, base→peak shape, + traditional/time-crunched toggle. ⟨EXT-6⟩
  volume: {
    currency: "discipline_tss", // NOT miles+minutes. ⟨EXT-6⟩
    hoursByLevel: {              // {baseHours, peakHours}; base≈65% of peak internally
      beginner:     { baseHours: 6,  peakHours: 10 }, // research 70.3 beg 5–10, peak 10–16
      intermediate: { baseHours: 8,  peakHours: 13 },
      advanced:     { baseHours: 10, peakHours: 15 },
    },
    peakVolumeMode: "traditional", // toggle unused for 70.3 (single value); present for parity
    phaseShape: { base: 0.65, build: 0.85, peak: 1.0 }, // × peakHours, before 3:1 micro modulation
    rampCapPctPerWeek: { swim: 12, bike: 10, run: 8 },   // run most conservative (research §caps)
  },

  // ── Pacing / zones config (per-discipline benchmark → zone math). ⟨EXT-4⟩
  pacing: {
    swim: { model: "css_offsets", offsets: SWIM_CSS_ZONE_OFFSETS },
    bike: { model: "ftp_percent", zones: BIKE_FTP_ZONES, sweetSpot: { loPct: 88, hiPct: 94 } },
    run:  { model: "vdot_threshold" }, // REUSE lib/engine/paces.ts VDOT machinery unchanged
    zoneIf: ZONE_IF,
  },

  // ── Needs domains: swim/bike/run limiters with per-discipline anchors. (P0 needsDomains) ⟨EXT-7⟩
  needsDomains: [
    { key: "swim", label: "Swim (CSS)",  weight: 1,
      anchor: { metric: "css_sec_per_100m", best: 80,  worst: 150 } }, // 1:20 → 2:30
    { key: "bike", label: "Bike (FTP W/kg)", weight: 1,
      anchor: { metric: "ftp_w_per_kg", worst: 2.2, best: 4.2 } },
    { key: "run",  label: "Run (threshold + off-bike)", weight: 1,
      anchor: { metric: "run_threshold_sec_per_km", best: 210, worst: 360 } }, // 3:30 → 6:00
  ],
  // Needs weighting is INDEPENDENT per discipline (relative-gap limiter, §4.3): all weight 1.

  // ── Experience axes (measurable bands, per §4). (P0 experienceAxes)
  experienceAxes: [
    { key: "swim", label: "Swimming", needsWeight: 1, bands: [
      { level: "beginner",     criterion: "CSS slower than 2:00/100m, or can't swim 1.9 km continuously" },
      { level: "intermediate", criterion: "CSS 1:35–2:00/100m and swims 1.9 km continuously" },
      { level: "advanced",     criterion: "CSS faster than 1:35/100m, races the swim, open-water comfortable" },
    ]},
    { key: "bike", label: "Cycling", needsWeight: 1, bands: [
      { level: "beginner",     criterion: "FTP <2.9 W/kg (M) / <2.4 (F); can't hold aero >15–20 min" },
      { level: "intermediate", criterion: "FTP 2.9–3.6 (M) / 2.4–3.0 (F)" },
      { level: "advanced",     criterion: "FTP >3.6 (M) / >3.0 (F); holds aero at target power" },
    ]},
    { key: "run", label: "Running (off the bike)", needsWeight: 1, bands: [
      { level: "beginner",     criterion: ">5:30/km threshold or run/walks; can't run 21.1 km off the bike" },
      { level: "intermediate", criterion: "4:30–5:30/km; runs the distance off the bike but slows" },
      { level: "advanced",     criterion: "<4:30/km; runs strong off the bike" },
    ]},
  ],

  // ── Duty of care: fueling + long-session flags. (P0 dutyOfCare?) ⟨EXT-8⟩
  dutyOfCare: {
    longSessionFlagHours: 4,        // 70.3 peak long ride 3–4 h → flag at 4 h
    fuelingCarbGPerHour: { min: 60, max: 90 },          // ~4–6 h race (research §fueling)
    fluidMlPerHour: { min: 500, max: 750 },
    sodiumMgPerHour: { min: 300, max: 800, note: "individualize via sweat test" },
    flags: ["train_the_gut_weekly", "never_debut_race_nutrition", "heat_acclimatize_10_14d"],
    gateBeginners: false,           // 70.3 open to beginners (with the long 20–24 wk runway)
    medicalClearanceOverHours: 5,   // rarely reached at 70.3
  },

  philosophy: {
    coach: "expert Ironman 70.3 triathlon coach",
    guidance: [
      "Bike is the largest race block; the 13.1 mi run off the bike is proportionally punishing.",
      "Sweet-spot riding is the primary FTP builder in Build; VO2 work is more 70.3-relevant than 140.6.",
      "The 2 h ride → 1 h run brick, building to 3 h → 90 min, is the key race-specificity session.",
    ],
    disciplineLibrary: { /* swim drills, bike interval vocab, run vocab — filled in philosophy.ts */ },
  },
};
```

### 1.2 `tri_140_6` — the deltas from 70.3

Only the fields that differ are shown; everything else inherits from a shared base (author as `{ ...triBase, ...overrides }` or duplicate literals — team choice, but keep the diff auditable).

```ts
// lib/engine/sports/triathlon/tri_140_6.ts
export const tri_140_6: SportConfig = {
  id: "tri_140_6",
  family: "triathlon",
  displayName: "Ironman 140.6",
  programType: "race_peaking",
  modalities: [...TRI_MODALITIES],

  // Session COUNTS stay CLOSE to 70.3 (research: "Full-IM keeps session COUNT similar to 70.3;
  // extra volume = longer sessions + more bricks/doubles"). Peak adds a second brick + tolerates doubles.
  sessionCounts: {
    swim:  { base: [2,3,3], build: [2,3,3], peak: [2,2,3], taper: [1,2,2] },
    bike:  { base: [2,3,3], build: [3,3,3], peak: [2,3,3], taper: [2,2,2] },
    run:   { base: [3,3,4], build: [3,3,4], peak: [3,4,4], taper: [2,3,3] },
    brick: { base: [0,1,1], build: [1,1,1], peak: [1,2,2], taper: [0,0,0] },
    strength: { base: [1,1,1], build: [1,1,1], peak: [0,0,1], taper: [0,0,0] },
  },

  // Discipline balance: Friel 20/50/30 midpoint; band S15–25 / B45–55 / R25–35. Bike-heavier than 70.3.
  disciplineBalance: {
    base:  { swim: 24, bike: 46, run: 30 },
    build: { swim: 18, bike: 54, run: 28 }, // bike share peaks hardest
    peak:  { swim: 15, bike: 52, run: 33 }, // run up, swim trimmed to 15%
    taper: { swim: 17, bike: 50, run: 33 },
  },

  // Intensity TILT: late Build/Peak shifts AWAY from sweet-spot toward Tempo(Z3)+Z2 durability,
  // because race power is only ~65–76% FTP (research §"Key sessions/bike", §3.8). Note the higher
  // z2 / lower z4 vs 70.3 in build/peak bike + run.
  disciplineZoneTargets: {
    swim: { /* same as 70.3 */ },
    bike: {
      base:  { z1: 22, z2: 64, z3: 7,  z4: 4,  z5: 3 },
      build: { z1: 18, z2: 56, z3: 18, z4: 6,  z5: 2 }, // durability-tilted (less Z4/Z5)
      peak:  { z1: 18, z2: 60, z3: 16, z4: 5,  z5: 1 }, // Tempo + Z2 durability, race-power specific
      taper: { z1: 20, z2: 60, z3: 12, z4: 6,  z5: 2 },
    },
    run: {
      base:  { z1: 28, z2: 66, z3: 4,  z4: 1,  z5: 1 },
      build: { z1: 22, z2: 70, z3: 6,  z4: 1,  z5: 1 }, // IM run ~all threshold-adjacent easy/tempo
      peak:  { z1: 20, z2: 72, z3: 7,  z4: 1,  z5: 0 }, // Plews IM run ≈ 4/96/0 → pyramidal, easy-heavy
      taper: { z1: 22, z2: 70, z3: 6,  z4: 1,  z5: 1 },
    },
  },

  volume: {
    currency: "discipline_tss",
    hoursByLevel: {
      beginner:     { baseHours: 8,  peakHours: 13 }, // research 140.6 beg 6–14
      intermediate: { baseHours: 9,  peakHours: 15 }, // traditional
      advanced:     { baseHours: 11, peakHours: 18 }, // research adv 8–17
    },
    peakVolumeMode: "traditional",          // TOGGLE (research §"Weekly volume"): the single biggest
    peakHoursTimeCrunched: {                //  legitimate source disagreement — expose in onboarding.
      beginner: 11, intermediate: 12, advanced: 13, // "quality-first" 10–14 h peak
    },
    phaseShape: { base: 0.60, build: 0.85, peak: 1.0 }, // bigger Base for long course
    rampCapPctPerWeek: { swim: 12, bike: 10, run: 8 },
    restDaysPerWeek: { min: 2, max: 3 },    // 140.6-specific (research §caps)
  },

  // Duty of care is a LOAD-BEARING feature at 140.6 (research §fueling, §3.8).
  dutyOfCare: {
    longSessionFlagHours: 5,                // flag any session ≥5 h (rides reach 5–6 h)
    fuelingCarbGPerHour: { min: 70, max: 90, gutTrainedMax: 120 },
    fuelingWindow: "bike_primary",          // bike = primary fueling window; marathon conservative
    fluidMlPerHour: { min: 500, max: 1000 },
    sodiumMgPerHour: { min: 300, max: 1500, note: "huge inter-individual spread; sweat-test" },
    flags: ["rehearse_race_fuel", "never_debut_race_nutrition", "train_the_gut_weekly",
            "eah_overdrink_warning", "bonk_glycogen_90min", "heat_acclimatize_10_14d",
            "gi_distress_fallback", "hydration_guardrails_both_ways_2_4pct"],
    gateBeginners: true,                    // ⇐ see §5 (recommend soft gate, not hard block)
    medicalClearanceOverHours: 5,           // ≥5–6 h unsupported session prompts clearance + bail-out
  },

  philosophy: {
    coach: "expert Ironman 140.6 (full-distance) triathlon coach",
    guidance: [
      "Race intensity is only ~65–76% of threshold: late Build/Peak favors Tempo/Z2 durability over sweet-spot.",
      "NEVER run the full marathon in training. Longest run 2:30–3:00 / ≤20 mi, 3–6 weeks out.",
      "The 4–5 h ride → 60–90 min race-pace run brick is the single most predictive session.",
      "Fueling is a trained variable: rehearse race nutrition, never debut it on race day.",
    ],
    disciplineLibrary: { /* … */ },
  },
};
```

**Registry wiring** (P0 §4): add both to `lib/engine/sports/index.ts` `SPORTS` record; add `"tri_70_3" | "tri_140_6"` to the `SportId` union (already present in P0 §2.1). No HYROX rows change.

---

## 2. Family-B control flow — the `race_peaking` branch for triathlon

`race_peaking` is the single `ProgramType` implementation shared with HYROX and DEKA (P0 §2.2). Its methods branch on `cfg.family`. For `family === "triathlon"` the branches below execute. Macrocycle allocation (`allocateMacrocycle`) is **unchanged** — it calls `allocateMesocycles`/`expandPhases` from `mesocycles.ts` verbatim; only `weeklyVolume` and session scheduling diverge.

### 2.0 Macrocycle allocation (reuse, with tri anchors)

`allocateMacrocycle` uses the existing `mesocycles.ts` math. Program length comes from research §"Program length":

| Distance | Beginner | Intermediate | Advanced |
|---|---|---|---|
| 70.3 | 20–24 | 16 | 12 |
| 140.6 | 24–30 | 24 | 12 (experienced only) |

The engine works in "week space" (`types.ts` header): the onboarding adapter converts the A-race date + level into `durationWeeks`, clamped to the table. **P0 interface note:** the current `GenerationInputSchema.durationWeeks` cap is `max(24)` (`schemas.ts` L107) and `EngineInput.durationWeeks` comment says "4–24". 140.6 needs up to **30** → widen the cap (§3, ⟨EXT-9⟩). Taper length is driven by race priority in `mesocycles.ts` (`taperWeeksForPriority`: A=2). 140.6 wants a **2–3 week** taper → the taper-length source must become `cfg`-provided (§2.4, ⟨EXT-10⟩). Base is protected as largest (long course: `Base ≥ 12` for 140.6 — enforce via the existing `applyPhaseBias` floors plus a `cfg.minBaseWeeks`).

### 2.1 `weeklyVolume` → per-discipline `DisciplineVolume[]`, reconciled per discipline, summed to one TSS scale

This is the linchpin (P0 §6; 01-tri §5.4/§8). The method returns **per-discipline hours**, each discipline is reconciled independently, then every session's prescribed hours × zone-IF is converted to TSS on **one** scale so adaptation consumes a single currency.

**Step A — weekly total hours.** From `cfg.volume`:
```
peakH   = hoursByLevel[level].peakHours              // (or peakHoursTimeCrunched if toggle set)
phaseH  = peakH × phaseShape[phase]                  // base 0.60–0.65, build 0.85, peak 1.0
weekH   = phaseH × microFactor(microWeek)            // 3:1/2:1 modulation, reuse microcycles.ts:
                                                     //   rebound 1.0, increase +ramp, deload 0.65, taper per §2.4
```
`microFactor` reuses the exact `sequenceMicrocycles` progression from `microcycles.ts`, but operating on **hours** instead of miles (the math is unit-agnostic; see ⟨EXT-6⟩). Ramp caps per discipline from `cfg.volume.rampCapPctPerWeek` (run ≤8%, bike ≤10%, swim ≤12%).

**Step B — split into disciplines.** `discH[d] = weekH × disciplineBalance[phase][d] / 100`, then apply the **weakest-discipline override** (§2.3).

**Step C — distribute each discipline's hours across its sessions.** Session count from `cfg.sessionCounts[d][phase][levelIdx]`. Allocate one **long** session (bounded by `cfg` caps §2.4) + one **quality** session + remainder **endurance**, each tagged with a target zone drawn to satisfy `disciplineZoneTargets[d][phase]` (the reconciler snaps the zone mix to the target exactly, same pattern as HYROX volume reconciliation).

**Step D — per-session TSS.** For each session with prescribed duration `h` and target zone `z`:
```
IF  = cfg.pacing.zoneIf[d][z]        // e.g. bike Z2 = 0.65, run Z4 = 0.98
TSS = 100 × h × IF²                  // the unified currency (01-tri §8)
```
Fallback rungs (missing benchmark / HR-only / RPE-only) use `LOAD_FALLBACK` (§1.0), matching the load-resolution ladder in 01-tri §5.4. **Every rung resolves to the same 100-at-threshold-for-one-hour scale.**

**Step E — combined weekly load.** `weeklyTSS = Σ over all sessions TSS` — a **simple sum** across swim+bike+run+brick, because all are the same scale. This `load_tss` per session is exactly the column 01-tri §3.4 persists, and feeds ACWR/monotony/readiness unchanged (adaptation already operates on abstract load, P0 §6). `DisciplineVolume[]` returned shape:

```ts
interface DisciplineVolume {                 // ⟨EXT-3⟩ — returned by weeklyVolume for family B
  discipline: Discipline;                    // swim|bike|run|brick
  hours: number;                             // reconciled discipline hours this week
  sessions: { targetHours: number; goalZone: 1|2|3|4|5; isLong?: boolean; isQuality?: boolean }[];
  tss: number;                               // Σ session TSS for this discipline
}
// race_peaking.weeklyVolume returns DisciplineVolume[] when cfg.family === "triathlon",
// and { miles, cardioMinutes } otherwise (HYROX/DEKA) — same method, branched on family (P0 §6).
```

**Reconciliation contract (over-constraint guard, 01-tri §9.6):** per-discipline **hours are hit exactly**; **combined TSS is a tolerance check, not a hard equality** — if the zone mix that satisfies `disciplineZoneTargets` lands combined TSS outside ±10% of a soft target, log a diagnostic but do not re-solve (prevents an over-constrained system). Order of authority: discipline hours > zone distribution > combined TSS.

### 2.2 The brick primitive

A brick is `discipline: "brick"` with **ordered segments** (01-tri §3.3 `brick_segments` jsonb / §5.3). The engine owns placement, segment durations, reconciliation, and load; AI fills only the transition-run coaching notes.

**Representation** (engine slot — ⟨EXT-11⟩, mirrors 01-tri `brick_segments`):
```ts
interface BrickSlot {
  kind: "brick";
  segments: { discipline: "bike" | "run"; durationMin: number; goalZone: 1|2|3|4|5; label: string }[];
  isKeySession?: boolean; // the 140.6 "4–5h ride → race-pace run" — the most predictive session
}
```

**Scheduling (day placement).** Bricks land on a weekend day anchored to the long ride (its bike segment often IS the long ride in Build/Peak). Reuse `slots.ts` day-placement: add `brickDays?` pref analogous to `hybridDays`, protect the day, keep the day-before a key run guarded via `applySequencingGuards`. Frequency from `cfg.sessionCounts.brick`.

**Segment durations by phase/distance** (research §"Bricks"):

| Phase | 70.3 brick (bike → run) | 140.6 brick (bike → run) | Off-bike run effort | Freq/wk |
|---|---|---|---|---|
| Early Base | 60–90 min ride → 10–20 min run | 90 min ride → 15–20 min run | easy Z2 | 1 (adv only in Base) |
| Build | 2 h ride → 30–45 min run | 3 h ride → 30–60 min run | tempo / race-effort | 1 → 2 by wk 10–11 |
| Peak | 3 h ride → 60–90 min run | 4–5 h ride → 60–90 min run | race pace (IM marathon pace) | 2 (final 6–8 wk) |

Ceilings: 70.3 brick run **40–90 min**; 140.6 brick run **60–90 min** (90 min is the near-universal ceiling — never exceed). Segment durations are clamped by the same `cfg` long-session caps (§2.4).

**Reconciliation.** A brick is **one schedulable, one-loggable unit** but its two segments carry their own zone/duration. During discipline-balance accounting the **bike segment minutes count toward bike hours** and **run segment minutes toward run hours** (so the brick doesn't distort the balance). This resolves the `disciplineBalance` note in §1.

**Load.** `brick.load_tss = Σ segment TSS`, each segment via `TSS = 100 × (segMin/60) × IF²` with `IF = zoneIf[segment.discipline][zone]` (01-tri §5.3: "load_tss = sum of segment loads"). A 3 h Z2 ride (IF 0.65) + 75 min Z3 run (IF 0.85): `100×3×0.4225 + 100×1.25×0.7225 = 126.75 + 90.3 = 217 TSS`.

### 2.3 Discipline-balance shift by phase + "add to weakest" override

Base balanced → Build bike-heavy → Peak run-up/swim-trimmed. The concrete `disciplineBalance` tables are in §1.1/§1.2. The transition, side by side:

| | 70.3 S / B / R | 140.6 S / B / R |
|---|---|---|
| Base | 27 / 46 / 27 | 24 / 46 / 30 |
| Build | 22 / 51 / 27 | 18 / 54 / 28 |
| Peak | 18 / 48 / 34 | 15 / 52 / 33 |
| Taper | 20 / 47 / 33 | 17 / 50 / 33 |

**"Add to weakest discipline" override** (research §"Discipline balance": ±10–15 pts). After computing the phase split, the needs analysis (§4.3) names the limiter discipline. Shift **+10 to +15 percentage points** into the limiter, drawn proportionally from the other two, then re-normalize to 100. Guards: never push swim above 35% or below 12%; never push bike below 40%; never push run above 38% (run injury risk) or its share up by more than +10 in one phase. This is the tri analog of `needs.ts` `stationEmphasis` — a bounded, deterministic nudge, applied only on loading weeks.

```ts
// pseudocode, deterministic
function balanceWithLimiter(split, limiter, gapSeverity /*0..1*/) {
  const add = 10 + 5 * gapSeverity;            // +10..+15 pts
  const others = disciplines.filter(d => d !== limiter);
  split[limiter] += add;
  for (const d of others) split[d] -= add * (split[d] / (others.reduce(sum)));
  return clampAndRenormalize(split, LIMITER_GUARDS); // run≤38, bike≥40, swim∈[12,35]
}
```

### 2.4 Long-session caps, big-week/recovery, taper

**Long-session caps** (research §"Long-session caps"; ⟨EXT-6⟩ `cfg.volume.longCaps`):

| | 70.3 | 140.6 |
|---|---|---|
| Long ride cap | 4 h (~50–60 mi) | 6 h (~80–100+ mi) |
| Long run cap | 2 h (~10–13 mi) | 3 h / ≤20 mi (never the full marathon) |
| Peak weekly volume | 10–12 h | 15–20 h (10–14 time-crunched) |
| Longest ride as % of race bike | ~100%+ | 80–90% |
| Longest run as % of race | 75–100% | 55–70% |

Encode as:
```ts
volume.longCaps = {                 // ⟨EXT-6⟩
  bikeHoursMax: 4 /*70.3*/ | 6 /*140.6*/,
  runHoursMax:  2 /*70.3*/ | 3 /*140.6*/,
  runDistanceMilesMax: 13 | 20,
};
```
The session-distribution step (§2.1-C) clamps the long session to these; overflow hours redistribute to the second-longest session of that discipline.

**Big-week / recovery (3:1, 2:1 masters).** Reuse `microcycles.ts` verbatim — the 3-week `[rebound, increase, deload]` (non-highly-trained / masters via `MASTERS_AGE`) and 4-week `[rebound, increase, increase, deload]` (highly-trained) patterns already implement 3:1 vs 2:1. Deload = `DELOAD_FACTOR` 0.6 (−40%), consistent with research's −30% (20–40%) recovery-week cut; if the team wants the softer −30% for long course, override via `cfg.volume.deloadFactor = 0.7`. 140.6 additionally enforces `restDaysPerWeek` 2–3 (scheduler leaves 2–3 `rest` days).

**Taper tables** (research §"Taper"; ⟨EXT-10⟩ — taper length becomes `cfg`-provided, cut run least, exponential):

```ts
// cfg.taper
tri_70_3.taper  = { weeks: 2, shape: "exponential",
  volumeLadderPctOfPeak: [70, 55],          // wk-2 ≈70%, race wk ≈55% (research −30–50%)
  cutByDiscipline: { run: 25, bike: 45, swim: 50 }, // % volume CUT — run cut LEAST
  holdIntensity: true, frequencyCutPctMax: 20 };

tri_140_6.taper = { weeks: 3, shape: "exponential",
  volumeLadderPctOfPeak: [90, 70, 50],      // then race week → ~30% (research ladder 90→70→50→30)
  raceWeekPctOfPeak: 30,
  cutByDiscipline: { run: 30, bike: 55, swim: 55 },
  holdIntensity: true, frequencyCutPctMax: 20 };
```

Implementation: the existing `taper.ts` `applyTapers` operates on `mileage[]`/`cardioMinutes[]`. Generalize it to operate on a **per-discipline hours matrix** (`Record<Discipline, number[]>`) with a `cutByDiscipline` factor and an `exponential` ladder instead of the fixed `A_TAPER_WEEK1_FACTOR`/`A_TAPER_RACEWEEK_FACTOR` constants (⟨EXT-10⟩). Intensity is held (zone targets from the `taper` column of `disciplineZoneTargets`, which keep Z3–Z5 shares). Frequency cut ≤20% (research: "Frequency ≤−20%").

---

## 3. Interface adequacy check — required P0 extensions

Each item is a precise, additive extension to the P0 `SportConfig`/`ProgramType` interface. None break HYROX (all are new optional fields or family-branched behavior). Grouped, most structural first.

| Tag | Where | Extension | Why triathlon needs it |
|---|---|---|---|
| **⟨EXT-1⟩** | `SportConfig.sessionCounts` (`PhaseCountTable`) | Add a **per-discipline** keyed variant `Record<Discipline, PhaseCountByLevel>` where `PhaseCountByLevel = Record<PhaseName, [beg,int,adv]>`. P0's table keys `run/hybrid/lift`; triathlon keys `swim/bike/run/brick/strength`. | Counts vary by discipline **and** experience level independently. |
| **⟨EXT-2⟩** | `SportConfig` new `disciplineZoneTargets?: Record<Discipline, Record<PhaseName, ZoneDistribution>>` | Supersedes the single `phaseZoneTargets?` (P0) for family B. | Swim/bike/run have **different** intensity distributions (Plews: bike 25/74/1 vs run 4/96/0). |
| **⟨EXT-3⟩** | `ProgramType.weeklyVolume` return type; new `DisciplineVolume[]` + `zoneIf` load model | P0 already anticipates `VolumeTargets = { miles, cardioMinutes } \| DisciplineVolume[]`. Pin `DisciplineVolume` (§2.1) + the `ZONE_IF` → `TSS = 100·h·IF²` model + `LoadSource` ladder. | Family B currency is per-discipline hours → unified TSS, not miles+minutes. |
| **⟨EXT-4⟩** | `SportConfig.pacing` (`PacingConfig`) | Add discriminated per-discipline pacing models: `css_offsets` (swim), `ftp_percent` (bike), `vdot_threshold` (run, reuse `paces.ts`). P0 `PacingConfig` is HYROX station-seconds-shaped. | Three distinct benchmark→zone maths (CSS, %FTP, VDOT). |
| **⟨EXT-5⟩** | `SportConfig` new `disciplineBalance?: Record<PhaseName, Record<Discipline, number>>` | % of training time per discipline per phase. No P0 analog (HYROX has no discipline split). | Discipline-balance shift + weakest-override (§2.3). |
| **⟨EXT-6⟩** | `SportConfig.volume` (`VolumeConfig`) | Add `currency: "miles_minutes" \| "discipline_tss"`; `hoursByLevel`, `phaseShape`, `peakVolumeMode` + `peakHoursTimeCrunched`, `rampCapPctPerWeek` (per discipline), `longCaps`, `restDaysPerWeek`, `deloadFactor?`. P0 `VolumeConfig` is mileage-band-shaped. | Volume is hours (not miles), per-discipline ramp caps, long-course toggle + caps. |
| **⟨EXT-7⟩** | `SportConfig.needsDomains` (`NeedsDomainConfig`) | Allow domains `swim/bike/run` with per-discipline anchors + **independent weighting**; generalize `needs.ts` anchor tables (currently `run_engine/erg_engine/strength`). Relative-gap logic reused unchanged. | Limiters are per discipline; anchors are CSS/FTP-W·kg/threshold-pace. |
| **⟨EXT-8⟩** | `SportConfig.dutyOfCare` (`DutyOfCareConfig`) | Add `fuelingCarbGPerHour {min,max,gutTrainedMax?}`, `fluidMlPerHour`, `sodiumMgPerHour`, `fuelingWindow`, `longSessionFlagHours`, `medicalClearanceOverHours`, `flags[]`, `gateBeginners`. P0 has the field but undefined shape. | 140.6 fueling/EAH/heat gating is load-bearing (§5). |
| **⟨EXT-9⟩** | `GenerationInputSchema.durationWeeks` (`schemas.ts` L107) + `EngineInput.durationWeeks` | Raise cap **24 → 30**. | 140.6 beginner runway is 24–30 wk. Touches the log/readiness schemas' `weekNumber.max(24)` too — widen consistently. |
| **⟨EXT-10⟩** | `mesocycles.ts` `taperWeeksForPriority` + `taper.ts` `applyTapers` | Taper **length + shape** must come from `cfg.taper` (2 wk / 2–3 wk, exponential, per-discipline cut factors), not the hardcoded A/B/C constants. Generalize `applyTapers` to a per-discipline hours matrix. | 140.6 taper is 3 wk with run-cut-least ladder; HYROX A-race stays 2 wk via `cfg`. |
| **⟨EXT-11⟩** | `Modality` union + `SessionSlot` union (`types.ts`) + `SessionSchema` (`schemas.ts`) | Add `SwimSlot`, `BikeSlot`, `BrickSlot` (ordered segments); add `swim/bike/brick` to `Modality`. P0 §5 already widens `Modality`; this pins the slot shapes + Zod session schemas (01-tri §4.6). | New session primitives, incl. the brick's ordered-segment shape. |
| **⟨EXT-12⟩** | `SportConfig` new `minBaseWeeks?: number` | Long course needs Base ≥ 12 wk protected through `applyPhaseBias`. | research: 140.6 Base 12+. |

**Interface-fit verdict:** the P0 seam holds. Nothing here requires a *new* `ProgramType` — triathlon is `race_peaking` with `cfg.family === "triathlon"` branches in `weeklyVolume` + scheduling, exactly as P0 §6 designed. The additions are (a) per-discipline versions of existing data fields (⟨EXT-1,2,5,7⟩), (b) an hours/TSS `VolumeConfig` variant (⟨EXT-3,6⟩), (c) new session slots (⟨EXT-11⟩), and (d) two small generalizations of hardcoded HYROX constants into `cfg` (taper length ⟨EXT-10⟩, duration cap ⟨EXT-9⟩). All additive; HYROX byte-identical proof (P0 §7) is unaffected because HYROX leaves every new field unset and keeps `currency: "miles_minutes"`.

---

## 4. Experience tiering — finalized numeric bands

### 4.1 Bands per discipline × level (measurable, per §4 of the design doc + research)

Independent per discipline: an athlete can be advanced-run / beginner-swim. These are the `experienceAxes[].bands` literals (§1.1) plus the numeric thresholds the onboarding wizard tests against.

| Axis | Beginner | Intermediate | Advanced | Metric used |
|---|---|---|---|---|
| **Swim** | CSS **> 2:00/100m**, or cannot swim race distance continuously | CSS **1:35–2:00/100m** + swims race distance continuously | CSS **< 1:35/100m**, races the swim, OW-comfortable | `css_sec_per_100m` (400+200 TT) |
| **Bike** | FTP **< 2.9 W/kg** (M) / **< 2.4** (F); can't hold aero >15–20 min | FTP **2.9–3.6** (M) / **2.4–3.0** (F) | FTP **> 3.6** (M) / **> 3.0** (F); 3.5–4.2 = Kona territory | `ftp_w_per_kg` |
| **Run** | threshold **> 5:30/km** (~8:50/mi) or run/walks; can't run race dist off the bike | **4:30–5:30/km**; runs the distance off the bike but slows | **< 4:30/km**; runs strong off the bike | `run_threshold_sec_per_km` + off-bike flag |

**Two hard overrides (not pace-based):**
1. **Swim:** "cannot swim race distance continuously" ⇒ **beginner regardless of CSS pace** (research §"Experience tiering"). A fast 100m swimmer who can't hold 1.9/3.8 km continuous is a beginner.
2. **Run:** "can you run the race distance **off the bike**?" is weighted heavily. A fast open-run athlete who has never run a half/marathon off a long ride is a **run-beginner** here. Encode as a boolean `runsRaceDistanceOffBike` that caps the tier at `intermediate` when false, and at `beginner` when the athlete also can't run the distance at all.

Constants:
```ts
const SWIM_CSS_BANDS = { begAbove: 120, advBelow: 95 };       // sec/100m (2:00, 1:35)
const BIKE_FTP_WKG_BANDS = { male: { begBelow: 2.9, advAbove: 3.6 },
                             female: { begBelow: 2.4, advAbove: 3.0 } };
const RUN_THRESH_BANDS = { begAbove: 330, advBelow: 270 };    // sec/km (5:30, 4:30)
```

### 4.2 Program-level training class

`EngineInput.trainingClass` (`highly_trained | non_highly_trained`, drives the 3:1 vs 4:1 microcycle) is derived from the **max** discipline tier (advanced in ≥1 discipline + intermediate+ in the rest ⇒ `highly_trained`), while **program length** (§2.0) is keyed to the **lowest** discipline tier + distance (the weakest discipline sets the safe runway). Masters (`age ≥ 50`) still forces the 2:1 pattern via `microcycles.ts` `MASTERS_AGE` — unchanged.

### 4.3 Needs weighting — independent per discipline

The `needs.ts` machinery is reused unchanged in shape: score each discipline 0–100 against its anchor (§1 `needsDomains`), detect the **relative-gap** limiter (a discipline ≥`LIMITER_GAP` below the athlete's own mean). Differences from HYROX:
- Domains are `swim | bike | run` (not `run_engine/erg_engine/strength`), each **weight 1** — genuinely independent, no cross-weighting.
- Scoring anchors: swim `scoreLowerBetter(css, best 80, worst 150)`; bike `scoreHigherBetter(ftpWkg, worst 2.2, best 4.2)`; run `scoreLowerBetter(threshSecPerKm, best 210, worst 360)`, sex-normalized like the existing `RUN_ANCHORS` (reuse the sex-key pattern in `needs.ts`).
- The limiter output drives the **"add to weakest discipline"** balance override (§2.3, ±10–15 pts) — the tri analog of `stationEmphasis`. The bounded phase-week nudge (`applyPhaseBias`) is reused as-is (e.g. run-limiter ⇒ +1 Base week for aerobic foundation).
- Off-bike run inability is folded in as a durability-style penalty on the run domain score (analogous to `scoreDurability` lowering the run engine), pulling the run limiter forward.

---

## 5. Duty-of-care gating for beginners on 140.6 — decision inputs + recommended rule

**Decision inputs** (what the engine can see at onboarding):
1. **Distance** = `tri_140_6` (9–17 h event; long sessions reach 5–6 h — EAH, bonk, GI, heat risk, per research §fueling / §3.8).
2. **Per-discipline tiers** (§4.1) — specifically whether **any** discipline is `beginner`, and whether `runsRaceDistanceOffBike === false`.
3. **Available runway** = weeks between today and the A-race date vs. the required 24–30 wk beginner runway (research: optimal 140.6 runway ≈ 1 year).
4. **Swim continuity** hard override (can't swim 3.8 km continuously) and **can't ride 100+ mi** history (research: "Ride 100+ mi ≥3× before IM").
5. **Age/masters** + declared training history (`trainingClass`).

**Recommended rule (soft gate, not a hard block):**

```
IF distance == tri_140_6 AND (minDisciplineTier == beginner OR runsRaceDistanceOffBike == false):
   IF weeksToRace < 24:
       → BLOCK generation with a redirect: "A full Ironman needs a 24–30 week runway from your
         current level. We recommend building to a 70.3 first, then returning." Offer a one-click
         switch to tri_70_3 with the same A-race date if ≥12 wk out, else a 70.3 with a suggested date.
   ELSE (weeksToRace >= 24):
       → ALLOW, but force the CONSERVATIVE profile:
           - peakVolumeMode = "time_crunched" (lower peak hours),
           - phaseShape.base = 0.55 (even longer aerobic base),
           - rampCapPctPerWeek.run = 6 (extra-conservative run ramp),
           - restDaysPerWeek = 3,
           - all dutyOfCare.flags surfaced prominently + medical-clearance acknowledgement REQUIRED
             before the plan unlocks,
           - hard cap longest run at 2:30 / 18 mi (below the advanced 3:00/20 mi).
ELSE (intermediate+ in every discipline, or 70.3): ALLOW normally.
```

Rationale: a hard block frustrates capable-but-untested athletes and pushes them to competitors; a **redirect-when-under-runway + conservative-when-adequate-runway** rule is duty-of-care-defensible (matches multisport-spec §8 Q5 "gate true beginners… or allow with warnings" — this is the middle path) and reuses existing knobs (`peakVolumeMode`, `phaseShape`, ramp caps) rather than new control flow. Store the acknowledgement as a boolean on the program; `gateBeginners: true` in `cfg` is the switch that activates this rule for `tri_140_6` only.

---

## 6. Tests (vitest) + open questions

### 6.1 Test plan (pure-logic, deterministic — the engine's contract; mirrors 01-tri §5.6)

All in `lib/engine/sports/triathlon/__tests__/`. No live Haiku; reconciliation tested against fixture AI outputs.

**A. Benchmark math (`benchmarks.test.ts`)**
- CSS: `CSS_speed = (400−200)/(t400−t200)` → sec/100m. Assert exact for known TTs (e.g. t400=360s, t200=170s ⇒ 190m/(190s) ⇒ 1.0 m/s ⇒ 100s/100m = 1:40).
- CSS input guards (01-tri §8): reject `t400 ≤ t200`, non-positive, and implausible results (`<45s` or `>180s`/100m) — assert each throws/returns null.
- FTP: 20-min ×0.95 **and** ramp (`≈0.75 × 1-min peak`) are **different formulas** — assert both, and that they're not conflated. FTP W/kg from FTP + body weight.
- Tier assignment: table-driven over §4.1 bands incl. the two hard overrides (continuous-swim ⇒ beginner; off-bike-false ⇒ ≤intermediate).

**B. TSS per source (`load.test.ts`)**
- `TSS = 100·h·IF²` for each discipline: bike Z2 3h (IF 0.65) ⇒ 126.75; run Z4 1h (IF 0.98) ⇒ 96.04; swim threshold 1h (IF 0.98) ⇒ 96.04. Assert to 2 dp.
- Each load-ladder rung (power / pace / swim_css / hrTSS / manual_rpe) resolves onto the **same scale** — a threshold hour ≈ 100 TSS regardless of source (01-tri §5.4).
- Assert TRIMP is **never** summed into combined load (it's a separate field).
- Combined weekly load = simple Σ across disciplines (property test: sum of parts == whole).

**C. Discipline balance (`balance.test.ts`)**
- Phase splits sum to 100 for every phase × distance (§1.1/§1.2 tables).
- Brick segment minutes attribute to bike/run correctly (balance not distorted by bricks).
- Weakest-override: +10–15 pts into limiter, others reduced proportionally, re-normalized to 100, guards respected (run≤38, bike≥40, swim∈[12,35]).

**D. Brick load (`brick.test.ts`)**
- `brick.load_tss == Σ segment TSS` (the 217-TSS worked example, §2.2).
- Segment durations clamp to phase/distance table + long caps; 140.6 brick run never exceeds 90 min.
- Key-session flag set on the 140.6 4–5 h→race-pace-run peak brick.

**E. Taper (`taper.test.ts`)**
- 70.3: 2 wk, ladder [70,55]% of peak, run cut 25% < bike 45% < swim 50%; intensity zones held.
- 140.6: 3 wk, ladder [90,70,50]→race 30%, exponential (each step's ratio decreasing), run cut least, frequency cut ≤20%.
- Property: taper never cuts run volume more than bike or swim.

**F. Caps + volume (`volume.test.ts`)**
- Long ride/run clamped to `longCaps` per distance; overflow redistributes.
- Ramp caps enforced per discipline (run ≤8%/wk, bike ≤10%, swim ≤12%); 3:1/2:1 micro modulation reused from `microcycles.ts` on hours.
- Peak weekly hours land in research bands (70.3 10–12 non-toggle; 140.6 15–20 traditional / 10–14 time-crunched).
- Program length clamps to §2.0 table per level × distance; Base ≥ `minBaseWeeks`.

**G. Gating (`gating.test.ts`)**
- 140.6 beginner + `<24 wk` ⇒ BLOCK + redirect payload.
- 140.6 beginner + `≥24 wk` ⇒ ALLOW with conservative profile applied (assert the exact knob overrides in §5).
- 70.3 beginner ⇒ ALLOW normally.

**H. HYROX non-regression (reuse P0 §7 gate):** assert HYROX `SportConfig` leaves all ⟨EXT-*⟩ fields unset and `currency: "miles_minutes"`, so the byte-identical snapshot is unaffected by the triathlon additions.

### 6.2 Open questions

1. **`peakVolumeMode` default for 140.6** — traditional (15–20 h) or time-crunched (10–14 h)? Research calls this "the biggest source disagreement." Recommend **time-crunched default** for beginners (via §5) and **let intermediate+ choose** at onboarding; needs a product decision on the default for experienced athletes.
2. **`deloadFactor` for long course** — keep HYROX's −40% (`DELOAD_FACTOR 0.6`) or soften to −30% (0.7) for 140.6 recovery weeks? Research says 20–40%; I've defaulted to reusing 0.6 but flagged the `cfg.volume.deloadFactor` override.
3. **Strength as a modality** — I included an opt-in 1×/wk `strength` count (durability/injury-prevention). 01-tri §2.2 defers "strength for triathletes" to P3. Confirm whether MVP schedules it or omits it (set counts to 0).
4. **Swim continuity + 100-mi-ride history capture** — these hard overrides need explicit onboarding questions beyond CSS/FTP. Confirm the wizard collects `canSwimRaceDistanceContinuous` and `hasRidden100mi` booleans (needed by §4.1 override + §5 gate).
5. **Zone-IF center values** (`ZONE_IF`, §1.0) are representative midpoints; they set target TSS. Worth a calibration pass against real TrainingPeaks data once logs exist — they don't affect correctness of the *sum*, only the target magnitude.
6. **Olympic/sprint** — 01-tri MVP ships sprint/olympic **before** 70.3; this spec covers only the 70.3/140.6 pair per the task. The same Family-B `SportConfig` shape extends to `tri_sprint`/`tri_olympic` (shorter length, more VO2, no fueling gate) — flag whether to author those literals in the same module now.
7. **Combined-load ACWR as primary Apply trigger** — inherited open question from 01-tri §9; this spec assumes combined-primary / per-discipline-localize. No engine change needed here, but the tiering/balance overrides interact with it (a limiter getting +15% balance could spike per-discipline ACWR) — verify the ramp caps still bind after the balance override.

---

## 7. Consistency map with 01-triathlon-engine.md

| This spec owns | 01-tri owns (referenced, not restated) |
|---|---|
| `SportConfig` literals (§1), Family-B `race_peaking` control flow (§2), interface extensions (§3), tiering numbers (§4), gating rule (§5) | DB schema (`programs.program_type/disciplines`, `discipline_benchmarks`, `brick_segments`, `workout_logs.load_tss`), `set_current_benchmark` RPC, `generation_jobs` queue + Cron worker, Strava discipline matcher, the load-resolution ladder narrative (§5.4/§8) |
| Discipline-balance %, brick segment durations, taper ladders, long caps, hours/wk, zone-IF | Canonical discipline vocab (§3.0), reconciliation-as-tolerance principle (§9.6), cold-start ACWR seeding (§5.4), deterministic fallback template (§5.5) |

No contradictions: `load_tss = 100·h·IF²` (§2.1) is 01-tri §8 verbatim; brick `load_tss = Σ segments` (§2.2) is 01-tri §5.3; per-discipline hours reconciled + summed (§2.1) is 01-tri §5.4; taper "cut run least" (§2.4) extends 01-tri §8; 140.6 duty-of-care deferral to a later phase (§5) matches 01-tri §2.2/§9.13.
