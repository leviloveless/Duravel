# Duravel P0 — Sport-Abstraction Interface Design

**Author:** Claude, for Levi · **Date:** 2026-07-16
**Status:** Engineering design draft — no code written yet. This is the locked foundation the 9-sport build stacks on.
**Companion to:** `docs/future-phases/14-multisport-program-builder.md` (design) and `01-triathlon-engine.md` (triathlon).

> **Purpose.** Define the exact seam that turns the HYROX engine into a sport-parametric engine, such that (a) HYROX output is **byte-identical** before/after, (b) the three sport families (station-hybrid, triathlon, general-fitness) all express cleanly, and (c) per-sport work after this can proceed in parallel against a stable contract. Nothing here adds a sport — P0 only refactors HYROX into "sport #1."

---

## 1. Design principles

1. **No behavior change in P0.** HYROX becomes `SPORTS.hyrox`; a golden snapshot of a canonical HYROX program must be byte-identical before/after. This is the exit gate.
2. **Config vs. behavior split.** Most per-sport variation is *data* (`SportConfig` — catalogs, count tables, anchors, copy). A *small* residue is *control flow* (`ProgramType` — race-peaking macro-arc vs. general-fitness rotation; single-currency volume vs. multi-discipline TSS). Keep the data path fat and the behavior path thin.
3. **The engine still owns numbers; AI still fills content.** The boundary is unchanged. `SportConfig` feeds both the deterministic engine and the prompt builder from one source of truth.
4. **Additive at the type level.** Generalize unions by *widening the valid set per sport*, not by rewriting every `switch`. Existing HYROX branches keep working; new sports register new branches.
5. **Shared code moves to `lib/engine/shared/`; nothing HYROX-specific stays module-global.** Today's global constants (station tables, count tables, anchors) become `SPORTS.hyrox` fields.

---

## 2. The two-layer contract

### 2.1 `SportConfig` — the data registry entry (fat)

One per sport. Resolved by `SPORTS[sport]`. Everything the deterministic engine + prompt builder need that varies by sport.

```ts
// lib/engine/sports/types.ts
export type SportId =
  | "hyrox"
  | "deka_fit" | "deka_mile" | "deka_strong" | "deka_atlas" | "deka_ultra"
  | "tri_70_3" | "tri_140_6"
  | "general_fitness";

export type SportFamily = "station_hybrid" | "triathlon" | "general_fitness";

/** A modality is a schedulable session kind for this sport. Family A: run|lift|hybrid.
 *  Family B: swim|bike|run|brick|strength. Family C: run|lift|cardio. rest|race always valid. */
export type Modality =
  | "run" | "lift" | "hybrid"            // station-hybrid
  | "swim" | "bike" | "brick"            // triathlon (run reused)
  | "cardio" | "strength"               // general fitness / cross-family
  | "rest" | "race";

export interface ExperienceAxis {
  key: string;                          // "running" | "swim" | "bike" | "lifting" | ...
  label: string;
  /** Ordered, measurable band definitions shown in onboarding + used for defaults. */
  bands: { level: "beginner" | "intermediate" | "advanced"; criterion: string }[];
  /** Relative weight this axis gets in the needs analysis for this sport (0 = ignore). */
  needsWeight: number;
}

export interface StationSpec {
  id: string;                           // "sled_push" | "deka_ram_lunge" | "atlas_thruster" ...
  label: string;
  /** Fixed race prescription; loads keyed by division × sex where relevant. */
  meters?: number; reps?: number | string;
  loadKg?: Record<string, Record<"male" | "female", number>>; // e.g. {open:{male,female}, pro:{...}}
  /** Regex to map free-text AI names back to this id (kept from stations.ts). */
  match?: RegExp;
}

export interface SportConfig {
  id: SportId;
  family: SportFamily;
  displayName: string;

  /** Which session kinds this sport schedules, and the per-phase counts. */
  modalities: Modality[];
  /** Per-phase session-count tables. Family A keys: runs/lifts/hybrids. Family B: swim/bike/run/brick.
   *  Family C: strength/cardio. Indexed by experience where HYROX indexes today. */
  sessionCounts: PhaseCountTable;

  /** Station catalog + race order + simulation geometry. Empty for pure-cardio sports. */
  stations?: StationSpec[];
  raceStationOrder?: string[];          // ids, in race order
  /** Run/segment geometry between stations: HYROX 1000m; DekaFit 500m; Mile 160m; Strong 0. */
  interStationRunMeters?: number;
  totalRaceRunMeters?: number;          // HYROX 8000; DekaFit 5000; Mile 1600; Strong 0; Ultra 25000

  /** Energy-system → zone-distribution override per phase (else the shared default). */
  phaseZoneTargets?: Record<PhaseName, ZoneDistribution>;

  /** Needs analysis: which domains this sport scores + their anchors (sport-specific). */
  needsDomains: NeedsDomainConfig[];
  /** Experience axes that apply, with measurable bands + needs weights. */
  experienceAxes: ExperienceAxis[];

  /** Pacing reference table (station seconds, run split refs) for the race plan. */
  pacing?: PacingConfig;

  /** Starting-volume bands + progression units for this sport's volume currency. */
  volume: VolumeConfig;

  /** Copy injected into the prompt: "expert X coach", guidance blocks, station library by phase. */
  philosophy: PhilosophyConfig;

  /** Which ProgramType behavior drives the macro-arc + volume currency. */
  programType: ProgramTypeId;           // "race_peaking" | "general_fitness"

  /** Optional: duty-of-care gating + long-session/fueling flags (140.6, DekaUltra). */
  dutyOfCare?: DutyOfCareConfig;
  /** Optional: sub-goal bias vectors (general fitness). */
  subGoals?: SubGoalConfig[];
}
```

### 2.2 `ProgramType` — the behavior interface (thin)

Only the handful of things that are genuine control-flow, not data. Two implementations cover all 9 sports.

```ts
// lib/engine/program-types/types.ts
export type ProgramTypeId = "race_peaking" | "general_fitness";

export interface ProgramType {
  id: ProgramTypeId;

  /** Base/Build/Peak/Taper allocation. race_peaking = today's mesocycles.ts.
   *  general_fitness = permanent Base + rotating emphasis, no peak/taper. */
  allocateMacrocycle(input: EngineInput, cfg: SportConfig): MesocycleAllocation | RotationPlan;

  /** Weekly volume targets in this sport's currency.
   *  race_peaking + family A/C → { miles, cardioMinutes }.
   *  race_peaking + family B  → DisciplineVolume[] (per-discipline hours → TSS). */
  weeklyVolume(week: WeekContext, cfg: SportConfig): VolumeTargets;

  /** Whether to emit taper weeks before races (race_peaking) or never (general_fitness). */
  buildsToRace: boolean;

  /** general_fitness only: the re-test cadence that replaces the race. */
  retestEveryWeeks?: number;
}
```

**Mapping:** `race_peaking` = the existing engine (HYROX, all DEKA, both triathlon). `general_fitness` = the rotation model. The *volume currency* difference (miles+minutes vs. per-discipline TSS) is handled inside `race_peaking.weeklyVolume` by branching on `cfg.family`, keeping triathlon's TSS ledger isolated to family B.

---

## 3. `SPORTS.hyrox` — proving the shape (HYROX as data)

P0's real test: express today's hardcoded HYROX constants purely as `SPORTS.hyrox` with no behavior change.

```ts
// lib/engine/sports/hyrox.ts  (values lifted verbatim from today's engine)
export const hyrox: SportConfig = {
  id: "hyrox", family: "station_hybrid", displayName: "HYROX",
  programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],
  sessionCounts: {                     // from slots.ts RUN_COUNT/HYBRID_COUNT/LIFT_SPLIT
    run:   { base: [3,4,5], build: [4,5,6], peak: [3,4,4], taper: [2,3,3] },
    hybrid:{ base: 1, build: 2, peak: 3, taper: 1 },
    lift:  3,
  },
  stations: STATIONS_AS_SPECS,         // from stations.ts STATIONS (verbatim loads/meters/reps)
  raceStationOrder: RACE_STATION_ORDER,
  interStationRunMeters: 1000, totalRaceRunMeters: 8000,
  phaseZoneTargets: PHASE_ZONE_TARGETS, // from volume.ts (base 25/60/8/4/3 … taper 18/57/13/7/5)
  needsDomains: [run_engine, erg_engine, strength], // from needs.ts anchors
  experienceAxes: [runningAxis, hybridAxis, liftingAxis], // the current 3, verbatim bands
  pacing: HYROX_PACING,                // pacing.ts refs (REF_RUN_SPLIT_SEC, station secs, PRO factor)
  volume: { startMileageByRunExp: {beginner:12,intermediate:22,advanced:35}, avgMinPerMile:18, … },
  philosophy: { coach: "expert HYROX coach", hybridGuidance: "4 runs + 4 events…", library: HYBRID_LIBRARY },
};
```

If `buildSkeleton` + `assembleProgram` produce a byte-identical program when fed `SPORTS.hyrox` instead of the inline constants, the abstraction is correct. **That diff being empty is the P0 exit gate.**

---

## 4. File-by-file refactor map

| File | Change |
|---|---|
| `lib/engine/sports/types.ts` | **New.** `SportConfig`, `Modality`, `StationSpec`, `ExperienceAxis`, sub-configs above. |
| `lib/engine/sports/hyrox.ts` | **New.** HYROX constants moved here verbatim as `SPORTS.hyrox`. |
| `lib/engine/sports/index.ts` | **New.** `SPORTS: Record<SportId, SportConfig>` registry + `getSport(id)`. |
| `lib/engine/program-types/*` | **New.** `ProgramType` interface + `race_peaking` (wraps today's mesocycle/volume logic) + stub `general_fitness`. |
| `lib/engine/types.ts` | `EngineInput` gains `sport: SportId`. `SessionSlot` union widened to include future modalities behind `Modality` (HYROX still emits run/lift/hybrid/rest/race). |
| `lib/schemas.ts` | `GenerationInputSchema` gains `sport` (default `"hyrox"`). `SessionSchema` discriminated union stays; new kinds added per family later. |
| `lib/engine/mesocycles.ts` | Reads anchors/counts from `cfg` instead of module constants; logic unchanged. Shared math → `lib/engine/shared/`. |
| `lib/engine/microcycles.ts`, `volume.ts` | Read starting-volume + progression from `cfg.volume`; masters/deload logic unchanged (shared). |
| `lib/engine/slots.ts` | `planWeek` reads `cfg.sessionCounts`; `interleave` iterates `cfg.modalities`. HYROX path identical. |
| `lib/engine/stations.ts` | Becomes a consumer of `cfg.stations`/`cfg.raceStationOrder`; `buildSimulationElements` parameterized by `interStationRunMeters` + order. HYROX values from `SPORTS.hyrox`. |
| `lib/engine/strength.ts`, `sequencing.ts`, `taper.ts`, `readiness.ts`, `load.ts`, `adapt*.ts`, `zones.ts` | **Move to `lib/engine/shared/` largely as-is** (already sport-neutral). Minor: taper/zones read targets from `cfg` where HYROX had constants. |
| `lib/engine/needs.ts` | Domain set + anchors come from `cfg.needsDomains`; relative-gap limiter logic unchanged (shared). |
| `lib/ai/philosophy.ts`, `prompts.ts` | Read coach string, guidance blocks, station library from `cfg.philosophy`. |
| `lib/generation/*` | `generateProgram`/`assembleProgram` thread `cfg` (resolved from `program.sport`) into skeleton build + assembly. |
| `app/onboarding/*` | Add sport picker as step 0; keep HYROX sub-form as the `hyrox` case. |
| DB | `programs.sport text not null default 'hyrox'` (widens the triathlon spec's `program_type`); backfill no-op. |
| Tests | **New golden snapshot test**: canonical HYROX input → frozen `program_data`. Runs in CI as the byte-identical gate. |

**Scope discipline:** P0 changes *where values come from*, never *what they are*. New modalities/kinds are declared in the union but only HYROX's subset is emitted until P1+.

---

## 5. Generalizing `SessionSlot` (the spine) safely

The union `run | lift | hybrid | rest | race` is threaded through ~6 files via `switch (kind)`. Rather than rewrite them:

1. Widen `Modality` to the full cross-family set now; leave every existing `switch` with its current cases.
2. Each sport's `cfg.modalities` declares which kinds it emits; the engine only ever produces kinds a sport declares. HYROX declares exactly today's set → every existing `switch` sees only cases it already handles → no behavior change.
3. New families add new `case`s to the relevant switches *when they're built* (P1 adds swim/bike/brick handling in `slots`/`assemble`/`reconcile`). Each addition is guarded by the sport that needs it.

This keeps P0 a pure lift-and-shift and defers the genuinely new control flow (bricks, TSS reconciliation) to the family that introduces it — exactly where the triathlon spec already designed it.

---

## 6. Volume currency: one interface, two implementations

- **Family A + C** (`race_peaking`/`general_fitness`, single-currency): `weeklyVolume` returns `{ miles, cardioMinutes }` — today's path. `reconcile.ts` unchanged.
- **Family B** (`race_peaking`, triathlon): `weeklyVolume` returns `DisciplineVolume[]` (per-discipline hours), reconciled per discipline and summed to unified TSS for adaptation (per triathlon spec §5.4/§8). This lives behind the same `ProgramType.weeklyVolume` method, branching on `cfg.family`, so ACWR/monotony/readiness consume one `load_tss` scale regardless of sport.

The adaptation engine (`adapt.ts`/`load.ts`/`readiness.ts`) already operates on abstract load + compliance, so it needs **no change** for P0 and only a load-source generalization for family B.

---

## 7. Byte-identical test strategy (the P0 gate)

1. **Freeze the oracle now**, before touching code: generate a canonical HYROX program (a fixed representative input — e.g. 16-week goal-event, intermediate/intermediate/intermediate, 5 training days, one A race, a benchmark set) and commit its `program_data` + `skeleton` JSON as a golden fixture.
2. **Snapshot test** rebuilds that program from the same input after each refactor commit and asserts deep equality against the fixture. Any diff fails CI.
3. Because generation's AI fill is non-deterministic, the gate runs on the **deterministic skeleton** (`buildSkeleton`) + the **reconciled/overwritten numeric layer** (strength schemes, station progression, volume reconciliation) — the parts the engine owns. AI content is validated separately against fixture AI outputs, not live Haiku (matches the triathlon spec's testing guidance).
4. Exit gate: golden skeleton byte-identical + `next build` green + existing vitest suite green.

---

## 8. What P0 explicitly does NOT do

- No new sport is generatable yet (registry has only `hyrox`).
- No swim/bike/brick handling, no TSS, no DB benchmark tables, no generation queue — those land with the family that needs them (P1 triathlon per its spec; P1/P3 DEKA + general fitness).
- No HYROX science changes (§6 of the design doc) — deferred to P4.

---

## 9. After P0 — how the parallel build attaches

Once `SportConfig`/`ProgramType` are locked and HYROX is proven byte-identical, each sport is authored as **one `SPORTS.<id>` module + any family-new control-flow** against this stable contract. That's what makes Stages 2–3 parallelizable: DEKA sports are almost pure `SportConfig` data (new catalogs/counts/anchors) plus small `slots`/`stations` parameterization; triathlon is its own track (new modalities + TSS) but plugs into the same registry; general fitness is one new `ProgramType` + `SportConfig`. The per-sport build-ready specs (Stage 1) fill in each `SportConfig`'s exact field values against this interface.
