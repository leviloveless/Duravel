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
  ProgramSkeleton,
  WeekSkeleton,
} from "./types";
import { allocateMesocycles, expandPhases } from "./mesocycles";
import { sequenceMicrocycles } from "./microcycles";
import { applyTapers } from "./taper";
import { PEAK_VOLUME_FACTOR, startingCardioMinutes, startingMileage } from "./volume";
import { assignDays, DEFAULT_COUNTS, type SessionCountTables } from "./slots";
import { getSport } from "./sports";
import { analyzeNeeds } from "./needs";
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
    hybrid: (cfg.sessionCounts.hybrid as SessionCountTables["hybrid"] | undefined) ?? DEFAULT_COUNTS.hybrid,
    lift: (cfg.sessionCounts.lift as SessionCountTables["lift"] | undefined) ?? DEFAULT_COUNTS.lift,
  };
  const alloc = allocateMesocycles(input);
  const phases = expandPhases(alloc, D);
  const nonTaperWeeks = alloc.base + alloc.build + alloc.peak;

  // 1. Continuous microcycle progression across the non-taper weeks.
  //    User-supplied starting volume overrides the experience-derived defaults.
  const startMi =
    input.startMileage ??
    (cfg.volume.kind === "single_currency"
      ? cfg.volume.startMileageByExp[input.runningExp]
      : startingMileage(input.runningExp));
  const startCa = input.startCardioMinutes ?? startingCardioMinutes(startMi);
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
      zoneTargets: { ...cfg.phaseZoneTargets[phase] },
      days: assignDays(
        input.trainingDays,
        phase,
        microWeek,
        input.runningExp,
        input.hybridExp,
        race,
        {
          longRunDay: input.longRunDay,
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
  };
}

/** B-race post-race recovery: rest day + two easy days at the start of the
 *  week following each B race (spec addition — B post-race protocol). */
function applyPostBRaceRecovery(weeks: WeekSkeleton[], races: EngineRace[]): void {
  for (const race of races) {
    if (race.priority !== "B") continue;
    const nextWeek = weeks[race.weekNumber]; // weekNumber is 1-based → index = the next week
    if (!nextWeek) continue;
    const d = nextWeek.days;
    if (d[0]) d[0].sessions = [{ kind: "rest" }];
    if (d[1]) d[1].sessions = [{ kind: "run", runType: "easy", goalZone: 2 }];
    if (d[2]) d[2].sessions = [{ kind: "run", runType: "easy", goalZone: 2 }];
  }
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
export function toEngineInput(input: GenerationInput, startDate?: string): EngineInput {
  const start = startDate ? new Date(startDate) : undefined;

  const rawRaces = input.races ?? [];
  let races: EngineRace[] = [];

  if (start && rawRaces.length > 0) {
    races = rawRaces
      .map((r) => ({
        weekNumber: Math.max(1, Math.ceil((new Date(r.raceDate).getTime() - start.getTime()) / MS_PER_WEEK)),
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
    trainingClass: input.profile.trainingClass,
    age: input.profile.age,
    runningExp: input.profile.runningExp,
    hybridExp: input.profile.hybridExp,
    liftingExp: input.profile.liftingExp,
    programType: input.programType,
    durationWeeks,
    trainingDays: input.profile.trainingDays,
    races,
    startMileage: input.startMileage,
    startCardioMinutes: input.startCardioMinutes,
    longRunDay: input.profile.dayPreferences?.longRunDay,
    restDays: input.profile.dayPreferences?.restDays,
    liftDays: input.profile.dayPreferences?.liftDays,
    hybridDays: input.profile.dayPreferences?.hybridDays,
    needs: analyzeNeeds(input.profile),
  };
}
