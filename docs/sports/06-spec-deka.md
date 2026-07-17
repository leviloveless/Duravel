# Duravel — DEKA Sport Family Implementation Spec (Stage 1, build-ready)

**Author:** Claude (senior-eng spec), for Levi · **Date:** 2026-07-16
**Targets:** the P0 interface in `duravel-P0-abstraction-design.md` (`SportConfig`, `ProgramType`, `Modality`, `StationSpec`, `ExperienceAxis`, sub-configs). Conform exactly.
**Covers:** `deka_fit`, `deka_mile`, `deka_strong`, `deka_atlas`, `deka_ultra`.
**Source of truth for values:** `research-deka.md` (zones/loads/runs/records), `multisport-spec.md` §3.2–3.6, and the current engine (`stations.ts`, `slots.ts`, `volume.ts`, `needs.ts`, `paces.ts`, `pacing.ts`, `mesocycles.ts`, `types.ts`, `philosophy.ts`, `schemas.ts`).

> **Reading note.** All five DEKA sports are Family A (`station_hybrid`), `programType: "race_peaking"`. They differ only in: (1) station catalog (standard 10 vs Atlas 10), (2) run geometry (`interStationRunMeters` / `totalRaceRunMeters`), (3) zone-target shift by energy system, (4) session-count tables (run share), (5) needs weighting, (6) volume bands, (7) copy. Two of them (`deka_strong`, `deka_atlas`) require a **control-flow delta**: near-zero run slots (§3). `deka_ultra` requires **long-session progression + duty-of-care** (§3). Everything else is pure `SportConfig` data.

---

## 0. Conventions locked from the engine

- **Load unit = kilograms.** `stations.ts` stores `loadKg` in kg (e.g. sled_push open male 152). DEKA official standards are **pound-primary**; we convert to kg for the catalog and keep the lb value in a comment. See **Open Question Q1** (lb display / versioned table).
- **`StationSpec.loadKg` key = "division-like" category.** HYROX uses `open|pro`. DEKA standard zones have one competitive load set (**Rx**, ages 14–64) plus Youth/65+/Ruck modifiers → key on `rx` (+ optional `youth`, `masters`, `ruck`). Atlas has `rx` + `foundation`. This matches the P0 `Record<string, Record<"male"|"female", number>>` shape.
- **`reps` may be `number | string`** (P0 allows it) — used for "50 push + 50 pull" style compound zones.
- **`match?: RegExp`** mirrors `stationIdFor()` regexes in `stations.ts`.
- **Zone-target distributions** follow `volume.ts PHASE_ZONE_TARGETS` shape (`{z1,z2,z3,z4,z5}` summing to 100) — cardio-time distribution, weightlifting excluded.
- **Session-count table** follows `slots.ts` shape: `run` and `hybrid` keyed per phase with `[beg,int,adv]` (run) / scalar (hybrid), `lift` scalar. I widen HYROX's `hybrid` scalar-per-phase into a per-phase table where a DEKA format needs it.

---

# 1. Shared DEKA foundation

## 1.1 `DEKA_STATIONS: StationSpec[]` — the canonical 10 zones

Zones are performed in numerical order 1→10 (`raceStationOrder` below). Loads are **Rx (ages 14–64)**. Format variants live on zones **4** and **8** (FIT = throw/yoke-over target; MILE/STRONG = tap/shoulder-over) — encode both variants as sibling ids and select per format via `raceStationOrder`. Weight tolerance ≤ 0.68 kg under (display note only).

```ts
// lib/engine/sports/deka/stations-deka.ts
// kg-primary (engine convention); lb noted for verification against the versioned Rules PDF.
export const DEKA_STATIONS: StationSpec[] = [
  {
    id: "deka_ram_lunge",                       // Zone 1
    label: "RAM Alternating Reverse Lunge",
    reps: 30,                                    // 15/side
    loadKg: { rx: { male: 25, female: 15 } },   // 55 / 33 lb (RAM roller)
    match: /ram.*lunge|(reverse|alternating).*lunge/,
  },
  {
    id: "deka_row",                             // Zone 2
    label: "Row",
    meters: 500,                                // Youth 250 m
    match: /\brow\b/,
  },
  {
    id: "deka_box_over",                        // Zone 3
    label: "Box Step/Jump Over",
    reps: 20,
    // 24 in / 60 cm box, bodyweight — no external load.
    match: /box.*(step|jump|over)|step.?over/,
  },
  {
    id: "deka_sit_up_throw",                    // Zone 4 — FIT variant (throw to 4.5 ft target)
    label: "Sit-Up Throw",
    reps: 25,
    loadKg: { rx: { male: 9, female: 6 } },     // 20 / 14 lb med ball
    match: /sit.?up.*(throw|target)|throw.*sit/,
  },
  {
    id: "deka_med_ball_sit_up",                 // Zone 4 — MILE/STRONG variant (tap, no throw)
    label: "Med Ball Sit-Up",
    reps: 25,
    loadKg: { rx: { male: 9, female: 6 } },     // 20 / 14 lb
    match: /med.?ball.*sit|sit.?up(?!.*throw)/,
  },
  {
    id: "deka_ski",                             // Zone 5
    label: "Ski",
    meters: 500,                                // Youth 250 m
    match: /\bski\b/,
  },
  {
    id: "deka_farmers_carry",                   // Zone 6
    label: "Farmers Carry",
    meters: 100,
    perHand: true,
    loadKg: { rx: { male: 27.5, female: 17.5 } }, // 60 / 40 lb per hand
    match: /farmer/,
  },
  {
    id: "deka_air_bike",                        // Zone 7
    label: "Air Bike",
    reps: "25 cal",                             // Youth 12 cal
    match: /(assault|echo|air)\s*bike|air.?bike/,
  },
  {
    id: "deka_wall_over",                       // Zone 8 — FIT variant (dead-ball wall/yoke-over 4 ft bar)
    label: "Dead Ball Wall-Over",
    reps: 20,
    loadKg: { rx: { male: 27.5, female: 17.5 } }, // 60 / 40 lb dead ball
    match: /(wall|yoke).?over|dead.?ball.*over/,
  },
  {
    id: "deka_dead_ball_over",                  // Zone 8 — MILE/STRONG variant (shoulder-over)
    label: "Dead Ball Shoulder-Over",
    reps: 20,
    loadKg: { rx: { male: 27.5, female: 17.5 } }, // 60 / 40 lb
    match: /dead.?ball.*(shoulder|over)|shoulder.?over/,
  },
  {
    id: "deka_sled",                            // Zone 9 — SLOWEST zone
    label: "Magnetic Sled Push/Pull",
    meters: 100,                                // 50 push + 50 pull
    reps: "50m push + 50m pull",
    // Magnetic resistance (Torque Tank Lvl 3 / Xebex Lvl 8 +160 lb M; Lvl 2 / Lvl 7 +160 lb F).
    // No simple kg — resistance is a device level. loadKg omitted; note carries the setting.
    note: "Torque Tank Lvl 3 / Xebex Lvl 8 +160 lb (M) · Lvl 2 / Lvl 7 +160 lb (F)",
    match: /sled/,
  },
  {
    id: "deka_ram_burpee",                      // Zone 10
    label: "RAM Weighted Burpee",
    reps: 20,
    loadKg: { rx: { male: 20, female: 10 } },   // 44 / 22 lb (RAM roller — lighter than lunge)
    match: /ram.*burpee|weighted.*burpee|burpee/,
  },
];
```

**Format → zone-4/zone-8 selection** (drives `raceStationOrder`):

| Format | Zone 4 id | Zone 8 id |
|---|---|---|
| FIT / ULTRA | `deka_sit_up_throw` | `deka_wall_over` |
| MILE / STRONG | `deka_med_ball_sit_up` | `deka_dead_ball_over` |

**Interface note (flag):** P0 `StationSpec` has no `perHand`/`note` fields, but the current `stations.ts StationSpec` does. **Add `perHand?: boolean` and `note?: string` to the P0 `StationSpec`** (they are already load-bearing for farmers carry display and the sled/air-bike no-kg cases). Low-risk additive change.

## 1.2 `ATLAS_STATIONS: StationSpec[]` — the 10 Atlas zones (Rx + Foundation)

Distinct, heavier catalog. No running. `rx` + `foundation` load keys.

```ts
// lib/engine/sports/deka/stations-atlas.ts
export const ATLAS_STATIONS: StationSpec[] = [
  {
    id: "atlas_thruster",                       // Zone 1
    label: "Barbell Thruster",
    reps: 20,
    loadKg: { rx: { male: 43, female: 29.5 }, foundation: { male: 29.5, female: 20.5 } }, // 95/65 · 65/45 lb
    match: /thruster/,
  },
  {
    id: "atlas_burpee_over_bar",                // Zone 2
    label: "Bar-Facing Burpee Over Bar",
    reps: 20,                                   // bodyweight
    match: /burpee.*(bar|over)|bar.?facing/,
  },
  {
    id: "atlas_surrender_lunge",                // Zone 3
    label: "Surrender Lunge",
    reps: 20,
    loadKg: { rx: { male: 22.5, female: 16 }, foundation: { male: 16, female: 11 } }, // 50/35 lb Rx
    match: /surrender.*lunge/,
  },
  {
    id: "atlas_db_g2oh",                        // Zone 4
    label: "Single-Arm DB Ground-to-Overhead",
    reps: 20,
    loadKg: { rx: { male: 22.5, female: 16 }, foundation: { male: 16, female: 11 } }, // 50/35 lb
    match: /(ground|g2oh).*(overhead)|single.?arm.*db/,
  },
  {
    id: "atlas_db_bear_crawl",                  // Zone 5
    label: "DB Bear Crawl",
    meters: 40,
    perHand: true,
    loadKg: { rx: { male: 22.5, female: 16 }, foundation: { male: 16, female: 11 } }, // 50/35 lb each
    match: /bear.?crawl/,
  },
  {
    id: "atlas_weighted_sit_up",                // Zone 6
    label: "Weighted Sit-Up",
    reps: 20,
    loadKg: { rx: { male: 16, female: 9 }, foundation: { male: 9, female: 6 } }, // 35/20 lb
    match: /weighted.*sit|sit.?up/,
  },
  {
    id: "atlas_farmers_carry",                  // Zone 7 — HEAVY
    label: "Farmers Carry",
    meters: 60,
    perHand: true,
    loadKg: { rx: { male: 45, female: 32 }, foundation: { male: 32, female: 22.5 } }, // 100/70 · 70/50 lb
    match: /farmer/,
  },
  {
    id: "atlas_db_s2oh",                        // Zone 8
    label: "DB Shoulder-to-Overhead",
    reps: 20,
    perHand: true,
    loadKg: { rx: { male: 22.5, female: 16 }, foundation: { male: 16, female: 11 } }, // 50/35 lb each
    match: /(shoulder|s2oh).*(overhead)|db.*shoulder/,
  },
  {
    id: "atlas_single_unders",                  // Zone 9
    label: "Single-Unders (Jump Rope)",
    reps: 100,                                  // bodyweight
    match: /single.?under|jump.?rope/,
  },
  {
    id: "atlas_shoulder_to_carry",              // Zone 10
    label: "Atlas Shoulder-to-Carry",
    meters: 100,
    loadKg: { rx: { male: 45, female: 32 }, foundation: { male: 32, female: 22.5 } }, // 100/70 lb
    match: /atlas.*(carry|shoulder)|shoulder.?to.?carry/,
  },
];
```

**Atlas race order (Rx or Foundation selected by `division`):**
`["atlas_thruster","atlas_burpee_over_bar","atlas_surrender_lunge","atlas_db_g2oh","atlas_db_bear_crawl","atlas_weighted_sit_up","atlas_farmers_carry","atlas_db_s2oh","atlas_single_unders","atlas_shoulder_to_carry"]`

**Flag:** Atlas loads are **community-sourced / least-verified** (`research-deka.md` §Flags). Ship behind the versioned-table disclaimer (Q1). Foundation Z2/Z9 keep bodyweight; only loaded zones scale.

## 1.3 DEKA needs domains + scoring anchors

The `needs.ts` relative-gap limiter logic (`detectLimiters`, `LIMITER_GAP=10`, `analyzeNeeds`) is **sport-neutral and reused wholesale**. Only the **domain set + anchors** come from `cfg.needsDomains`. DEKA times are faster/lighter than HYROX, and the erg TTs are **500 m** (not 2 k), so anchors differ.

### 1.3.1 Standard formats (Fit / Mile / Strong / Ultra) — domains `run_engine · erg_engine · strength`

Same three domains as HYROX, recalibrated. **New benchmark inputs** required (DEKA-specific TTs from `research-deka.md §Weakness Diagnostics`):

```ts
// Extend BenchmarksSchema (schemas.ts) with DEKA fields (all optional):
//   row500Time?: string     // 500 m row TT (mm:ss)
//   ski500Time?: string     // 500 m ski TT
//   sled100Time?: string    // 100 m Rx sled push+pull TT (leg-drive limiter)
//   farmers100Unbroken?: boolean  // 100 m @ Rx unbroken (grip pass/fail)
//   ramBurpee20Time?: string      // 20-rep RAM burpee for time
//   run500RepeatAvg?: string      // avg of 6–10×500 m repeats (FIT economy)
//   run160RepeatAvg?: string      // avg of 160 m repeats (MILE speed)
```

**Anchors** (`[best, worst]`, sex-keyed like `needs.ts`; kg-neutral, times in sec):

```ts
// run_engine: reuse RUN_ANCHORS from needs.ts UNCHANGED — running ability is running ability.
//   (mile/5K/10K pace anchors are sport-neutral.) DEKA calibration happens via needsWeight + the
//   500 m / 160 m repeat overlay, NOT by moving the pace anchors.

// erg_engine (DEKA): 500 m TTs, faster/lighter reference than HYROX's 2 k.
const DEKA_ERG_ANCHORS = {
  male:   { row500: [88, 125], ski500: [95, 135], sled100: [40, 90] },   // sec, lower better
  female: { row500: [100, 143], ski500: [108, 154], sled100: [48, 108] },
};
// strength (DEKA): reuse STR_ANCHORS from needs.ts (relative 1RM) UNCHANGED — grip/leg-drive is
// captured by farmers-unbroken + sled TT, folded into erg_engine's sled100 term. Lighter DEKA loads
// mean strength de-weights via needsWeight, not via new anchors.
```

**DEKA-calibrated anchor deltas vs HYROX (concrete, per format where they differ):**

| Anchor | HYROX ref | FIT | MILE | STRONG | ULTRA |
|---|---|---|---|---|---|
| erg TT distance | 2000 m | **500 m** row/ski | **500 m** | **500 m** | 500 m + 2 k durability |
| erg `best` (M row) | 400 s (2 k) | 88 s | 88 s | **82 s** (pull-focused) | 92 s |
| sled100 weight | — (HYROX 50 m) | 40 s best | 40 s | **36 s** best (leg-drive dominant) | 44 s |
| run overlay | 5 K/10 K | **6–10×500 m** avg | **160 m** repeat | (de-weighted) | **long-run + Riegel** |

### 1.3.2 Atlas — domains shift to `strength · press_endurance · glycolytic`

Atlas is "a strength sport wearing a station skin." Replace the DEKA domain set:

```ts
export type AtlasNeedsDomain = "strength" | "press_endurance" | "glycolytic";
```

- **`strength`** — reuse `scoreStrength` (relative 5RM squat/dead/bench) but re-weight toward **squat/press** (Atlas has no deadlift station; thruster + carries dominate). Suggested weights: squat 0.35, dead 0.25, bench 0.40 (press proxy). Anchor: absolute-strength floor test — **95 lb (43 kg) thruster unbroken-capacity** and **100 lb/hand (45 kg) carry distance**.
- **`press_endurance`** — new scorer from **unbroken DB S2OH reps @ 50 lb** and **DB G2OH capacity**. Anchors (M): `[best 40 reps, worst 12]`; (F): `[best 30, worst 8]`.
- **`glycolytic`** — new scorer from **thruster-20 + burpee-over-bar-20 for time** (the Atlas opener couplet). Anchors (M): `[best 90 s, worst 210 s]`; (F): `[best 105 s, worst 240 s]`.

```ts
// New benchmark inputs for Atlas:
//   thruster20Time?: string        // 20 unbroken 95 lb thrusters for time
//   dbS2OH50Unbroken?: number      // max unbroken 50 lb DB S2OH reps
//   carry100Distance?: number      // meters carried @ 100 lb/hand unbroken
```

### 1.3.3 Benchmark time-trials for the needs analysis (per format)

| Format | Required-ish TTs (onboarding wizard) | Optional |
|---|---|---|
| FIT | 5 K time, **6–10×500 m repeat avg**, 500 m row+ski back-to-back | sled100, farmers-unbroken, 20-rep RAM burpee |
| MILE | mile/5 K time, **160 m repeat avg**, 500 m row/ski | sled100, RAM burpee |
| STRONG | **500 m row+ski back-to-back**, sled100, farmers-unbroken | dead-ball-over 20-for-time, 5RM lifts |
| ULTRA | 10 K / long-run history, 500 m row/ski | mile, sled100, durability pair |
| ATLAS | **thruster20 time, DB S2OH unbroken, 100 lb carry distance**, 5RM squat/press | burpee-over-bar, single-unders |

Onboarding friction policy: mirror HYROX (only a single run time is hard-required); all TTs optional with the needs analysis degrading gracefully to `NEUTRAL_BIAS` when `<2` scorable domains (unchanged `needs.ts` behavior).

---

# 2. Per-format `SportConfig` values

All five: `family: "station_hybrid"`, `programType: "race_peaking"`, `modalities` include `"rest"` + `"race"` always. Loads reference the catalogs in §1.

### 2.0 Shared session-count note

`slots.ts` `RUN_COUNT` is `Record<PhaseName,[beg,int,adv]>`; `HYBRID_COUNT` is `Record<PhaseName,number>`; lifts fixed at 3. I express each format's `sessionCounts` in that shape. **`hybrid` here = "run+zone circuit" session** (the DEKA analog of a HYROX hybrid), and its per-session structure is `interStationRunMeters` run → 1 zone, ×N (see §4).

---

## 2.1 `deka_fit`

```ts
export const deka_fit: SportConfig = {
  id: "deka_fit", family: "station_hybrid", displayName: "DEKA FIT",
  programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],

  // Runs slightly below HYROX (5 km race, 500 m repeats). Hybrid ramps like HYROX.
  sessionCounts: {
    run:    { base: [3,4,5], build: [4,5,5], peak: [3,4,4], taper: [2,3,3] },
    hybrid: { base: 1, build: 2, peak: 3, taper: 1 },
    lift:   3,
  },

  stations: DEKA_STATIONS,
  // FIT uses throw(Z4) + wall/yoke-over(Z8):
  raceStationOrder: [
    "deka_ram_lunge","deka_row","deka_box_over","deka_sit_up_throw","deka_ski",
    "deka_farmers_carry","deka_air_bike","deka_wall_over","deka_sled","deka_ram_burpee",
  ],
  interStationRunMeters: 500,
  totalRaceRunMeters: 5000,

  // Between HYROX and MILE: shorter/faster 500 m runs skew more Z3/Z4 than HYROX.
  phaseZoneTargets: {
    base:  { z1: 22, z2: 58, z3: 11, z4: 6, z5: 3 },
    build: { z1: 18, z2: 54, z3: 15, z4: 9, z5: 4 },
    peak:  { z1: 14, z2: 48, z3: 17, z4: 13, z5: 8 },
    taper: { z1: 16, z2: 54, z3: 15, z4: 10, z5: 5 },
  },

  needsDomains: [DEKA_RUN_ENGINE, DEKA_ERG_ENGINE, DEKA_STRENGTH], // §1.3.1
  experienceAxes: [
    { key: "running", label: "Running", bands: HYROX_RUNNING_BANDS, needsWeight: 1.0 },
    { key: "hybrid",  label: "HIIT / Hybrid", bands: HYROX_HYBRID_BANDS, needsWeight: 1.0 },
    { key: "lifting", label: "Lifting", bands: HYROX_LIFTING_BANDS, needsWeight: 0.9 },
  ],

  pacing: DEKA_FIT_PACING,   // §1.3 + pacing note below; 10 zones, 500 m split
  volume: {
    startMileageByRunExp: { beginner: 8, intermediate: 15, advanced: 24 }, // ~5/8 of HYROX
    avgMinPerMile: 18,
    // reuse volume.ts progression constants unchanged
  },

  philosophy: {
    coach: "expert DEKA FIT coach",
    hybridGuidance: DEKA_FIT_HYBRID_GUIDANCE,   // "500 m run + 1 zone, ×10" (§4)
    library: DEKA_STATION_LIBRARY,              // §2.6
  },
};
```

## 2.2 `deka_mile`

```ts
export const deka_mile: SportConfig = {
  id: "deka_mile", family: "station_hybrid", displayName: "DEKA MILE",
  programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],

  // Low mileage, sharp: fewer runs than FIT but every run is quality/speed.
  sessionCounts: {
    run:    { base: [3,3,4], build: [3,4,4], peak: [3,3,4], taper: [2,2,3] },
    hybrid: { base: 1, build: 2, peak: 3, taper: 1 },
    lift:   3,
  },

  stations: DEKA_STATIONS,
  // MILE uses tap sit-up(Z4) + shoulder-over(Z8):
  raceStationOrder: [
    "deka_ram_lunge","deka_row","deka_box_over","deka_med_ball_sit_up","deka_ski",
    "deka_farmers_carry","deka_air_bike","deka_dead_ball_over","deka_sled","deka_ram_burpee",
  ],
  interStationRunMeters: 160,
  totalRaceRunMeters: 1600,

  // VO2 / anaerobic-capacity: most Z4/Z5 of the running DEKAs.
  phaseZoneTargets: {
    base:  { z1: 20, z2: 55, z3: 12, z4: 8,  z5: 5  },
    build: { z1: 16, z2: 48, z3: 15, z4: 13, z5: 8  },
    peak:  { z1: 12, z2: 40, z3: 16, z4: 18, z5: 14 },
    taper: { z1: 14, z2: 48, z3: 16, z4: 13, z5: 9  },
  },

  needsDomains: [DEKA_RUN_ENGINE_SPEED, DEKA_ERG_ENGINE, DEKA_STRENGTH], // run overlay = 160 m repeat
  experienceAxes: [
    { key: "running", label: "Running (speed)", bands: HYROX_RUNNING_BANDS, needsWeight: 1.0 },
    { key: "hybrid",  label: "HIIT / Hybrid", bands: HYROX_HYBRID_BANDS, needsWeight: 1.0 },
    { key: "lifting", label: "Lifting", bands: HYROX_LIFTING_BANDS, needsWeight: 0.9 },
  ],

  pacing: DEKA_MILE_PACING,   // 160 m split, 10 zones
  volume: {
    startMileageByRunExp: { beginner: 5, intermediate: 8, advanced: 12 }, // very low; speed-led
    avgMinPerMile: 18,
  },

  philosophy: {
    coach: "expert DEKA MILE coach",
    hybridGuidance: DEKA_MILE_HYBRID_GUIDANCE,  // "160 m sprint + 1 zone, ×10"
    library: DEKA_STATION_LIBRARY,
  },
};
```

## 2.3 `deka_strong` — control-flow delta (near-zero runs)

```ts
export const deka_strong: SportConfig = {
  id: "deka_strong", family: "station_hybrid", displayName: "DEKA STRONG",
  programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"], // run declared but floored to maintenance

  // No running in the race. Runs = maintenance floor (1/wk Z2), lift+hybrid dominate.
  sessionCounts: {
    run:    { base: [1,1,1], build: [1,1,1], peak: [0,1,1], taper: [0,0,1] },
    hybrid: { base: 2, build: 3, peak: 4, taper: 2 },  // station circuits are the core work
    lift:   3,
  },

  stations: DEKA_STATIONS,
  // STRONG uses tap sit-up(Z4) + shoulder-over(Z8), same order, NO runs between:
  raceStationOrder: [
    "deka_ram_lunge","deka_row","deka_box_over","deka_med_ball_sit_up","deka_ski",
    "deka_farmers_carry","deka_air_bike","deka_dead_ball_over","deka_sled","deka_ram_burpee",
  ],
  interStationRunMeters: 0,
  totalRaceRunMeters: 0,

  // Glycolytic / strength-endurance: station work IS the intensity → high Z3/Z4, Z5 spikes.
  phaseZoneTargets: {
    base:  { z1: 18, z2: 47, z3: 20, z4: 11, z5: 4  },
    build: { z1: 14, z2: 40, z3: 22, z4: 16, z5: 8  },
    peak:  { z1: 12, z2: 33, z3: 22, z4: 21, z5: 12 },
    taper: { z1: 14, z2: 40, z3: 21, z4: 17, z5: 8  },
  },

  needsDomains: [DEKA_ERG_ENGINE, DEKA_STRENGTH, DEKA_RUN_ENGINE], // run last / de-weighted
  experienceAxes: [
    { key: "lifting", label: "Lifting", bands: HYROX_LIFTING_BANDS, needsWeight: 1.0 },
    { key: "hybrid",  label: "Work Capacity / Hybrid", bands: HYROX_HYBRID_BANDS, needsWeight: 1.0 },
    { key: "running", label: "Aerobic (maintenance)", bands: HYROX_RUNNING_BANDS, needsWeight: 0.3 },
  ],

  pacing: DEKA_STRONG_PACING, // 10 zones, no run split; erg pulls back-to-back weighted heaviest
  volume: {
    startMileageByRunExp: { beginner: 3, intermediate: 5, advanced: 8 }, // maintenance dose only
    avgMinPerMile: 18,  // "cardio minutes" currency still tracks station work
  },

  philosophy: {
    coach: "expert DEKA STRONG coach",
    hybridGuidance: DEKA_STRONG_CIRCUIT_GUIDANCE, // "10 zones back-to-back, no runs"
    library: DEKA_STATION_LIBRARY,
  },
};
```

## 2.4 `deka_atlas` — control-flow delta (near-zero runs, distinct heavy catalog)

```ts
export const deka_atlas: SportConfig = {
  id: "deka_atlas", family: "station_hybrid", displayName: "DEKA ATLAS",
  programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],

  // Heaviest DEKA — lift-dominant. Runs maintenance-only; hybrid = barbell/DB metcon circuits.
  sessionCounts: {
    run:    { base: [1,1,1], build: [0,1,1], peak: [0,0,1], taper: [0,0,0] },
    hybrid: { base: 2, build: 3, peak: 3, taper: 1 },
    lift:   3,   // strength.ts is the workhorse here
  },

  stations: ATLAS_STATIONS,
  raceStationOrder: [
    "atlas_thruster","atlas_burpee_over_bar","atlas_surrender_lunge","atlas_db_g2oh",
    "atlas_db_bear_crawl","atlas_weighted_sit_up","atlas_farmers_carry","atlas_db_s2oh",
    "atlas_single_unders","atlas_shoulder_to_carry",
  ],
  interStationRunMeters: 0,
  totalRaceRunMeters: 0,

  // Strength-endurance / max-strength lean, least aerobic. Z2 maintenance + Z3/Z4 grind.
  phaseZoneTargets: {
    base:  { z1: 18, z2: 45, z3: 22, z4: 11, z5: 4 },
    build: { z1: 15, z2: 40, z3: 23, z4: 15, z5: 7 },
    peak:  { z1: 13, z2: 35, z3: 23, z4: 19, z5: 10 },
    taper: { z1: 15, z2: 42, z3: 22, z4: 15, z5: 6 },
  },

  needsDomains: [ATLAS_STRENGTH, ATLAS_PRESS_ENDURANCE, ATLAS_GLYCOLYTIC], // §1.3.2
  experienceAxes: [
    { key: "lifting", label: "Lifting (absolute strength)", bands: ATLAS_LIFTING_BANDS, needsWeight: 1.0 },
    { key: "hybrid",  label: "Barbell metcon / capacity", bands: HYROX_HYBRID_BANDS, needsWeight: 0.8 },
    { key: "running", label: "Aerobic (maintenance)", bands: HYROX_RUNNING_BANDS, needsWeight: 0.15 },
  ],

  pacing: DEKA_ATLAS_PACING, // 10 heavy zones, overhead-endurance weighted
  volume: {
    startMileageByRunExp: { beginner: 3, intermediate: 5, advanced: 8 },
    avgMinPerMile: 18,
  },

  philosophy: {
    coach: "expert DEKA ATLAS strength-conditioning coach",
    hybridGuidance: DEKA_ATLAS_CIRCUIT_GUIDANCE, // barbell/DB chipper, no runs
    library: ATLAS_STATION_LIBRARY,              // §2.6
  },
};
```

## 2.5 `deka_ultra` — endurance-heavy + duty-of-care

```ts
export const deka_ultra: SportConfig = {
  id: "deka_ultra", family: "station_hybrid", displayName: "DEKA ULTRA",
  programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],

  // Endurance-heaviest DEKA (5× FIT = 25 km + 50 zones). Highest run counts; big long run.
  sessionCounts: {
    run:    { base: [4,5,6], build: [4,5,6], peak: [3,4,5], taper: [2,3,3] },
    hybrid: { base: 1, build: 2, peak: 2, taper: 1 },  // long "durability" circuits, not many but long
    lift:   3,
  },

  stations: DEKA_STATIONS,          // FIT variants (throw / wall-over), performed ×5 in the race
  raceStationOrder: [               // one FIT lap; simulation builder repeats ×5 (see §4)
    "deka_ram_lunge","deka_row","deka_box_over","deka_sit_up_throw","deka_ski",
    "deka_farmers_carry","deka_air_bike","deka_wall_over","deka_sled","deka_ram_burpee",
  ],
  interStationRunMeters: 500,
  totalRaceRunMeters: 25000,        // 5 × 5000

  // Aerobic / muscular endurance: more Z2 than any DEKA (opposite of Strong/Atlas).
  phaseZoneTargets: {
    base:  { z1: 26, z2: 63, z3: 6, z4: 3, z5: 2 },
    build: { z1: 22, z2: 62, z3: 9, z4: 5, z5: 2 },
    peak:  { z1: 18, z2: 60, z3: 12, z4: 7, z5: 3 },
    taper: { z1: 20, z2: 61, z3: 11, z4: 5, z5: 3 },
  },

  needsDomains: [DEKA_RUN_ENGINE_DURABILITY, DEKA_ERG_ENGINE, DEKA_STRENGTH], // run weighted heaviest
  experienceAxes: [
    { key: "running", label: "Running / Aerobic base", bands: HYROX_RUNNING_BANDS, needsWeight: 1.5 },
    { key: "hybrid",  label: "Hybrid durability", bands: HYROX_HYBRID_BANDS, needsWeight: 0.9 },
    { key: "lifting", label: "Lifting", bands: HYROX_LIFTING_BANDS, needsWeight: 0.7 },
  ],

  pacing: DEKA_ULTRA_PACING, // 500 m split ×5 laps; controlled effort, not race-sprint
  volume: {
    startMileageByRunExp: { beginner: 20, intermediate: 32, advanced: 45 }, // above HYROX
    avgMinPerMile: 18,
    // Reuses volume.ts progression; big-week/recovery-week overlay in §3.
  },

  philosophy: {
    coach: "expert DEKA ULTRA / ultra-hybrid coach",
    hybridGuidance: DEKA_ULTRA_HYBRID_GUIDANCE, // long multi-lap durability blocks + fueling
    library: DEKA_STATION_LIBRARY,
  },

  // Duty-of-care: reference the triathlon long-course module (multisport-spec §3.8g).
  dutyOfCare: {
    longSessionMinThreshold: 150,       // flag any session ≥ 2.5 h
    fuelingGuidance: true,              // 60–90 g carb/h; rehearse, never debut race day
    beginnerGate: "warn",              // beginners warned + advised to run DEKA FIT first (Q4/Q5)
    bailoutPrompts: true,              // medical-clearance + bail-out cues on ≥ 4 h simulations
    reference: "triathlon:long_course_fueling_v1",
  },
};
```

**Flag — `dutyOfCare` shape.** P0 references `DutyOfCareConfig` but does not define it. Adopt the fields above (mirror the triathlon spec's module). **Add `DutyOfCareConfig` to P0 types** with: `longSessionMinThreshold: number`, `fuelingGuidance: boolean`, `beginnerGate: "off"|"warn"|"block"`, `bailoutPrompts: boolean`, `reference: string`.

## 2.6 Philosophy station libraries (by phase)

```ts
// Mirrors HYBRID_LIBRARY in philosophy.ts. Names must match StationSpec.label lowercased so
// stationIdFor/match lines up during reconciliation.
export const DEKA_STATION_LIBRARY = {
  base:  ["row","ski","air bike","farmers carry","med ball sit-up"],
  build: ["row","ski","ram alternating reverse lunge","farmers carry","dead ball shoulder-over","box step/jump over"],
  peak:  ["row","ski","magnetic sled push/pull","farmers carry","dead ball shoulder-over","ram weighted burpee","box step/jump over","ram alternating reverse lunge"],
  taper: ["row","ski","farmers carry"],
};

export const ATLAS_STATION_LIBRARY = {
  base:  ["barbell thruster","db shoulder-to-overhead","farmers carry","weighted sit-up","single-unders"],
  build: ["barbell thruster","single-arm db ground-to-overhead","db shoulder-to-overhead","surrender lunge","farmers carry","bar-facing burpee over bar"],
  peak:  ["barbell thruster","single-arm db ground-to-overhead","db shoulder-to-overhead","atlas shoulder-to-carry","farmers carry","surrender lunge","db bear crawl","bar-facing burpee over bar"],
  taper: ["barbell thruster","db shoulder-to-overhead","single-unders"],
};
```

---

# 3. Control-flow deltas beyond data

These are the behaviors **not expressible as pure `SportConfig`** and the exact engine parameterization needed. Function names refer to the current code.

### 3.1 `slots.ts` — sport-provided count tables (all DEKA)

`planWeek()` currently reads module-global `RUN_COUNT`/`HYBRID_COUNT`/`LIFT_SPLIT`. Change: read from `cfg.sessionCounts`.

- `RUN_COUNT[phase][ei]` → `cfg.sessionCounts.run[phase][ei]`.
- `HYBRID_COUNT[phase]` → `cfg.sessionCounts.hybrid[phase]` (per-phase scalar; widen HYROX to this shape too so the signature is uniform).
- Keep the deload/taper/bias clamps, but **change the run floor**: today `runs = Math.max(3, runs-1)` on deload and `Math.max(2, ...)` on taper. For Strong/Atlas this floor would resurrect runs the sport doesn't want. Parameterize the floor: `const runFloor = cfg.totalRaceRunMeters === 0 ? 0 : (deload ? 3 : 2)`. Apply in both branches.
- Bias clamp `clampInt(runs + delta, 3, 8)` → `clampInt(runs + delta, runFloor, 8)`.

### 3.2 `slots.ts` — near-zero run emission (Strong / Atlas)

When `cfg.totalRaceRunMeters === 0`:
- `buildRunSlots()` returns `[]` when `count === 0` (already handled — `if (count <= 0) return []`). So a `run:{...:[0,...]}` entry naturally emits no runs. **No new code, but verify** `interleave()` tolerates an empty run group (it does — `Math.max(0, ...)`).
- The maintenance run (count 1) must be **`easy` only** (Z2), never a quality run. Add: when `cfg.totalRaceRunMeters === 0`, `buildRunSlots` forces `runType: "easy"` regardless of phase filler. Implement as a `cfg` flag `runCharacter: "maintenance" | "full"` consumed by `buildRunSlots` (small addition) OR gate in `runFillers` on `cfg.totalRaceRunMeters === 0 → return ["easy",...]`.
- `slotPriority()` — a Strong/Atlas hybrid (circuit) is the priority session (already 90 > run). No change; the `simulation` peak hybrid still leads.

### 3.3 `slots.ts` — the "hybrid" session is a run+zone circuit, not 4-run/4-event (Fit / Mile / Ultra)

`buildHybridSlots()` is unchanged structurally (it emits `{kind:"hybrid", goalZone, simulation?}`); the **difference is downstream in assembly/AI**, driven by `cfg.interStationRunMeters` and the new hybrid guidance (§2.6). The engine slot itself carries no run geometry, so the only slot-level change is passing `cfg` through so the AI prompt gets the right "run N m + 1 zone ×10" instruction.

- **Simulation trigger**: `const simulate = phase === "peak" && (microWeek === "rebound" || microWeek === "increase")` — unchanged, applies to all DEKA that have hybrids.

### 3.4 `stations.ts` — parameterized catalog + simulation geometry (all DEKA)

- `STATIONS`/`RACE_STATION_ORDER` become `cfg.stations` (indexed by id) / `cfg.raceStationOrder`.
- `stationIdFor()` → iterate `cfg.stations` and test each `match` regex (order matters; put more-specific ids first, e.g. `deka_sit_up_throw` before `deka_med_ball_sit_up`). Return the first hit.
- `VOLUME_FACTOR` (base .6 / build .85 / peak 1 / taper .6) — reuse as-is; DEKA implements are also fixed (RAM rollers, dead balls), so progress **volume (reps/meters), not load**, exactly like HYROX.
- `stationPrescription()` — reuse; the `perHand` branch (`@ 2×${loadKg}kg`) already handles farmers/bear-crawl. Add a branch for the **no-kg device zones** (`deka_sled`, `deka_air_bike`): emit the `note` string instead of a kg load. Air-bike special-case (`${cal} cal air bike`) mirrors the existing assault-bike branch — generalize the hardcoded `"assault_bike"` id check to `spec.reps` being a `"N cal"` string.

### 3.5 `stations.ts` — `buildSimulationElements` variant (§4 has full geometry)

Parameterize by `interStationRunMeters` + `raceStationOrder`; for Ultra, loop the lap ×5. Full spec in §4.

### 3.6 `pacing.ts` — DEKA pacing tables (all DEKA)

`REF_STATION_SEC` is HYROX-keyed and module-global; `computePacingPlan` hardcodes `runTotalRaw = runSplit * 8` and `roxzone = 35 * order.length`. Deltas:

- Move `REF_STATION_SEC` into `cfg.pacing.refStationSec` keyed by DEKA/Atlas ids (concrete values below).
- Run total: `runSplitSecPerKm` scaled to `interStationRunMeters` (500 m ⇒ split×0.5×numRuns; 160 m ⇒ ×0.16). Generalize: `runTotalRaw = (interStationRunMeters/1000) * runSplitSecPerKm * numRuns` where `numRuns = raceStationOrder.length` (DEKA runs precede every zone) and `= 0` for Strong/Atlas.
- Roxzone/transition: DEKA transitions are shorter; use `ROXZONE_PER_STATION = 20` for DEKA (vs 35 HYROX). Store on `cfg.pacing.transitionSec`.
- Ski/row individualization: today derived from 2 k erg times; DEKA zones are **500 m**, so derive from `row500Time`/`ski500Time` directly (no half-and-fade). Add `cfg.pacing.ergDistanceMeters = 500`.

**Concrete `refStationSec` (mid-pack, seconds) — DEKA standard 10:**

```ts
const DEKA_REF_STATION_SEC = {
  deka_ram_lunge: 60, deka_row: 105, deka_box_over: 55, deka_sit_up_throw: 50,
  deka_med_ball_sit_up: 45, deka_ski: 115, deka_farmers_carry: 45, deka_air_bike: 70,
  deka_wall_over: 65, deka_dead_ball_over: 70, deka_sled: 95 /* slowest */, deka_ram_burpee: 80,
};
```

**Concrete `refStationSec` — Atlas 10:**

```ts
const ATLAS_REF_STATION_SEC = {
  atlas_thruster: 75, atlas_burpee_over_bar: 70, atlas_surrender_lunge: 65, atlas_db_g2oh: 70,
  atlas_db_bear_crawl: 55, atlas_weighted_sit_up: 45, atlas_farmers_carry: 50, atlas_db_s2oh: 75,
  atlas_single_unders: 40, atlas_shoulder_to_carry: 90,
};
```

- **Pro/division factor**: DEKA standard formats have a single Rx set → drop `PRO_STATION_FACTOR`. Atlas Foundation is *lighter* → apply an inverse factor `FOUNDATION_STATION_FACTOR = 0.9` on loaded zones when `division === "foundation"`.

### 3.7 `mesocycles.ts` — Ultra big-week/recovery + longer base (Ultra only)

`allocateMesocycles` is reused. Ultra deltas handled via existing knobs where possible:
- **Longer program / bigger Base**: Ultra should bias toward the 24-week cap. No code change — driven by `durationWeeks` input + the existing `distributeWorking` (Base already largest). Optionally add a per-sport `baseBiasWeeks` to `cfg` folded into `applyPhaseBias` (zero-sum, guarded) — **flag as optional interface addition**.
- **Big-week/recovery-week (3:1 → but longer accumulation)**: this lives in `microcycles.ts` (masters uses a 3-week 2:1; Ultra wants a long-course accumulation). Parameterize the microcycle pattern by `cfg` (e.g. `cfg.microcyclePattern?: "3:1" | "2:1" | "long_course"`). **Flag: interface addition** (`microcyclePattern` on `SportConfig` or `VolumeConfig`). Default `"3:1"` reproduces HYROX/other DEKA byte-for-byte.

### 3.8 `needs.ts` — sport domain set (Atlas only real divergence)

`analyzeNeeds` reads domains from `cfg.needsDomains`. Standard DEKA reuse `run_engine/erg_engine/strength` scorers (only anchors change → pass `cfg.needsAnchors`). Atlas needs three **new scorers** (`scoreAtlasStrength`, `scorePressEndurance`, `scoreGlycolytic`, §1.3.2) registered under the Atlas domain keys. The relative-gap limiter (`detectLimiters`) is domain-agnostic and unchanged.

---

# 4. Simulation builders (`buildSimulationElements` per format)

Current HYROX builder (`stations.ts`): 8× (1000 m run → station). Generalize:

```ts
export function buildSimulationElements(cfg: SportConfig, division = "rx", sex: StationSex = "male"): HybridElement[] {
  const els: HybridElement[] = [];
  const runM = cfg.interStationRunMeters ?? 0;
  const laps = cfg.id === "deka_ultra" ? 5 : 1;              // Ultra = 5 consecutive FIT laps
  for (let lap = 0; lap < laps; lap++) {
    for (const id of cfg.raceStationOrder!) {
      if (runM > 0) els.push({ exercise: "run", prescription: `${runM}m @ race pace (threshold)` });
      const spec = stationPrescription(labelFor(cfg, id), "peak", division, sex, cfg);
      els.push({ exercise: labelFor(cfg, id).toLowerCase(), prescription: spec?.prescription ?? labelFor(cfg, id) });
    }
  }
  return els;
}
```

**Per-format geometry:**

| Format | Run before each zone | Zones | Laps | Elements | Run total |
|---|---|---|---|---|---|
| **FIT** | 500 m | 10 | 1 | 20 (10 run + 10 zone) | 5,000 m |
| **MILE** | 160 m | 10 | 1 | 20 | 1,600 m |
| **STRONG** | — (runM=0) | 10 | 1 | 10 (zones only) | 0 |
| **ATLAS** | — (runM=0) | 10 (Atlas) | 1 | 10 (zones only) | 0 |
| **ULTRA** | 500 m | 10 | 5 | 100 (50 run + 50 zone) | 25,000 m |

- **Strong/Atlas**: no run elements — pure 10-zone chipper. `runM=0` skips the run push.
- **Ultra**: 100 elements is large; for AI-prompt sanity, emit **one representative lap (20 els) + a `repeat: 5` marker** rather than 100 literal elements, and let assembly expand. Add `HybridElement.repeat?: number` (flag: schema addition to `HybridSessionSchema.elements`). Race pace note for Ultra = "controlled effort (Z2–Z3), NOT threshold" — override the `@ race pace (threshold)` string when `cfg.id === "deka_ultra"`.
- **Peak-week simulation gating** unchanged from `slots.ts` (`simulation` flag on the first peak hybrid on rebound/increase weeks).

---

# 5. Experience-level bands per format

Reuse the HYROX band constants verbatim (from `multisport-spec.md §4`), applied via `ExperienceAxis.bands`, with **per-format `needsWeight`** (already in §2) and a **DEKA-specific overlay test** per format.

```ts
export const HYROX_RUNNING_BANDS = [
  { level: "beginner",     criterion: "<15 mi/wk (6-mo avg)" },
  { level: "intermediate", criterion: "15–30 mi/wk" },
  { level: "advanced",     criterion: ">30 mi/wk" },
];
export const HYROX_HYBRID_BANDS = [
  { level: "beginner",     criterion: "≤1 HIIT/hybrid session per week" },
  { level: "intermediate", criterion: "2 per week" },
  { level: "advanced",     criterion: "≥3 per week" },
];
export const HYROX_LIFTING_BANDS = [
  { level: "beginner",     criterion: "<3 yr consistent lifting" },
  { level: "intermediate", criterion: "3–5 yr" },
  { level: "advanced",     criterion: ">5 yr" },
];
export const ATLAS_LIFTING_BANDS = [   // absolute-strength floor matters (research-deka Atlas)
  { level: "beginner",     criterion: "<3 yr lifting; below 95 lb thruster ×20 or 100 lb/hand carry" },
  { level: "intermediate", criterion: "3–5 yr; can complete Rx thruster + carry loads" },
  { level: "advanced",     criterion: ">5 yr; Rx loads unbroken, relative squat >1.75× / press >0.9×" },
];
```

**Per-format weighting + overlay test:**

| Format | Running w | Hybrid w | Lifting w | DEKA overlay test → competitive band |
|---|---|---|---|---|
| FIT | 1.0 | 1.0 | 0.9 | **10-zone (or partial 5-zone) TT**: elite ~30 min, competent AG ~40–50 min; weight 500 m repeat ability |
| MILE | 1.0 | 1.0 | 0.9 | **160 m/400 m/mile speed** overlay; a strong 5 K runner who never sprint-repeats is still MILE-intermediate |
| STRONG | 0.3 | 1.0 | 1.0 | **10-zone STRONG TT**: M bands beg ~29:00 / int ~19:20 / adv ~14:35 / elite ~11:27 (`research-deka.md`) |
| ATLAS | 0.15 | 0.8 | 1.0 (`ATLAS_LIFTING_BANDS`) | **Atlas TT**: elite <10 min, superior 15–20, above-avg 20–25 (30-min cap); absolute-strength floor |
| ULTRA | 1.5 | 0.9 | 0.7 | **aerobic base + durability history**: long-run history + Riegel; beginners gated/warned (Q5) |

Overlay is applied as a needs-analysis modifier: the TT maps the athlete onto a competitive band which nudges `runEmphasis`/phase bias within the existing bounded `ProgramBias` — it never overrides the user's self-reported experience axis, only informs limiter detection.

---

# 6. Tests to write (vitest) + open questions/risks

## 6.1 Tests

**Catalog integrity (`stations-deka.test.ts`, `stations-atlas.test.ts`):**
1. `DEKA_STATIONS` has exactly the 10 canonical zones + the 2 sibling variants (12 specs); every `match` regex matches its own `label` and does not mis-match a sibling (e.g. `deka_sit_up_throw` regex must not swallow `deka_med_ball_sit_up`, and vice-versa — assert first-hit ordering).
2. `ATLAS_STATIONS` has 10 specs; loaded zones carry both `rx` and `foundation`; bodyweight zones (`burpee_over_bar`, `single_unders`) carry no `loadKg`.
3. Load values match the table in `research-deka.md` (kg, ≥ tolerance) — snapshot the kg values so a Rules-PDF bump is a visible diff.
4. `perHand` set on farmers/bear-crawl; `note` present on `deka_sled`/`deka_air_bike`.

**Geometry (`sim-geometry.test.ts`):**
5. `buildSimulationElements` element counts: FIT 20, MILE 20, STRONG 10, ATLAS 10, ULTRA 100 (or 20 + `repeat:5`).
6. Run totals: FIT 5000, MILE 1600, STRONG 0, ATLAS 0, ULTRA 25000 (sum of run prescriptions).
7. Strong/Atlas emit **zero** run elements; Ultra run prescription string says "controlled effort", not "threshold".

**Slot planning (`slots-deka.test.ts`):**
8. `planWeek` for `deka_strong`/`deka_atlas` yields `runs === 0` in phases where the table says 0, and never resurrects a run via the deload/taper floor (`runFloor === 0`).
9. `deka_fit`/`deka_mile` produce runs bounded by their tables; bias clamp respects the sport `runFloor`.
10. Hybrid counts ramp Base→Peak per table; peak rebound/increase week sets `simulation: true` on the first hybrid.

**Zone targets (`zones-deka.test.ts`):**
11. Every `phaseZoneTargets` distribution sums to 100 for all 5 formats × 4 phases.
12. Ordering invariants: `deka_ultra.base.z2 > deka_fit.base.z2 > deka_mile.base.z2`; `deka_mile.peak.z5 > deka_fit.peak.z5`; Strong/Atlas Z3+Z4 > their Z2 in peak.

**Needs (`needs-deka.test.ts`):**
13. Standard-format needs reuse `run_engine/erg_engine/strength` and degrade to `NEUTRAL_BIAS` with <2 scorable domains (backward-compat parity with HYROX).
14. Atlas domains resolve to `strength/press_endurance/glycolytic`; `scorePressEndurance`/`scoreGlycolytic` return null with no benchmarks.

**Volume (`volume-deka.test.ts`):**
15. `startMileageByRunExp` ordering: Ultra > Fit > Mile > Strong ≈ Atlas across every experience level.

**Pacing (`pacing-deka.test.ts`):**
16. `computePacingPlan` run total scales with `interStationRunMeters` (500 vs 160); Strong/Atlas run total 0; transitionSec uses 20 (not 35).
17. Foundation division applies the 0.9 factor to loaded Atlas zones only.

**Golden regression (the HYROX gate stays green):**
18. **HYROX byte-identical**: adding DEKA to `SPORTS` must not touch `SPORTS.hyrox` output — re-run the P0 golden skeleton snapshot after DEKA lands.

**Duty-of-care (`duty-deka.test.ts`):**
19. `deka_ultra` sessions ≥150 min raise the long-session flag; beginner + Ultra triggers the warn gate; other DEKA never trigger it.

## 6.2 Open questions / risks

- **Q1 — Versioned, lb-primary load table.** DEKA Rules PDF is versioned (v20250203→v20250902); loads are pounds. Decision: store kg in-catalog (engine convention) with lb in comments, single editable file, "verify vs current event standards" disclaimer surfaced in onboarding + on the pacing card. Do we also persist a `standardsVersion` string on the program for audit? (Recommended: yes.)
- **Q2 — Atlas standards unverified.** Atlas loads/bands are community-sourced (`research-deka.md §Flags`). Ship behind the disclaimer; flag Atlas as "beta standards." Confirm we're comfortable shipping.
- **Q3 — Ultra duty-of-care gating.** `beginnerGate: "warn"` vs `"block"` (multisport §8 Q5). Recommend `warn` + route beginners to DEKA FIT first, mirroring 140.6→70.3. Needs product sign-off; also confirm the `DutyOfCareConfig` interface addition (§2.5).
- **Q4 — Interface additions required (must land in P0 types before coding DEKA):**
  1. `StationSpec.perHand?: boolean`, `StationSpec.note?: string` (§1.1).
  2. `DutyOfCareConfig` concrete shape (§2.5).
  3. `SessionCounts.hybrid` widened to per-phase table (uniform with `run`) (§3.1).
  4. `HybridElement.repeat?: number` for Ultra lap expansion (§4) — or accept 100 literal elements.
  5. `SportConfig.microcyclePattern?` + optional `baseBiasWeeks` for Ultra long-course accumulation (§3.7) — optional; default reproduces existing behavior.
  6. `PacingConfig` must expose `refStationSec` (keyed by sport station ids), `transitionSec`, `ergDistanceMeters`, and a division/foundation factor (§3.6) — HYROX's currently-hardcoded `pacing.ts` constants become `cfg.pacing`.
  7. `VolumeConfig` key name: spec uses `startMileageByRunExp` (matches the P0 HYROX example) — confirm final field name vs `volume.ts STARTING_MILEAGE`.
  8. `NeedsDomainConfig` must carry per-domain anchors + scorer id so Atlas can register new scorers without a new `switch` in `needs.ts` (§3.8).
- **Q5 — "Maintenance run character" flag.** Strong/Atlas maintenance runs must be forced to `easy` (§3.2). Prefer a `cfg` flag (`runCharacter`) over hardcoding `totalRaceRunMeters === 0` in `buildRunSlots`? (Recommend the flag for clarity.)
- **Q6 — Sled/air-bike no-kg prescription.** Zone 9 (magnetic sled) has a device-level, not a kg load, and Zone 7 (air bike) is calories. Confirm the `note`-based prescription + the generalized cal-branch in `stationPrescription` (§3.4) is acceptable UX (vs inventing a kg equivalent).
- **Q7 — Ultra element volume in the AI prompt.** 100 literal simulation elements risks prompt bloat / token cost; the `repeat:5` lap marker (Q4.4) is the mitigation. Confirm assembly can expand a repeated lap deterministically.
- **Risk — energy-system zone shifts are engineering estimates.** The `phaseZoneTargets` numbers are calibrated to the qualitative energy-system descriptions in `research-deka.md`/`multisport-spec.md`, not to measured DEKA physiology. They preserve the required ordering (Ultra most-aerobic → Mile most-anaerobic; Strong/Atlas station-intensity dominant) but should be reviewable in one file for tuning, exactly like `PHASE_ZONE_TARGETS`.
```
