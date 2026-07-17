# Duravel P0 Interface — v2 Amendments (consolidated from Stage 1)

**Author:** Claude, for Levi · **Date:** 2026-07-16
**Applies to:** `15-P0-sport-abstraction-design.md`. Apply these deltas before implementing P0.
**Source:** the three Stage 1 build-ready specs (`16-spec-deka-family.md`, `17-spec-triathlon.md`, `18-spec-general-fitness.md`) each exercised the v1 interface against real sport data and flagged where it was insufficient. This reconciles all flags into one authoritative set of changes. None of these alter HYROX behavior — the byte-identical gate is unaffected.

> **Why this exists.** Running the per-sport specs before writing code surfaced the interface's blind spots while they're still free to fix. Every item below was demanded by ≥1 sport family; overlaps are merged and conflicts resolved.

---

## A. Session-slot / modality union (the spine) — the biggest gap

**A1. Add the new slot kinds now, guarded by sport.** v1 said "widen `Modality`"; the concrete set the three families need:
- `SwimSlot { kind:"swim"; goalZone; isLong?; sessionType: "technique"|"css"|"threshold"|"endurance"|"open_water" }`
- `BikeSlot { kind:"bike"; goalZone; isLong?; sessionType: "endurance"|"sweet_spot"|"threshold"|"vo2"|"recovery" }`
- `BrickSlot { kind:"brick"; segments: BrickSegment[] }` where `BrickSegment { modality:"bike"|"run"|"swim"; durationMin; goalZone; note? }`
- `CardioSlot { kind:"cardio"; goalZone; modality?: string; sessionType?: "z2"|"vo2"|"threshold" }`

**A2. Close the `cardio` schema-vs-engine gap (general fitness).** `CardioSession` already exists in `lib/schemas.ts` output, but there is **no `CardioSlot` in the engine `SessionSlot` union** (`lib/engine/types.ts`) — today cardio is only injected by the reconciler. General fitness schedules cardio as a first-class slot, so `CardioSlot` must exist at the engine slot layer, not just in output. (Flagged E4 by general-fitness.)

**A3. Every `switch (kind)` site keeps its current HYROX cases;** new cases are added by the family that introduces them (triathlon adds swim/bike/brick handling in `slots`/`assemble`/`reconcile`; general fitness adds cardio). HYROX still emits only run/lift/hybrid/rest/race → byte-identical proof holds.

---

## B. Count tables — generalize to per-phase and per-discipline

**B1.** `SportConfig.sessionCounts` in v1 mixed a per-phase table (`run`) with flat values (`hybrid: {base,build...}` and `lift: 3`). Normalize **all** modality counts to the same per-phase, experience-indexed table shape (DEKA flagged `hybrid` should be per-phase; general fitness needs day-count-driven tables).

**B2.** For the **triathlon family**, counts are **per-discipline per-phase** (`swim/bike/run/brick` each get a phase table). Represent as `Record<Modality, PhaseCountTable>` so family A uses run/lift/hybrid keys and family B uses swim/bike/run/brick keys against the same type. (Triathlon EXT-1.)

---

## C. Config types referenced but undefined in v1 — define them

**C1. `DutyOfCareConfig`** (used by 140.6, DekaUltra):
```ts
interface DutyOfCareConfig {
  longSessionFlagMinutes: number;        // surface fueling/hydration guidance beyond this
  fueling?: { carbGramsPerHour: [number, number]; hydrationMlPerHour: [number, number]; sodiumMgPerHour: [number, number] };
  warnings: string[];                    // EAH, bonk, heat, "rehearse don't experiment", bail-out
  gateBeginners?: boolean;               // block/redirect true beginners (140.6, DekaUltra)
}
```

**C2. `PacingConfig`** (used by every station sport for the race plan):
```ts
interface PacingConfig {
  refRunSplitSecPerKm?: number;
  refStationSec: Record<string, number>; // stationId → reference seconds
  proStationFactor?: number;
  transitionSec: number;                 // HYROX roxzone 35; DEKA ~20
  compromisedRunFactor?: number;
}
```

**C3. `NeedsDomainConfig`** — add per-domain anchors + a `scorerId` so a sport registers new scorers (e.g. Atlas press-endurance) without editing a central `switch`:
```ts
interface NeedsDomainConfig {
  key: string;                           // "run_engine" | "swim" | "press_endurance" | ...
  label: string;
  scorerId: string;                      // selects the scoring function
  anchors: Record<string, [number, number]>; // sex/context → [best, worst] or [worst, best]
  weight: number;
}
```

**C4. `SubGoalConfig`** (general fitness):
```ts
interface SubGoalConfig {
  key: "recomp" | "general_strength" | "general_endurance" | "balanced";
  label: string;
  volumeBias: { aerobicFactor: number; strengthFactor: number }; // multipliers
  sessionDelta: Partial<Record<Modality, number>>;
  floors: { aerobicMinutesMin: number; strengthDaysMin: number };  // applied last
  cues?: string[];                       // e.g. protein 1.6–2.2 g/kg for recomp
}
```

**C5. `RotationPlan`** (general fitness — the non-race macro-arc):
```ts
interface RotationBlock { emphasis: "strength"|"aerobic"|"mixed"; weeks: number }
interface RotationPlan {
  blocks: RotationBlock[];               // laid down in order, repeated to fill D, final truncated
  retestEveryWeeks: number;              // 8–12
}
```
`ProgramType.allocateMacrocycle` returns `MesocycleAllocation | RotationPlan` (already in v1); the general-fitness impl returns `RotationPlan`. Emphasis maps to a **synthetic `PhaseName`** so `strength.ts`/`PHASE_ZONE_TARGETS`/`skeleton.ts` run unmodified, while a new `WeekSkeleton.emphasis` field carries the real label for UI/AI.

**C6. `VolumeConfig` — two variants.** Family A/C: `{ startMileageByExp, avgMinPerMile, ... }` (today's). Family B: `{ hoursPerWeekByLevel: Record<distance×level, [base,peak]>, disciplineBalanceByPhase, ... }`. Type as a discriminated union on `family`. `DisciplineVolume { discipline; hours; targetTss }` is the family-B weekly output. (Triathlon EXT-6.)

---

## D. Small struct additions

- **D1. `StationSpec.perHand?: boolean`** (farmers/DB carries) and **`StationSpec.note?: string`** (no-kg device prescriptions: sled level, air-bike cals). (DEKA.)
- **D2. `HybridElement.repeat?: number`** — DekaUltra = 5 laps; avoids 100 literal elements. (DEKA.)
- **D3. `WeekSkeleton.emphasis?: string`** and **`WeekSkeleton.retest?: boolean`** — general-fitness rotation label + re-test week marker. (General fitness E3.)
- **D4. `VolumeTargets.strengthVolume?`** — general fitness tracks a strength-volume signal alongside miles+minutes. (General fitness E2.)

---

## E. Inputs + generalizing hardcoded HYROX constants

- **E1. `GenerationInput.sport: SportId`** (already in v1) **+ `GenerationInput.subGoal?: SubGoalConfig["key"]`** (general fitness). Schema: add both, `sport` default `"hyrox"`.
- **E2. Raise the duration cap.** `GenerationInputSchema.durationWeeks` is `max(24)`; **140.6 needs up to 30 weeks** (beginner 24–30). Raise the cap to **30** (consider 36 for future ultra). This is additive — HYROX ≤24-week outputs are unchanged, so byte-identical holds. Note `mesocycles.ts` anchors are defined at 20 weeks and scale, so no anchor change is required, but add a test at 30 weeks.
- **E3. Generalize the taper length** from HYROX's fixed values to `SportConfig`-provided (70.3 = 2 wk, 140.6 = 2–3 wk, DEKA C-race short). `taper.ts` reads taper weeks/factors from config; HYROX values come from `SPORTS.hyrox` → byte-identical. (Triathlon EXT-11/12.)

---

## F. Behavior (not data) that P0's interface must accommodate

These aren't new types but confirm the `ProgramType`/`slots` seam is shaped to allow them later:
- **F1. Run-floor override** — DekaStrong/Atlas emit near-zero runs; the deload/taper run floors in `slots.ts` must be sport-provided (a `runFloor`/`minRuns` in `sessionCounts`) so they don't resurrect runs. (DEKA.)
- **F2. Per-discipline reconciliation + unified TSS** — family-B `weeklyVolume` → `DisciplineVolume[]`, reconciled per discipline, summed to one TSS scale for adaptation. Isolated to family B; `adapt.ts`/`load.ts` consume one `load_tss` regardless. (Triathlon.)
- **F3. Interference scheduling** — general fitness generalizes `sequencing.ts` `isKeyRun → isHardConditioning` (reuse the swap logic) + a same-day intensity clamp. (General fitness.)
- **F4. Rotation autoregulation** — `autoregulateRotation` (the needs.ts analogue) feeds re-test results into the next block's emphasis. (General fitness.)

---

## G. Net effect on the P0 plan

- P0 still delivers only HYROX generatable + byte-identical, but the interface it lands is **v2** (this doc), so per-sport work attaches with **zero interface churn**.
- The additions are almost entirely **additive types + config fields**; the only touches to existing shared code are: (i) add `CardioSlot`/swim/bike/brick to the union (guarded), (ii) read taper weeks + run floor + duration cap from config, (iii) normalize the count-table shape. All preserve HYROX output.
- **Recommended:** fold this v2 into `15-...` as the definitive interface, then implement P0 against it. The Stage 1 specs (16–18) already target these shapes, so they need no revision.
