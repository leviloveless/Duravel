# Duravel — General Fitness Sport & `general_fitness` ProgramType

**Implementation-ready engineering spec** · Author: Claude, for Levi · Date: 2026-07-16
**Conforms to:** `duravel-P0-abstraction-design.md` (the locked `SportConfig` / `ProgramType` contract).
**Sources of truth:** `research-genfit.md` (training science), `duravel-multisport-spec.md` §3.9 + §4, and the current engine (`lib/engine/*`, `lib/ai/philosophy.ts`, `lib/schemas.ts`, `lib/session-volume.ts`, `lib/zones.ts`).

> **Scope.** This spec defines Family C ("general fitness") as one new `SportConfig` (`SPORTS.general_fitness`) plus one new `ProgramType` behavior (`general_fitness`). It reuses the microcycle progression, strength scheme tables, HR-zone model, sequencing guards, and volume reconciler wholesale, and adds a rotation macro-arc in place of Base/Build/Peak/Taper. Every place the P0 interface must grow to host this is flagged in §5 as a **[P0-EXT]** proposed extension. No engine code is written here.

---

## 0. Terminology & how it plugs into the existing engine

Two distinct "program type" concepts exist and must not be conflated:

- **`schemas.ProgramType`** = `goal_event | fixed_duration | general_fitness` — the user-facing *program intent*. Already exists; `general_fitness` is already a value and already routes `allocateMesocycles` to `taper = 0` (`mesocycles.ts:62`). Keep it.
- **`ProgramTypeId`** (P0) = `race_peaking | general_fitness` — the *behavior implementation* selected by `SportConfig.programType`. New layer. `SPORTS.general_fitness.programType = "general_fitness"`.

The engine's spine today (`buildSkeleton` in `skeleton.ts`) runs: `allocateMesocycles → expandPhases → sequenceMicrocycles → applyTapers → assignDays`. The `general_fitness` behavior replaces the first two steps with a **rotation allocation** and keeps `sequenceMicrocycles` (the rising-baseline engine) and `assignDays` (with an extended slot set + sequencing guards). `applyTapers` is skipped (`buildsToRace = false`).

**Key reuse decision — emphasis maps onto `PhaseName` for downstream reuse.** `strength.ts`, `volume.ts` (`PHASE_ZONE_TARGETS`), and `skeleton.ts` all key off `PhaseName` (`base|build|peak|taper`). Rather than fork them, each rotation emphasis maps to a **synthetic phase** so those modules work unchanged, while a new `emphasis` field carries the real label for UI/AI/volume-biasing:

| Emphasis block | Synthetic `phase` (drives strength schemes + zone defaults) | Real `emphasis` (drives volume bias + copy) |
|---|---|---|
| `strength` | `build` (increase wk) / `peak` (heavy) → heavier low-rep | `strength` |
| `aerobic` | `base` → maintenance strength + easy-dominant zones | `aerobic` |
| `mixed` | `build` + power element retained | `mixed` |

`taper` phase is never emitted by `general_fitness`.

---

## 1. The `general_fitness` ProgramType (behavior)

```ts
// lib/engine/program-types/general-fitness.ts
export const generalFitness: ProgramType = {
  id: "general_fitness",
  buildsToRace: false,
  retestEveryWeeks: 10,           // clamp 8..12 at read time (§1.3)
  allocateMacrocycle,             // → RotationPlan  (§1.1)
  weeklyVolume,                   // → VolumeTargets (miles + cardioMinutes + strengthVolume) (§1.2)
};
```

### 1.1 `allocateMacrocycle` → `RotationPlan`

Instead of Base/Build/Peak/Taper, general fitness emits a **repeating loop of emphasis blocks** — `strength → aerobic → mixed → (repeat)` — each block 3–5 weeks, each starting from the *rising baseline* the continuous microcycle sequencer produces, with a deload as the last week of every block ("connective tissue between blocks"). No peak, no taper.

#### Types  **[P0-EXT: `RotationPlan`, `EmphasisBlock`, `EmphasisId`]**

```ts
export type EmphasisId = "strength" | "aerobic" | "mixed";

export interface EmphasisBlock {
  emphasis: EmphasisId;
  weeks: number;                 // 3..5
  micro: MicroWeekType[];        // length === weeks; ends in "deload"
  /** synthetic PhaseName per week, for strength.ts / zones reuse */
  phasePerWeek: PhaseName[];
  /** true when this block's terminal deload is a benchmark re-test boundary */
  retestAtEnd: boolean;
}

export interface RotationPlan {
  kind: "rotation";              // discriminates from MesocycleAllocation
  blocks: EmphasisBlock[];       // already expanded to sum to durationWeeks
  cycleLength: number;           // weeks in one full strength→aerobic→mixed loop
  totalWeeks: number;            // === input.durationWeeks
}
```

`ProgramType.allocateMacrocycle` already declares the return type `MesocycleAllocation | RotationPlan` in P0 §2.2 — but `RotationPlan` is only *named*, never defined. Defining it is the primary type extension (§5).

#### Block-length rule (tiered by adaptation rate — `research-genfit.md` §4)

The de-emphasized quality is *maintained*, the emphasized one *accumulates*; deload cadence tracks recovery capacity:

```ts
function blockLength(input: EngineInput): number {
  // Combined cardio+lift experience → adaptation rate → accumulation runway.
  const bothBeginner = input.runningExp === "beginner" && input.liftingExp === "beginner";
  if (input.age && input.age >= MASTERS_AGE) return 3;   // masters: deload every 3 wk (reuse MASTERS_AGE=50)
  if (bothBeginner) return 5;                            // beginner: rare deload, linear accumulation
  return 4;                                              // intermediate/advanced: deload every 4 wk (4–8 wk band)
}
```

Rationale: research says beginner = rare deload + linear progression, intermediate/advanced = deload 4–6/4–8 wk, masters = more frequent deloads (mirrors `microcyclePattern`'s masters override). All land inside the 3–5 wk emphasis-block guidance and the 4–8 wk deload band.

#### Per-block micro-pattern

Reuse the existing rebound/increase/deload semantics; the block is `[rebound, increase×(n−2), deload]`:

```
3-week block: [rebound, increase, deload]
4-week block: [rebound, increase, increase, deload]
5-week block: [rebound, increase, increase, increase, deload]
```

`phasePerWeek` for the block is filled by mapping (emphasis, microWeek) → synthetic phase:

```ts
function synthPhase(emphasis: EmphasisId, micro: MicroWeekType): PhaseName {
  if (micro === "deload") return "base";                 // deload → light, base-like
  if (emphasis === "aerobic") return "base";             // maintenance strength, easy-dominant
  if (emphasis === "strength") return micro === "increase" ? "peak" : "build"; // heaviest on increase
  return "build";                                        // mixed → moderate + power element
}
```

#### Building the plan (fills 4–24 wk, repeats indefinitely, boundary handling)

```ts
const ROTATION_ORDER: EmphasisId[] = ["strength", "aerobic", "mixed"];

function allocateMacrocycle(input: EngineInput, cfg: SportConfig): RotationPlan {
  const D = input.durationWeeks;              // 4..24 (clamped upstream)
  const L = blockLength(input);
  const retestEvery = clampInt(cfg... /* §1.3 */, 8, 12);

  const blocks: EmphasisBlock[] = [];
  let placed = 0, orderIdx = 0, weeksSinceRetest = 0;

  while (placed < D) {
    const emphasis = ROTATION_ORDER[orderIdx % ROTATION_ORDER.length];
    const remaining = D - placed;
    const weeks = Math.min(L, remaining);     // final block truncates to fit exactly
    const micro = microForBlock(weeks);       // [rebound, increase.., deload], truncated if weeks<3
    weeksSinceRetest += weeks;
    // Flag a re-test on this block's terminal DELOAD when the cadence is due AND
    // the block actually ends in a deload (weeks >= 2). Never on a 1-week stub.
    const endsInDeload = micro[micro.length - 1] === "deload";
    const retestAtEnd = endsInDeload && weeksSinceRetest >= retestEvery && (placed + weeks) <= D;
    if (retestAtEnd) weeksSinceRetest = 0;

    blocks.push({ emphasis, weeks, micro, phasePerWeek: micro.map(m => synthPhase(emphasis, m)), retestAtEnd });
    placed += weeks; orderIdx += 1;
  }
  return { kind: "rotation", blocks, cycleLength: L * 3, totalWeeks: D };
}
```

**Boundary behavior at the program length (`D` weeks):**
- Blocks are laid down in `strength → aerobic → mixed` order and *repeat* until `placed === D`. The macro-arc is genuinely open-ended; `D` is just where we stop rendering.
- The **final block is truncated** to `remaining` weeks. If `remaining ∈ {1,2}` the stub uses `[rebound]` or `[rebound, deload]` — no orphan increase week, no retest on a stub.
- Short programs: `D=4` → `[strength:4 (reb,inc,inc,del)]` (one block, one deload, no retest — 4 < 8). `D=6` (beginner L=5) → `[strength:5, +1 stub]`.
- Very long programs (`D=24`, L=4) → 6 blocks = two full `strength/aerobic/mixed` cycles; deloads at wk 4/8/12/16/20/24; retests (every 10) at the wk-12 and (optionally wk-20/24) deload boundaries (§1.3).

**Rising baseline is *not* a plan-level concern.** It comes for free: `sequenceMicrocycles` is run **once, continuously, across all `D` weeks** (there is no taper region to carve out), so `heldMileage`/`heldCardio` climb monotonically across block boundaries and deloads only dip the *rendered* week, never the held level (`microcycles.ts:85–92`). Each new block therefore starts from a higher baseline automatically. The emphasis blocks bias *how the week's budget is split*, not the underlying progression.

#### `buildSkeleton` branch  **[P0-EXT: emphasis-aware skeleton]**

`buildSkeleton` gains one branch keyed on `cfg.programType`:

```
if programType === "general_fitness":
  plan   = allocateMacrocycle(input, cfg)               // RotationPlan
  perWk  = expandRotation(plan)                          // [{emphasis, micro, phase}] length D
  seq    = sequenceMicrocycles(D, trainingClass, startMi, startCa, age)   // full D weeks, no taper carve-out
  for each week i:
     vol   = weeklyVolume({emphasis, micro, held: seq.held[i], subGoal, ...}, cfg)   // §1.2
     zones = GENFIT_EMPHASIS_ZONE_TARGETS[emphasis] (deload → softened)   // §2 phaseZoneTargets
     days  = assignDaysGenFit(trainingDays, emphasis, micro, cardioExp, liftExp, subGoal, prefs)   // §2 + §4
     weeks.push({ weekNumber, phase: perWk[i].phase, emphasis: perWk[i].emphasis, microWeek: micro,
                  targetMileage: vol.miles, targetCardioMinutes: vol.cardioMinutes,
                  strengthVolume: vol.strengthVolume, zoneTargets: zones, days, retest: perWk[i].retestAtEnd })
  // no applyTapers, no applyPostBRaceRecovery
```

### 1.2 `weeklyVolume` → `VolumeTargets` (miles + cardioMinutes + strength volume, biased by emphasis)

**[P0-EXT: `VolumeTargets.strengthVolume`]** — today `VolumeTargets` for Family A/C is `{ miles, cardioMinutes }`. General fitness adds a strength-volume signal so the strength side is auditable the way running mileage is.

```ts
export interface VolumeTargets {
  miles: number;
  cardioMinutes: number;
  strengthVolume?: { liftSessions: number; hardSetsPerWeek: number };  // NEW
}
```

The week's *aerobic budget* is the continuously-progressed `held` value from `sequenceMicrocycles`, scaled by an **emphasis factor** (min-effective dose for the non-emphasized quality) × the microcycle factor (deload = `DELOAD_FACTOR` 0.6, reusing `volume.ts`) × the sub-goal multiplier (§3), then **clamped to hard floors** (§3):

```ts
const EMPHASIS_AEROBIC_FACTOR: Record<EmphasisId, number> = {
  strength: 0.60,   // cardio at min-effective dose while lifting accumulates
  aerobic:  1.00,   // full aerobic budget
  mixed:    0.85,
};
const EMPHASIS_STRENGTH_FACTOR: Record<EmphasisId, number> = {
  strength: 1.00,   // full lifting dose
  aerobic:  0.60,   // maintenance (2 full-body/wk floor still holds)
  mixed:    0.85,
};

function weeklyVolume(w, cfg): VolumeTargets {
  const microFactor = w.micro === "deload" ? DELOAD_FACTOR : 1;         // reuse volume.ts
  const aeroF = EMPHASIS_AEROBIC_FACTOR[w.emphasis] * w.subGoal.aerobicVolumeMult;
  const cardioMinutes = Math.max(
     FLOORS.minAerobicMinutes,                                          // never below health floor (§3)
     Math.round(w.held.cardio * aeroF * microFactor));
  const miles = Math.max(
     FLOORS.minMiles,
     round1(w.held.mileage * aeroF * microFactor));
  const liftSessions = clampInt(baseLiftSessions(w.days, w.emphasis, w.subGoal),
                                FLOORS.minLiftDays, maxLiftDays(w.days));   // §2, §3
  const hardSetsPerWeek = Math.round(liftSessions * SETS_PER_SESSION * EMPHASIS_STRENGTH_FACTOR[w.emphasis]);
  return { miles, cardioMinutes, strengthVolume: { liftSessions, hardSetsPerWeek } };
}
```

The **volume reconciler (`reconcile.ts`) is reused unchanged**: it already sizes running to `targetMileage` at fixed paces and pads the remainder to `targetCardioMinutes` with non-running Z1–Z2 `cardio` sessions (`session-volume.ts`, `CardioSessionSchema`). General fitness just feeds it emphasis-biased targets. The strength side is realized by `assignDays` (session counts) × `movementScheme` (sets/reps), so `hardSetsPerWeek` is a derived/audit figure, not a new reconciliation loop.

### 1.3 `retestEveryWeeks` (8–12) — the benchmark re-test that replaces the race

`generalFitness.retestEveryWeeks = 10` (default), read through `clampInt(cfg.retest ?? 10, 8, 12)` so a `SportConfig`/sub-goal override stays in-band. A re-test is scheduled on the **terminal deload of whichever block first makes `weeksSinceRetest ≥ retestEveryWeeks`** (§1.1). Programs shorter than 8 weeks schedule **no** re-test (single accumulation block only).

**What is tested** (`research-genfit.md` §6 — "THE RE-TEST IS THE RACE"):

| Quality | Test (pick best available) | Derived metric |
|---|---|---|
| VO2max / aerobic | 12-min Cooper **or** 1.5-mi TT **or** 5k TT **or** submax-HR step test | VO2max estimate (ml/kg/min), pace trend |
| Max strength | AMRAP @ a fixed load on the main patterns (squat, hip_hinge, a press) | est. 1RM via Epley (`EPLEY_5RM_TO_1RM` in `math.ts`) |
| (optional) body comp / capacity | weight/waist or an AMRAP finisher | trend only |

Emitted on the deload week as a `retest: true` flag on `WeekSkeleton` **[P0-EXT]**; the AI/UI renders it as a testing session in place of one hard session that week (a deload week has spare capacity).

**How results feed the next block (autoregulation)** — the general-fitness analogue of `needs.ts`:

```ts
export interface RetestResult { vo2: number|null; est1rm: Record<"squat"|"hinge"|"press", number|null>; takenAtWeek: number; }
export interface RotationBias { weightEmphasis: EmphasisId | "none"; extendWeeks: 0|1; note: string; }

// Compare newest retest to the previous one (or to program-start benchmarks on the first retest).
function autoregulateRotation(curr: RetestResult, prev?: RetestResult): RotationBias {
  const vo2Stalled = pctChange(curr.vo2, prev?.vo2) <= STALL_EPS;          // ~ <1.5% gain
  const strStalled = meanPctChange(curr.est1rm, prev?.est1rm) <= STALL_EPS;
  if (vo2Stalled && !strStalled) return { weightEmphasis: "aerobic",  extendWeeks: 1, note: "VO2 stalled → bias aerobic" };
  if (strStalled && !vo2Stalled) return { weightEmphasis: "strength", extendWeeks: 1, note: "Strength stalled → bias strength" };
  return { weightEmphasis: "none", extendWeeks: 0, note: "Both progressing → hold balanced rotation" };
}
```

The bias is applied to the **next** cycle: `weightEmphasis` lengthens that emphasis's block by `extendWeeks` (bounded, base-largest-style guard so no other block starves) and raises its volume factor by one step. Within a single generated program this fires 0–2× (most programs are 4–24 wk); at program end the final retest is persisted and seeds the **regenerated** next program's starting volume + emphasis — closing the loop the way a race result would.

---

## 2. `SportConfig` for `general_fitness`

```ts
// lib/engine/sports/general-fitness.ts
export const generalFitness: SportConfig = {
  id: "general_fitness",
  family: "general_fitness",
  displayName: "General Fitness",
  programType: "general_fitness",

  // No hybrid, no race format, no stations.
  modalities: ["run", "lift", "cardio", "rest"],   // "cardio" = non-running Z1–Z5 aerobic block
  // stations / raceStationOrder / interStationRunMeters / pacing: omitted (pure cardio+strength)

  sessionCounts: GENFIT_SESSION_COUNTS,            // §2.1 — by days/wk, per emphasis
  phaseZoneTargets: GENFIT_EMPHASIS_ZONE_TARGETS,  // §2.3 — keyed by synthetic phase; base state 20/60/10/5/5
  experienceAxes: [cardioAxis, liftingAxis],       // §2.2 — INDEPENDENT
  needsDomains: [cardioDomain, strengthDomain],    // §2.4
  volume: GENFIT_VOLUME,                            // §2.5 — 200–300 min aerobic 80/20, strength 2–3 d
  philosophy: GENFIT_PHILOSOPHY,                    // §2.6
  subGoals: GENFIT_SUBGOALS,                        // §3
};
```

### 2.1 `sessionCounts` — session plan by days/week × emphasis

Derived from `research-genfit.md` §7 example weeks. Counts are for a **normal (rebound/increase) week**; deload weeks trim one hard cardio session (keep 1 VO2 + easy volume) and drop lifts to the 2-day floor, mirroring `slots.ts` deload logic. `cardio` splits into `easyCardio` (Z1–Z2) and `hardCardio` (≥1 always a VO2 4×4; a 2nd hard slot becomes threshold at higher day counts).

**Baseline (balanced sub-goal, `mixed` emphasis):**

| Days/wk | lift | hardCardio (incl. ≥1 VO2) | easyCardio | Notes |
|---|---|---|---|---|
| 3 | 2 (full) | 1 (VO2) | 2 short Z2 attached to lift days | research 3-day: 2×FB S + 1 VO2 + Z2 tails |
| 4 | 2 (upper/lower) | 1 (VO2 or Thr) | 1 (Z2 40–50) | 2 strength + 2 cardio-led |
| 5 | 3 (FB/FB split) | 1 (VO2) | 1 (Z2 45–60) | 3 strength-touch, ~250–300 min |
| 6 | 3 (lower/upper/FB-power) | 2 (VO2 + Thr) | 1 long Z2 60–90 | +1 rest day; heavy legs off interval days |

**Emphasis shifts** (applied to the baseline, then clamped to floors §3):

```ts
// per emphasis: {liftDelta, hardCardioDelta, easyCardioDelta}
strength: { lift:+1, hardCardio: 0, easyCardio:-1 }  // more lifting, cardio at min dose (keep the VO2)
aerobic:  { lift:-1, hardCardio: 0, easyCardio:+1 }  // more easy aerobic volume, strength → 2-day floor
mixed:    { lift: 0, hardCardio: 0, easyCardio: 0 }  // balanced
```

Clamps: `lift ∈ [max(2, floor), maxLiftDays(days)]`, `hardCardio ≥ 1` (the VO2 invariant), total sessions ≤ `days` + doubling allowance (a lift + short easy cardio may share a day, as in the 3/5/6-day research weeks).

### 2.2 `experienceAxes` — cardio & lifting, INDEPENDENT (by training age)

```ts
const cardioAxis: ExperienceAxis = {
  key: "cardio", label: "Cardio / aerobic training age", needsWeight: 1,
  bands: [
    { level: "beginner",     criterion: "Cannot run 30 min continuously; run/walk; <~1 yr consistent cardio" },
    { level: "intermediate", criterion: "5–10k comfortable / 30+ min continuous; 1–2 quality sessions/wk" },
    { level: "advanced",     criterion: "Established aerobic base; polarized 80/20; sustains 2–3 quality/wk" },
  ],
};
const liftingAxis: ExperienceAxis = {
  key: "lifting", label: "Lifting training age", needsWeight: 1,
  bands: [
    { level: "beginner",     criterion: "<~1 yr consistent progressive loading; PRs session-to-session" },
    { level: "intermediate", criterion: "1–3 yr; PRs week-to-month; ~Squat 1.0–1.5×BW, DL 1.25–1.75×BW" },
    { level: "advanced",     criterion: ">3 yr; PRs month-to-month; established relative-strength standards" },
  ],
};
```

The two axes map onto the existing `EngineInput.runningExp` (= cardio) and `liftingExp` fields. `hybridExp` is **unused** by general fitness (no hybrid modality) and is ignored — set it to `runningExp` at input-adaptation time so nothing downstream breaks. **Independence is the point:** an athlete can be `advanced` cardio / `beginner` lifting; the two axes independently set (a) block length (§1.1 uses both), (b) autoregulation vs fixed progression, (c) intensity ceiling per modality.

**Tier → programming rules** (`research-genfit.md` §4):

| Tier | Cardio | Lifting |
|---|---|---|
| beginner | mostly Z1–Z2, capped intensity, ~10%/wk, run/walk allowed; VO2 kept but short | fixed prescriptions, linear load, higher RIR, rare deload |
| intermediate | 1 VO2 + optional 1 threshold, RPE-guided | weekly undulation, RIR autoregulation, deload 4–8 wk |
| advanced | polarized 80/20, 2–3 quality | full autoregulation, deload 4–6 wk |

### 2.3 `phaseZoneTargets` — reuse 20/60/10/5/5 base state, ≥1 weekly VO2

The overall program target stays the spec's **20/60/10/5/5** (already `TARGET_ZONE_DISTRIBUTION` in `zones.ts`). Per-emphasis distributions are keyed by the **synthetic phase** (so `skeleton.ts`'s `zoneTargets: PHASE_ZONE_TARGETS[phase]` reads them unchanged):

```ts
const GENFIT_EMPHASIS_ZONE_TARGETS: Record<PhaseName, ZoneDistribution> = {
  base:  { z1: 25, z2: 60, z3: 8,  z4: 4, z5: 3 },   // aerobic emphasis / deload — base-heavy 80/20
  build: { z1: 20, z2: 58, z3: 10, z4: 7, z5: 5 },   // mixed / strength-normal
  peak:  { z1: 18, z2: 55, z3: 12, z4: 8, z5: 7 },   // strength-increase (small, sharp cardio)
  taper: { z1: 20, z2: 60, z3: 10, z4: 5, z5: 5 },   // never emitted; = base-state fallback
};
```

The **≥1 weekly VO2max session is a session-count invariant, not a %**: `assignDaysGenFit` always emits at least one `cardio` slot of `cardioType: "vo2"` on any week with `hardCardio ≥ 1` (i.e. every non-deload week, and deload weeks keep a shortened VO2). Zone-% is time-weighted and would otherwise dilute a single 4×4 into noise; the invariant guarantees the ceiling-raising stimulus regardless of block.

### 2.4 `needsDomains` — cardio + strength

```ts
const cardioDomain: NeedsDomainConfig   = { key: "cardio",   label: "aerobic capacity",  weight: 1, anchors: RUN_ANCHORS };
const strengthDomain: NeedsDomainConfig = { key: "strength", label: "maximal strength", weight: 1, anchors: STR_ANCHORS };
```

Reuse `needs.ts` scoring (`scoreRunEngine`, `scoreStrength`) with a **two-domain** set (drop `erg_engine` — no ergs/hybrid here). The relative-gap limiter logic is sport-neutral and reused as-is. For general fitness the limiter output additionally seeds the **initial rotation weighting** (a weak cardio score → start the first cycle on `aerobic`; weak strength → start on `strength`) — the cold-start analogue of the retest autoregulation.

### 2.5 `volume` (VolumeConfig) — default health/longevity doses

```ts
const GENFIT_VOLUME: VolumeConfig = {
  // Aerobic: upper guideline band, base-heavy 80/20 (research §3).
  startCardioMinutesByCardioExp: { beginner: 150, intermediate: 220, advanced: 280 },  // target upper half 250–300 for fit
  aerobicIntensitySplit: { easyPct: 80, hardPct: 20 },     // 80/20 polarized
  weeklyVo2Sessions: 1,                                     // ≥1 genuine VO2max/wk (Norwegian 4×4)
  // Running mileage seed (some cardio is non-running; reconciler pads the rest as `cardio`):
  startMileageByCardioExp: { beginner: 6, intermediate: 15, advanced: 25 },
  avgMinPerMile: AVG_MIN_PER_MILE,                          // reuse volume.ts = 18
  // Strength: 2–3 full-body-equiv days, all 7 patterns, ~10 hard sets/muscle/wk.
  strengthDaysByLiftExp: { beginner: 2, intermediate: 3, advanced: 3 },
  setsPerSession: 12,                                       // ≈10 hard sets/muscle/wk across the week
  requiredPatterns: REQUIRED_MOVEMENT_PATTERNS,             // reuse schemas: all 7, ≥2×/wk
};
```

`startMileage`/`startCardioMinutes` on `EngineInput` still override these (unchanged). Note the cardio seed is intentionally *lower for beginners* (150 min = WHO floor) and climbs via the microcycle increase steps toward the 250–300 band over the first cycle.

### 2.6 `philosophy` (PhilosophyConfig)

```ts
const GENFIT_PHILOSOPHY: PhilosophyConfig = {
  coach: "expert strength-and-conditioning / general-fitness coach",
  guidance: [
    GENFIT_ROTATION_GUIDANCE,   // "This program has no race. It rotates 3–5 wk emphasis blocks…"
    GENFIT_EMPHASIS_GUIDANCE,   // per-block character (strength/aerobic/mixed) — see below
    GENFIT_VO2_GUIDANCE,        // the weekly VO2max session = Norwegian 4×4 (4×4 min @90–95% HRmax, 3 min @60–70%)
    GENFIT_RETEST_GUIDANCE,     // "Every ~10 wk a deload week includes a re-test = your race…"
    // Reuse verbatim from lib/ai/philosophy.ts: ZONE_DEFINITIONS, RUN_GUIDANCE, LIFT_GUIDANCE.
    // DO NOT include HYBRID_GUIDANCE / TAPER_GUIDANCE (no hybrids, no taper).
  ].join("\n\n"),
  // Emphasis-biased cardio-modality library (anti-staleness rotation, research §6):
  library: {
    strength: ["easy run", "easy bike", "row Z2", "VO2 4×4 (bike/row to spare legs)"],
    aerobic:  ["easy run", "long run", "threshold run", "VO2 4×4 run", "easy bike"],
    mixed:    ["easy run", "VO2 4×4", "threshold", "row/bike intervals"],
  },
};
```

The coach string + guidance blocks flow through `prompts.ts`/`philosophy.ts` exactly like HYROX's — general fitness swaps `HYBRID_GUIDANCE` out and rotation/retest guidance in. `LIFT_GUIDANCE`'s "all 7 patterns across the week" and `RUN_GUIDANCE`'s run-type character are reused unchanged.

---

## 3. Sub-goal bias vectors

One **optional** sub-goal, defaulting to `balanced`. Applied as a *volume-allocation bias vector with hard floors* — same engine, different ratios (never a different model). Lives in `SportConfig.subGoals` (already declared in P0 §2.1 as `SubGoalConfig[]`).

#### `SubGoalConfig`  **[P0-EXT: define the shape]**

```ts
export interface SubGoalConfig {
  id: "recomp" | "general_strength" | "general_endurance" | "balanced";
  label: string;
  // Session-count deltas (applied on top of the emphasis shift in §2.1, then floored):
  liftDaysDelta: number;
  cardioDaysDelta: number;
  // Volume-split multipliers (applied inside weeklyVolume §1.2):
  aerobicVolumeMult: number;    // scales cardioMinutes/miles target
  strengthVolumeMult: number;   // scales hardSetsPerWeek
  // Rotation skew: which emphasis block is lengthened/weighted (bounded ±1 wk):
  rotationBias: EmphasisId | "none";
  coachNote: string;            // e.g. protein 1.6–2.2 g/kg + modest deficit for recomp
}

// The floors are sport-level (never crossed by any emphasis × sub-goal combination):
const FLOORS = {
  minAerobicMinutes: 150,   // WHO health floor (moderate-equiv)
  minMiles: 0,              // cardio may be all non-running
  minLiftDays: 2,           // ≥2 strength days, all 7 patterns
  minVo2Sessions: 1,        // ≥1 VO2max/wk
};
```

#### The four vectors

| Sub-goal | liftΔ | cardioΔ | aerobicMult | strengthMult | rotationBias | Net effect |
|---|---|---|---|---|---|---|
| **balanced** (default) | 0 | 0 | 1.00 | 1.00 | none | Even rotation, §2 defaults, no skew. |
| **recomp / fat-loss** | +1 | 0 | 1.00 | 1.15 | strength | Strength volume HIGH (muscle = the lever) + full cardio for expenditure; 3–4 lift d/wk; coachNote flags protein 1.6–2.2 g/kg + modest deficit. |
| **general_strength** | +1 | −1 | 0.75 (floored ≥150 min) | 1.20 | strength | Lifting emphasis + volume; cardio at min-effective dose (Z2 1–2×/wk + the VO2 floor). 3–4 lift d/wk. |
| **general_endurance / GPP** | −1 (floored ≥2) | +1 | 1.20 | 0.70 (floored ≥2 lift d, all patterns) | aerobic | Aerobic volume + 80/20; strength → maintenance (2 full-body/wk, which even aids economy). 4–5 cardio d/wk. |

**Exact effect on session counts** (worked example, 5 training days, `mixed` block, `general_strength`):
- Baseline (§2.1, 5-day mixed): lift 3, hardCardio 1, easyCardio 1.
- Emphasis shift (mixed = 0): unchanged.
- Sub-goal `general_strength`: liftΔ +1 → 4, cardioΔ −1 applied to easyCardio → 0; hardCardio held at floor 1 (VO2). Result: **lift 4, hardCardio 1 (VO2), easyCardio 0** → 4 lift + 1 cardio (with an easy spin appended to one lift day to satisfy the ≥150-min aerobic floor).
- Volume: `aerobicVolumeMult 0.75` on the held cardio, then `max(., 150)`; `strengthMult 1.20` on hardSets.

**Exact effect on volume split** is entirely via the two multipliers inside `weeklyVolume` (§1.2), so the split is deterministic and unit-testable (§7). Floors are applied *after* all multipliers, so no combination can drop below health-protective cardio or below 2 strength days / 7 patterns.

Sub-goal is a new optional input **[P0-EXT: `GenerationInput.subGoal`]**, `z.enum([...]).default("balanced")`.

---

## 4. Concurrent-training scheduling rules (extend `sequencing.ts`)

Interference is handled as **scheduling + intensity-pairing rules, never dose cuts** (`research-genfit.md` §2 — only explosive power is meaningfully blunted). Four rules, mapped onto the existing `sequencing.ts` machinery:

**R1 — Prioritized quality first within a shared day.** Extend `slotPriority`/`orderByPriority` (`slots.ts:257`) to be emphasis-aware: in a `strength` block the lift leads the day; in an `aerobic` block the hard cardio leads; `mixed` → the harder session leads. Concretely, pass the block emphasis into ordering and bump the emphasized kind's priority above the other. *(Reason: the prioritized quality is trained fresh — research §2 "prioritized quality first in a same-day session.")*

**R2 — ≥3 h / ideally a day between a hard lift and a hard interval.** Generalize the existing guard. Today `isKeyRun` (`sequencing.ts:15`) protects key runs; add:
```ts
const HARD_CARDIO = new Set<CardioType>(["vo2","threshold"]);
const isHardConditioning: SlotPredicate = (s) =>
  isKeyRun(s) || (s.kind === "cardio" && HARD_CARDIO.has(s.cardioType));
```
Replace `isKeyRun` with `isHardConditioning` in `applySequencingGuards` so **heavy-leg lifts (`isHardLegLift`: lower/full) are kept off the day *before* a hard interval/VO2 session**, exactly as they're kept off the day before a key run today. No new relocation code — the existing `pickSequencingTarget` swap logic applies verbatim.

**R3 — Easy cardio pairs with hard lifting (same-day intensity clamp).** New normalizer run inside `assignDaysGenFit` after distribution, before ordering: for any day holding **both** a hard-leg lift and a cardio session, **downgrade that cardio to `cardioType: "z2"` (easy)**. If the cardio was the week's only VO2 slot, instead **move the VO2 off that day** (reuse `placeSessionOn` to relocate it to a lift-free or upper-only day) rather than downgrade, preserving the VO2 invariant. *(Research §2 rule 3: same-session cardio after lifting = Z1–Z2 only.)*

**R4 — Intervals off heavy-leg days; prefer non-impact cardio modality on heavy-lower days.** Two parts:
  - (a) A VO2/threshold `cardio` slot and a heavy-leg lift **never share a day** (guaranteed by R3's move-off branch + a placement guard: `hardConditioning` slots are placed onto days without a lower/full lift first).
  - (b) On a day with a heavy *lower* lift that must carry cardio, the reconciler-added easy `cardio` block prefers a `modality` of `"bike"`/`"row"` (spares the legs) — set via `CardioSessionSchema.modality`. Copy-only hint to the AI/reconciler; no math change.

**Ordering of the passes in `assignDaysGenFit`:** distribute round-robin (reuse `assignDays` interleave) → R3/R4a same-day clamp/move → R1 emphasis-aware ordering → R2 `applySequencingGuards(isHardConditioning)`. All four are best-effort + count-preserving, exactly like the current guard (never drops a session; only relocates onto unprotected days).

**New slot type required [P0-EXT]:** the engine `SessionSlot` union has no `cardio` member today (only the *output* `Session` schema does, via `CardioSessionSchema`). Add:
```ts
export interface CardioSlot { kind: "cardio"; goalZone: number; cardioType: "z2"|"long"|"threshold"|"vo2"; modality?: string; }
export type SessionSlot = RunSlot | LiftSlot | HybridSlot | CardioSlot | RestSlot | RaceSlot;
```
`Modality` in P0 already includes `"cardio"`, and `CardioSessionSchema` already exists downstream — this only lifts it into the slot layer so the engine can place hard/easy cardio explicitly (needed for the VO2 invariant + interference rules). HYROX never emits it, so every existing `switch(kind)` is unaffected (add a `case "cardio"` only where general fitness is handled).

---

## 5. Interface adequacy check — proposed P0 extensions

The P0 contract hosts general fitness with the following **additive** extensions (none change HYROX or race_peaking behavior):

| # | Extension | Where | Why |
|---|---|---|---|
| E1 | **Define `RotationPlan` / `EmphasisBlock` / `EmphasisId`** | `program-types/types.ts` | P0 names `RotationPlan` in the `allocateMacrocycle` return union but never defines it (§1.1). |
| E2 | **`VolumeTargets.strengthVolume?`** | `program-types/types.ts` | Family C needs an auditable strength signal alongside miles+cardioMinutes (§1.2). Optional → race_peaking unaffected. |
| E3 | **`WeekSkeleton.emphasis?: EmphasisId` + `WeekSkeleton.retest?: boolean`** | `engine/types.ts` | Carry the real rotation label + retest flag for AI/UI while `phase` stays the synthetic driver (§0, §1.3). Optional. |
| E4 | **`CardioSlot` in `SessionSlot`** | `engine/types.ts` | Engine must place hard/easy cardio to enforce the VO2 invariant + interference rules (§4). `Modality "cardio"` already declared in P0. |
| E5 | **Define `SubGoalConfig` shape** | `sports/types.ts` | P0 declares `SportConfig.subGoals?: SubGoalConfig[]` but not the type (§3). |
| E6 | **`generalFitness` ProgramType impl + `expandRotation` + `assignDaysGenFit`** | `program-types/general-fitness.ts`, `engine/rotation.ts` | The one genuinely new control-flow (rotation instead of Base/Build/Peak/Taper, §1.1). |
| E7 | **`buildSkeleton` branch on `cfg.programType`** | `engine/skeleton.ts` | Route to rotation allocation + skip `applyTapers`/`applyPostBRaceRecovery` (§1.1). |
| E8 | **`GenerationInput.subGoal` (enum, default `balanced`) + surface `emphasis`/`retest` in `ProgramWeekSchema`** | `schemas.ts` | User input + persisted program shape (§3, §1.3). Additive/optional. |
| E9 | **`RetestResult` / `RotationBias` + `autoregulateRotation`** | `program-types/general-fitness.ts` | The re-test → next-block autoregulation loop that replaces the race (§1.3). |

Everything else — `sequenceMicrocycles`, `movementScheme`, `PHASE_ZONE_TARGETS` (via synthetic phase), `reconcile.ts`, `resolveHrModel`, `needs.ts` scoring, `sequencing.ts` swap logic — is reused **unmodified** or by parameter only. The abstraction is adequate; the residue is exactly the "rotation instead of peak" control-flow P0 anticipated.

---

## 6. Example generated weeks (concrete slot plans)

Training days assumed contiguous; `cardio(z2, N)` = non-running easy block N min; `lift(type)` carries all-7-patterns-across-week + periodized scheme via `movementScheme`. Emphasis shown per week; these are **increase** weeks (non-deload).

### Beginner (cardio beginner / lifting beginner) — mostly Z1–Z2, fixed load, VO2 kept but short

**3 days — `strength` block (Mon/Wed/Fri):**
| Day | Sessions |
|---|---|
| Mon | `lift(full)` + `cardio(z2, 15)` |
| Wed | `cardio(vo2, 4×3 min short)` |
| Fri | `lift(full)` + `cardio(z2, 20)` |
→ 2 strength (all 7 patterns across the two days) + 1 short VO2 + ~35 min easy tails. Aerobic floor 150 min met by longer Z2 tails / cardio block.

**4 days — `aerobic` block (Mon/Tue/Thu/Sat):**
| Day | Sessions |
|---|---|
| Mon | `lift(upper)` + `cardio(z2, 20)` |
| Tue | `cardio(z2, 40)` |
| Thu | `lift(lower)` |
| Sat | `cardio(vo2, 4×4)` + `cardio(z2, 15)` |
→ 2 strength (floor) + 2 cardio-led, ~200 min, base-heavy. R2 keeps the Thu lower lift off the day before Sat VO2 (Fri is rest, so satisfied).

**5 days — `mixed` block (Mon/Tue/Wed/Fri/Sat):**
| Day | Sessions |
|---|---|
| Mon | `lift(full)` + `cardio(z2, 15)` |
| Tue | `cardio(z2, 50)` |
| Wed | `lift(full)` |
| Fri | `cardio(vo2, 4×4)` |
| Sat | `cardio(z2, 45)` |
→ 2–3 strength-touch + polarized cardio, ~250 min. Thu rest separates Wed lift from Fri VO2 (R2/R4a).

**6 days — `aerobic` block (Mon–Sat, Sun rest):**
| Day | Sessions |
|---|---|
| Mon | `lift(lower)` + `cardio(z2/bike, 20)` |
| Tue | `cardio(z2, 55)` |
| Wed | `lift(upper)` + `cardio(z2, 20)` |
| Thu | `cardio(vo2, 4×4)` |
| Fri | `lift(full)` |
| Sat | `cardio(long z2, 70)` |
→ 3 strength + 3 cardio incl. 1 VO2 + 1 long. R4: Mon lower lift's paired cardio is `bike` (spares legs); R2 keeps Wed/Fri lifts off the day before Thu VO2 (Wed is upper = allowed; guard relocates if a lower/full landed there).

### Advanced (cardio advanced / lifting advanced) — polarized 80/20, full autoregulation, power element

Same day skeletons, **higher volume + a second quality + RIR autoregulation + power element in a lift** (`powerElementFor` fires in synthetic `base`/`build` = aerobic/mixed/strength-non-increase weeks):

**5 days — `strength` block (Mon/Tue/Wed/Fri/Sat):**
| Day | Sessions |
|---|---|
| Mon | `lift(full, heavy 3s @88%/1RIR)` + `cardio(z2, 20)` |
| Tue | `cardio(z2, 60)` |
| Wed | `lift(upper, moderate)` |
| Fri | `lift(lower)` + `cardio(z2/bike, 20)` |
| Sat | `cardio(vo2, 4×4)` |
→ strength-emphasis: 3 lift + cardio at min-effective dose (Z2 + the VO2 floor), ~180–200 min. R2/R4a: Fri lower lift → Sat VO2 collision avoided by making Fri's cardio easy-bike and (guard) keeping heavy legs off Fri if Sat VO2 can't move; Thu rest also buffers.

**6 days — `mixed` block (Mon–Sat, Sun rest):**
| Day | Sessions |
|---|---|
| Mon | `lift(lower, heavy)` + `cardio(z2/bike, 25)` |
| Tue | `cardio(z2, 60)` |
| Wed | `lift(upper)` + `cardio(z2, 25)` |
| Thu | `cardio(vo2, 4×4)` |
| Fri | `lift(full, power element)` |
| Sat | `cardio(long z2, 90)` + optional `cardio(threshold, 20)` |
→ 3 strength + 3–4 cardio, ~280–300 min, ~80% Z1–Z2, heavy legs (Mon/Fri) separated from Thu intervals (R2/R4). Power/explosive work isolated to `mixed`-block `lift(full, power)` with full recovery (the one at-risk quality gets its own protected slot — research §2).

---

## 7. Tests (vitest) + open questions

### 7.1 Test plan

**`rotation.allocate.spec.ts` — rotation allocation over 4–24 wk**
- For every `D ∈ [4,24]` and every tier (beginner L=5, intermediate/advanced L=4, masters L=3): `sum(blocks.weeks) === D`; blocks follow `strength,aerobic,mixed,strength,…`; **no block emphasis produces a `taper` synthetic phase**; every full block ends in `deload`; the final block is a clean truncation (weeks ≤ L; a 1–2 wk stub has no `increase`, no `retestAtEnd`).
- Rising baseline: run `sequenceMicrocycles(D,…)` and assert `heldMileage`/`heldCardio` are monotonically non-decreasing across block boundaries (deload dips the rendered week but not the held level).
- `buildsToRace === false`; `applyTapers` never called (spy); no week has `phase === "taper"`.

**`rotation.retest.spec.ts` — retest cadence**
- `retestEveryWeeks` clamps to [8,12]. For `D<8`: zero retests. For `D=24,L=4,every=10`: retests fall on deload weeks with `weeksSinceRetest ≥ 10` (wk 12, then wk 22/24 depending on accumulation) and reset the counter. Stubs never carry a retest.
- `autoregulateRotation`: VO2 stalled + strength up → `weightEmphasis:"aerobic"`; both up → `"none"`; verify `extendWeeks` bounded to 1 and the next-cycle block-length guard keeps rotation order + no starved block.

**`subgoal.bias.spec.ts` — sub-goal bias math**
- For each sub-goal × each emphasis × days∈{3,4,5,6}: assert resulting `{lift, hardCardio, easyCardio}` equals the hand-computed baseline + emphasis shift + sub-goal delta, then floored. Table-driven with the §3 worked example as one fixture.
- `weeklyVolume`: `cardioMinutes === max(150, round(held × emphasisAeroF × subGoalAeroMult × microFactor))` and `hardSetsPerWeek` scales by `strengthMult` — exact arithmetic assertions.

**`floors.spec.ts` — min-dose floors**
- No (emphasis × sub-goal) combination drops `cardioMinutes` below 150, `liftDays` below 2, or removes the VO2 slot. Specifically `general_strength` in a `strength` block (the most cardio-suppressed case) still yields ≥150 min + ≥1 VO2; `general_endurance` in an `aerobic` block still yields ≥2 lift days covering all 7 `REQUIRED_MOVEMENT_PATTERNS`.

**`interference.spec.ts` — concurrent-training scheduling**
- R1: in a `strength` block, on any doubled day the `lift` slot sorts before the cardio; `aerobic` block inverts it.
- R2: no heavy-leg (`lower`/`full`) lift sits the day *before* any `vo2`/`threshold` cardio or key run, across randomized 6-day layouts (reuse the `applySequencingGuards` property test with `isHardConditioning`).
- R3: no day holds both a hard-leg lift and a *hard* cardio; when they'd collide the VO2 is relocated (still present in the week) or the cardio is downgraded to `z2`.
- R4: the week always contains exactly ≥1 `vo2` cardio; on a heavy-lower day the paired easy cardio has `modality ∈ {bike,row}`.

**`skeleton.genfit.spec.ts` — end-to-end**
- A general-fitness `EngineInput` (12 wk, 5 days, cardio adv / lift int, balanced) builds a `ProgramSkeleton` with 12 weeks, no taper phase, one retest at the wk-... deload, valid slot counts each week, and totals within the emphasis-biased targets. Golden-snapshot it (mirrors the P0 byte-identical strategy for HYROX).

### 7.2 Open questions

1. **Beginner deload frequency.** L=5 gives beginners a deload every 5 wk (research: "rare deload"). Is 5 the right runway, or should true novices run 6-wk blocks (deload every 6) with an even gentler ramp?
2. **Retest realism without equipment/lab.** VO2 estimate needs a field test the user will actually do (Cooper/1.5-mi/submax). Do we *require* one retest input at the boundary, gate the autoregulation on it, or fall back to logged-session trend (ACWR/pace drift) when the user skips the test?
3. **Sub-goal × experience conflict.** A `general_strength` sub-goal on a `beginner`-lifting / `advanced`-cardio athlete pushes 4 lift days at a beginner load — is that safe, or should the sub-goal skew be attenuated when the emphasized quality is the athlete's *beginner* axis?
4. **Baseline reset on long programs.** Over 24 wk the continuous microcycle can push volume high. Do we cap the held level (a plateau band by tier) or let it ride, given no race forces a taper?
5. **Power block interference.** Explosive power is the one quality interference reliably blunts. Is isolating it to the `mixed` block's `lift(full, power)` with full recovery sufficient, or should `mixed` blocks additionally suppress hard cardio in the 24 h around the power session?
6. **Emphasis → AI copy fidelity.** The synthetic-phase mapping (§0) means `strength` blocks report `phase: "peak"` internally. Confirm the AI prompt reads `emphasis` (not `phase`) for narrative, so a user never sees "Peak week" in a no-race program.
7. **Persisting the retest loop across programs.** Where does the terminal `RetestResult` live so the *next* generated program seeds from it (a `programs.retest_history` column, or the existing benchmarks path)? This is the closed-loop analogue of a race result.
8. **Onboarding friction.** Two independent experience axes + one optional sub-goal + optional field-test benchmarks — confirm the sub-goal and benchmarks stay *optional* (balanced default, neutral needs) so a user can generate with just the two experience tiers.
```
