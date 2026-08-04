/**
 * Periodization Engine orchestrator (architecture-plan.md section 5, step 2).
 *
 * Deterministic, no AI. Composes the sibling modules into a full
 * ProgramSkeleton: mesocycle allocation, per-week phases, continuous
 * microcycle volume progression, peak-phase volume drop, race tapers,
 * per-day session slots, and weekly zone targets.
 *
 * The output feeds the AI Session Generator (Milestone 5), which fills the
 * concrete sessions the numeric targets here call for.
 */

import type { GenerationInput } from "@/lib/schemas";
import type {
  EngineInput,
  EngineRace,
  MicroWeekType,
  PhaseName,
  ProgramSkeleton,
  SessionSlot,
  WeekSkeleton,
} from "./types";
import { allocateMesocycles, expandPhases } from "./mesocycles";
import { sequenceMicrocycles } from "./microcycles";
import { applyTapers } from "./taper";
import { PEAK_VOLUME_FACTOR, startingCardioMinutes, startingMileage } from "./volume";
import {
  assignDays,
  normalizeLongRunDays,
  slotPriority,
  DEFAULT_COUNTS,
  type SessionCountTables,
} from "./slots";
import { spreadFullLiftTypes } from "./sequencing";
import { trainingCaps } from "./caps";
import { getSport, type SportConfig } from "./sports";
import {
  applyBandZoneShift,
  bandPhaseZoneTargets,
  bandStartMileage,
  bandStartCardioMinutes,
  bandSessionCap,
  bandAnchorRunFloor,
  runImpactFactor,
} from "./time-budget";
import { buildTriathlonSkeleton, swimLevelFromCss, bikeLevelFromFtp } from "./sports/triathlon";
import { analyzeNeedsForSport } from "./needs-atlas";
import { clamp, round1 } from "./math";

/**
 * Build the full deterministic program skeleton from a normalized EngineInput.
 */
export function buildSkeleton(input: EngineInput): ProgramSkeleton {
  const D = input.durationWeeks;
  // Resolve the sport config (P0 rewire). For HYROX these values are the same
  // references as the module constants, so output is byte-identical; a different
  // sport supplies different counts / zone targets / starting volume.
  const cfg = getSport(input.sport);
  const counts: SessionCountTables = {
    run: (cfg.sessionCounts.run as SessionCountTables["run"] | undefined) ?? DEFAULT_COUNTS.run,
    hybrid:
      (cfg.sessionCounts.hybrid as SessionCountTables["hybrid"] | undefined) ??
      DEFAULT_COUNTS.hybrid,
    lift: (cfg.sessionCounts.lift as SessionCountTables["lift"] | undefined) ?? DEFAULT_COUNTS.lift,
    // Station-only sports (totalRaceRunMeters 0) floor runs to 0 and keep them easy.
    runFloor: cfg.runFloor ?? (cfg.totalRaceRunMeters === 0 ? 0 : undefined),
    runCharacter: cfg.totalRaceRunMeters === 0 ? "maintenance" : "full",
    // Research anchors: with an hours budget and a sport that has a research
    // band table, guarantee a threshold + VO2 run every quality week.
    guaranteeQuality: !!input.weeklyHours && !!cfg.bandZone3Z,
  };

  // Research strength dose: at a given budget HYROX wants ~1-3 quality lifts
  // (heavy + power), not a fixed 3-day upper/lower/full split. Override the lift
  // counts and switch to the heavy/power split for a band athlete.
  if (input.weeklyHours && cfg.bandLiftCounts) {
    const [lo, hi] = cfg.bandLiftCounts[input.weeklyHours];
    // Scale within the range by lifting experience: beginner -> min, advanced -> max.
    const expIdx =
      input.liftingExp === "advanced" ? 2 : input.liftingExp === "intermediate" ? 1 : 0;
    const n = Math.round(lo + ((hi - lo) * expIdx) / 2);
    counts.lift = { base: n, build: n, peak: n, taper: Math.max(1, n - 1) };
    counts.researchLifts = true;
  }

  // Research session budget (Finding 4): cap total weekly sessions to the band's
  // Section 6 shape (~5–6 anchors) so a low-budget athlete isn't over-fractionated.
  if (input.weeklyHours && cfg.bandZone3Z) {
    counts.weeklySessionCap = bandSessionCap(input.weeklyHours);
    counts.anchorRunFloor = bandAnchorRunFloor(input.weeklyHours);
  }

  // General fitness has no race to peak toward: a rotating-emphasis macro-arc
  // (strength → aerobic → mixed) with no taper, instead of Base/Build/Peak/Taper.
  if (cfg.programType === "general_fitness") {
    return buildRotationSkeleton(input, cfg, counts);
  }

  // Triathlon (Family B) uses per-discipline swim/bike/run/brick volume — its own
  // deterministic skeleton path (see sports/triathlon.ts).
  if (cfg.family === "triathlon") {
    return buildTriathlonSkeleton(input, cfg);
  }

  const alloc = allocateMesocycles(input);
  const phases = expandPhases(alloc, D);
  const nonTaperWeeks = alloc.base + alloc.build + alloc.peak;

  // 1. Continuous microcycle progression across the non-taper weeks.
  //    User-supplied starting volume overrides the experience-derived defaults.
  const startMi =
    input.startMileage ??
    (input.weeklyHours
      ? round1(
          bandStartMileage(input.weeklyHours) *
            runImpactFactor(input.runningExp, input.bodyWeightLbs),
        )
      : cfg.volume.kind === "single_currency"
        ? cfg.volume.startMileageByExp[input.runningExp]
        : startingMileage(input.runningExp));
  const startCa =
    input.startCardioMinutes ??
    (input.weeklyHours
      ? bandStartCardioMinutes(input.weeklyHours)
      : startingCardioMinutes(startMi));
  const seq = sequenceMicrocycles(nonTaperWeeks, input.trainingClass, startMi, startCa, input.age);

  // 2. Assemble full-length base arrays; apply the peak-phase volume drop.
  const baseMileage: number[] = new Array(D).fill(0);
  const baseCardio: number[] = new Array(D).fill(0);
  const basisMileage: number[] = new Array(D).fill(0); // held peak reference
  const basisCardio: number[] = new Array(D).fill(0);
  const labels: MicroWeekType[] = new Array(D).fill("rebound");

  for (let i = 0; i < nonTaperWeeks; i++) {
    const peakFactor = phases[i] === "peak" ? PEAK_VOLUME_FACTOR : 1;
    // safe: seq arrays all have length nonTaperWeeks, and i < nonTaperWeeks
    baseMileage[i] = round1(seq.mileage[i]! * peakFactor);
    baseCardio[i] = Math.round(seq.cardioMinutes[i]! * peakFactor);
    basisMileage[i] = round1(seq.heldMileage[i]! * peakFactor);
    basisCardio[i] = Math.round(seq.heldCardio[i]! * peakFactor);
    labels[i] = seq.labels[i]!;
  }

  // Seed the trailing Taper-mesocycle weeks with the last held peak level;
  // applyTapers overrides them from the race protocol.
  // safe: guarded by nonTaperWeeks > 0, so nonTaperWeeks - 1 is in-bounds of the length-D arrays
  const lastHeldMi = nonTaperWeeks > 0 ? basisMileage[nonTaperWeeks - 1]! : startMi;
  const lastHeldCa = nonTaperWeeks > 0 ? basisCardio[nonTaperWeeks - 1]! : startCa;
  for (let i = nonTaperWeeks; i < D; i++) {
    baseMileage[i] = lastHeldMi;
    baseCardio[i] = lastHeldCa;
    basisMileage[i] = lastHeldMi;
    basisCardio[i] = lastHeldCa;
    labels[i] = "taper";
  }

  // 3. Insert race tapers (working backward from each race).
  const tapered = applyTapers(
    { mileage: baseMileage, cardioMinutes: baseCardio, microLabels: labels },
    input.races,
    { mileage: basisMileage, cardioMinutes: basisCardio },
  );

  // Contiguous mesocycles start at fixed offsets (Base→Build→Peak→Taper), used
  // to tell the slot builder where a week sits inside its phase (Tasks #5).
  const phaseStart: Record<string, number> = {
    base: 0,
    build: alloc.base,
    peak: alloc.base + alloc.build,
    taper: alloc.base + alloc.build + alloc.peak,
  };
  const phaseLength: Record<string, number> = {
    base: alloc.base,
    build: alloc.build,
    peak: alloc.peak,
    taper: alloc.taper,
  };

  // 4. Build week objects with slots + zone targets.
  const weeks: WeekSkeleton[] = [];
  for (let i = 0; i < D; i++) {
    const weekNumber = i + 1;
    // safe: phases and tapered arrays all have length D, and i < D
    const phase = phases[i]!;
    const microWeek = tapered.microLabels[i]!;
    const race = tapered.raceWeeks.get(weekNumber);
    // safe: phaseStart/phaseLength have an entry for every PhaseName
    const pos = { index: i - phaseStart[phase]!, length: phaseLength[phase]! };

    weeks.push({
      weekNumber,
      phase,
      microWeek,
      targetMileage: tapered.mileage[i]!,
      targetCardioMinutes: tapered.cardioMinutes[i]!,
      zoneTargets: input.weeklyHours
        ? cfg.bandZone3Z
          ? bandPhaseZoneTargets(phase, input.weeklyHours, cfg.bandZone3Z)
          : applyBandZoneShift(cfg.phaseZoneTargets[phase], input.weeklyHours)
        : { ...cfg.phaseZoneTargets[phase] },
      days: assignDays(
        input.trainingDays,
        phase,
        microWeek,
        input.runningExp,
        input.hybridExp,
        race,
        {
          longRunDays: input.longRunDays,
          restDays: input.restDays,
          liftDays: input.liftDays,
          hybridDays: input.hybridDays,
        },
        pos,
        input.needs?.bias,
        counts,
      ),
      raceDay: race ? { priority: race.priority, date: race.date } : undefined,
    });
  }

  // After a B race, open the following week with a full rest day then two
  // easy days (48–72h recovery) before resuming normal training.
  applyPostBRaceRecovery(weeks, input.races);

  return {
    durationWeeks: D,
    trainingClass: input.trainingClass,
    allocation: alloc,
    weeks,
    needs: input.needs,
    restDays: input.restDays,
    caps: input.caps,
  };
}

/** Non-rest workouts on a day. */
function workoutCount(day: WeekSkeleton["days"][number]): number {
  return day.sessions.filter((s) => s.kind !== "rest").length;
}

/**
 * B-race post-race recovery: rest day + two easy days at the start of the week
 * following each B race (spec addition — B post-race protocol).
 *
 * The first three training days are overwritten by the protocol. Anything that
 * was scheduled there used to be silently DELETED, which is how the week after a
 * B race could end up with **zero strength work** for an entire Build week (an
 * athlete who pins their lifts to early-week days lost all of them at once).
 *
 * Displaced LIFT and HYBRID sessions are now re-homed onto the later days of the
 * same week — 4+ days after the race, so recovery is untouched. Displaced RUNS
 * are deliberately NOT carried over: `reconcileWeekVolume` re-sizes whatever runs
 * remain to hit the week's prescribed mileage exactly, so a dropped run loses no
 * volume, while a dropped lift or hybrid is simply gone.
 */
function applyPostBRaceRecovery(weeks: WeekSkeleton[], races: EngineRace[]): void {
  for (const race of races) {
    if (race.priority !== "B") continue;
    const nextWeek = weeks[race.weekNumber]; // weekNumber is 1-based → index = the next week
    if (!nextWeek) continue;
    const d = nextWeek.days;

    const displaced: SessionSlot[] = [];
    for (const idx of [0, 1, 2]) {
      const day = d[idx];
      if (!day) continue;
      for (const s of day.sessions) if (s.kind === "lift" || s.kind === "hybrid") displaced.push(s);
    }

    if (d[0]) d[0].sessions = [{ kind: "rest" }];
    if (d[1]) d[1].sessions = [{ kind: "run", runType: "easy", goalZone: 2 }];
    if (d[2]) d[2].sessions = [{ kind: "run", runType: "easy", goalZone: 2 }];

    // Re-home onto the emptiest later day, keeping the engine's standing rules:
    // at most 2 workouts a day and never two lifts on the same day.
    for (const sess of displaced) {
      let best = -1;
      for (let i = 3; i < d.length; i++) {
        const day = d[i]!; // safe: i < d.length
        if (workoutCount(day) >= 2) continue;
        if (sess.kind === "lift" && day.sessions.some((x) => x.kind === "lift")) continue;
        if (best === -1 || workoutCount(day) < workoutCount(d[best]!)) best = i;
      }
      if (best === -1) continue; // genuinely no room left — drop, as before
      const target = d[best]!; // safe: best is a valid index
      const restIdx = target.sessions.findIndex((x) => x.kind === "rest");
      if (restIdx !== -1) target.sessions.splice(restIdx, 1); // a rest slot yields
      target.sessions.push(sess);
      // Keep the priority workout first on any day that now doubles up.
      target.sessions.sort((a, b) => slotPriority(b) - slotPriority(a));
    }
    // Re-homing packs lifts onto the emptiest later days without regard to the
    // full-body-lift spacing rule, so two full lifts can land on consecutive days
    // (e.g. Fri+Sat). Re-spread which of these days carries the heavy "full"
    // session so full lifts are never consecutive.
    spreadFullLiftTypes(d);
  }
}

// --- General-fitness rotating-emphasis macro-arc (no race, no taper) ---

/** Emphasis block → synthetic phase, so strength schemes + zone targets + run-type
 *  selection all reuse the existing phase machinery unchanged. */
const EMPHASIS_PHASE: Record<string, PhaseName> = {
  aerobic: "base",
  mixed: "build",
  strength: "peak",
};

/** Sub-goal → the block rotation. Balanced cycles evenly; the others weight the loop. */
const SUBGOAL_ROTATION: Record<string, string[]> = {
  balanced: ["aerobic", "strength", "mixed"],
  recomp: ["strength", "aerobic", "mixed"],
  general_strength: ["strength", "mixed", "aerobic", "strength"],
  general_endurance: ["aerobic", "mixed", "aerobic", "strength"],
};

const BLOCK_WEEKS = 4;

/**
 * Build a general-fitness skeleton: repeating ~4-week emphasis blocks
 * (strength/aerobic/mixed) instead of Base→Build→Peak→Taper. Microcycles run
 * continuously across all weeks (rising baseline), there is no taper, and each
 * week carries its `emphasis` for the UI/AI. The sub-goal chooses the rotation.
 */
function buildRotationSkeleton(
  input: EngineInput,
  cfg: SportConfig,
  counts: SessionCountTables,
): ProgramSkeleton {
  const D = input.durationWeeks;
  const startMi =
    input.startMileage ??
    (input.weeklyHours
      ? round1(
          bandStartMileage(input.weeklyHours) *
            runImpactFactor(input.runningExp, input.bodyWeightLbs),
        )
      : cfg.volume.kind === "single_currency"
        ? cfg.volume.startMileageByExp[input.runningExp]
        : startingMileage(input.runningExp));
  const startCa =
    input.startCardioMinutes ??
    (input.weeklyHours
      ? bandStartCardioMinutes(input.weeklyHours)
      : startingCardioMinutes(startMi));
  // Continuous progression across ALL weeks (no taper carve-out) → rising baseline.
  const seq = sequenceMicrocycles(D, input.trainingClass, startMi, startCa, input.age);

  const rotation = SUBGOAL_ROTATION[input.subGoal ?? "balanced"] ?? SUBGOAL_ROTATION.balanced!;

  const weeks: WeekSkeleton[] = [];
  for (let i = 0; i < D; i++) {
    const blockIdx = Math.floor(i / BLOCK_WEEKS);
    const emphasis = rotation[blockIdx % rotation.length]!;
    const phase = EMPHASIS_PHASE[emphasis]!;
    const microWeek = seq.labels[i]!;
    const posIndex = i % BLOCK_WEEKS;
    const posLen = Math.min(BLOCK_WEEKS, D - blockIdx * BLOCK_WEEKS);
    // Strength-emphasis blocks (mapped to "peak") carry slightly less cardio volume.
    const peakFactor = phase === "peak" ? PEAK_VOLUME_FACTOR : 1;

    weeks.push({
      weekNumber: i + 1,
      phase,
      microWeek,
      targetMileage: round1(seq.mileage[i]! * peakFactor),
      targetCardioMinutes: Math.round(seq.cardioMinutes[i]! * peakFactor),
      zoneTargets: input.weeklyHours
        ? cfg.bandZone3Z
          ? bandPhaseZoneTargets(phase, input.weeklyHours, cfg.bandZone3Z)
          : applyBandZoneShift(cfg.phaseZoneTargets[phase], input.weeklyHours)
        : { ...cfg.phaseZoneTargets[phase] },
      days: assignDays(
        input.trainingDays,
        phase,
        microWeek,
        input.runningExp,
        input.hybridExp,
        undefined, // no race
        {
          longRunDays: input.longRunDays,
          restDays: input.restDays,
          liftDays: input.liftDays,
          hybridDays: input.hybridDays,
        },
        { index: posIndex, length: posLen },
        input.needs?.bias,
        counts,
      ),
      emphasis,
    });
  }

  // Allocation is informational for general fitness — report block-phase counts.
  const alloc = { base: 0, build: 0, peak: 0, taper: 0 };
  for (const w of weeks) alloc[w.phase] += 1;

  return {
    durationWeeks: D,
    trainingClass: input.trainingClass,
    allocation: alloc,
    weeks,
    needs: input.needs,
    restDays: input.restDays,
    caps: input.caps,
  };
}

// --- Adapter: GenerationInput (spec section 2 shape) -> EngineInput (week-space) ---

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Convert a validated GenerationInput into the engine's week-space input.
 *
 * `startDate` is required for goal_event programs (to place races by week and,
 * when durationWeeks is omitted, to derive the program length from the final
 * race). For fixed_duration / general_fitness, durationWeeks drives length and
 * any races are positioned relative to the start.
 */
/** Body weight in kilograms (bike W/kg needs kg regardless of the athlete's unit). */
function toLbs(weight: number | undefined, unit: "lbs" | "kg" | undefined): number | undefined {
  if (weight === undefined || !(weight > 0)) return undefined;
  return unit === "kg" ? weight * 2.2046226218 : weight;
}

function toKg(weight: number | undefined, unit: "lbs" | "kg" | undefined): number | undefined {
  if (!weight || weight <= 0) return undefined;
  return unit === "lbs" ? weight * 0.453592 : weight;
}

export function toEngineInput(input: GenerationInput, startDate?: string): EngineInput {
  const start = startDate ? new Date(startDate) : undefined;
  const sportCfg = getSport(input.sport);

  const rawRaces = input.races ?? [];
  let races: EngineRace[] = [];

  if (start && rawRaces.length > 0) {
    races = rawRaces
      .map((r) => ({
        weekNumber: Math.max(
          1,
          Math.ceil((new Date(r.raceDate).getTime() - start.getTime()) / MS_PER_WEEK),
        ),
        priority: r.priority,
        date: r.raceDate,
      }))
      .sort((a, b) => a.weekNumber - b.weekNumber);
  }

  // Determine duration.
  let durationWeeks = input.durationWeeks ?? 0;
  if (!durationWeeks) {
    if (races.length > 0) {
      durationWeeks = Math.max(...races.map((r) => r.weekNumber));
    } else {
      durationWeeks = 12; // sensible default; onboarding should always supply one
    }
  }
  durationWeeks = clamp(durationWeeks, 4, 24);

  races = races
    .map((r) => ({ ...r, weekNumber: clamp(r.weekNumber, 1, durationWeeks) }))
    .filter((r, idx, arr) => arr.findIndex((x) => x.weekNumber === r.weekNumber) === idx);

  return {
    sport: input.sport ?? "hyrox",
    // Carried through at P0 (unconsumed) so the band reaches the engine when
    // volume/zone scaling is wired in a later phase. buildSkeleton ignores it
    // today, so HYROX output stays byte-identical.
    weeklyHours: input.profile.weeklyHours,
    subGoal: input.subGoal,
    trainingClass: input.profile.trainingClass,
    age: input.profile.age,
    runningExp: input.profile.runningExp,
    hybridExp: input.profile.hybridExp,
    liftingExp: input.profile.liftingExp,
    // Explicit per-discipline experience wins; else derive from CSS / FTP anchors.
    swimLevel: input.profile.swimExp ?? swimLevelFromCss(input.profile.benchmarks?.cssPace),
    bikeLevel:
      input.profile.bikeExp ??
      bikeLevelFromFtp(
        input.profile.benchmarks?.ftpWatts,
        toKg(input.profile.bodyWeight, input.profile.weightUnit),
        input.profile.sex,
      ),
    programType: input.programType,
    durationWeeks,
    trainingDays: input.profile.trainingDays,
    races,
    startMileage: input.startMileage,
    startCardioMinutes: input.startCardioMinutes,
    bodyWeightLbs: toLbs(input.profile.bodyWeight, input.profile.weightUnit),
    longRunDays: normalizeLongRunDays(input.profile.dayPreferences),
    restDays: input.profile.dayPreferences?.restDays,
    caps: trainingCaps(
      getSport(input.sport).family,
      {
        runningExp: input.profile.runningExp,
        hybridExp: input.profile.hybridExp,
        liftingExp: input.profile.liftingExp,
      },
      input.profile.weeklyHours,
    ),
    liftDays: input.profile.dayPreferences?.liftDays,
    hybridDays: input.profile.dayPreferences?.hybridDays,
    needs: analyzeNeedsForSport(input.profile, input.sport, {
      ergStations: sportCfg.needsStations?.erg,
      strengthStations: sportCfg.needsStations?.strength,
    }),
  };
}
