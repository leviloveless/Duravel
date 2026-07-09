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
import { assignDays } from "./slots";
import { PEAK_VOLUME_FACTOR, PHASE_ZONE_TARGETS, startingCardioMinutes, startingMileage } from "./volume";

/**
 * Build the full deterministic program skeleton from a normalized EngineInput.
 */
export function buildSkeleton(input: EngineInput): ProgramSkeleton {
  const D = input.durationWeeks;
  const alloc = allocateMesocycles(input);
  const phases = expandPhases(alloc, D);
  const nonTaperWeeks = alloc.base + alloc.build + alloc.peak;

  // 1. Continuous microcycle progression across the non-taper weeks.
  const startMi = startingMileage(input.runningExp);
  const startCa = startingCardioMinutes(startMi);
  const seq = sequenceMicrocycles(nonTaperWeeks, input.trainingClass, startMi, startCa);

  // 2. Assemble full-length base arrays; apply the peak-phase volume drop.
  const baseMileage: number[] = new Array(D).fill(0);
  const baseCardio: number[] = new Array(D).fill(0);
  const basisMileage: number[] = new Array(D).fill(0); // held peak reference
  const basisCardio: number[] = new Array(D).fill(0);
  const labels: MicroWeekType[] = new Array(D).fill("rebound");

  for (let i = 0; i < nonTaperWeeks; i++) {
    const peakFactor = phases[i] === "peak" ? PEAK_VOLUME_FACTOR : 1;
    baseMileage[i] = round1(seq.mileage[i] * peakFactor);
    baseCardio[i] = Math.round(seq.cardioMinutes[i] * peakFactor);
    basisMileage[i] = round1(seq.heldMileage[i] * peakFactor);
    basisCardio[i] = Math.round(seq.heldCardio[i] * peakFactor);
    labels[i] = seq.labels[i];
  }

  // Seed the trailing Taper-mesocycle weeks with the last held peak level;
  // applyTapers overrides them from the race protocol.
  const lastHeldMi = nonTaperWeeks > 0 ? basisMileage[nonTaperWeeks - 1] : startMi;
  const lastHeldCa = nonTaperWeeks > 0 ? basisCardio[nonTaperWeeks - 1] : startCa;
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

  // 4. Build week objects with slots + zone targets.
  const weeks: WeekSkeleton[] = [];
  for (let i = 0; i < D; i++) {
    const weekNumber = i + 1;
    const phase = phases[i];
    const microWeek = tapered.microLabels[i];
    const race = tapered.raceWeeks.get(weekNumber);

    weeks.push({
      weekNumber,
      phase,
      microWeek,
      targetMileage: tapered.mileage[i],
      targetCardioMinutes: tapered.cardioMinutes[i],
      zoneTargets: { ...PHASE_ZONE_TARGETS[phase] },
      days: assignDays(input.trainingDays, phase, microWeek, input.runningExp, input.hybridExp, race),
      raceDay: race ? { priority: race.priority, date: race.date } : undefined,
    });
  }

  return {
    durationWeeks: D,
    trainingClass: input.trainingClass,
    allocation: alloc,
    weeks,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
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
    trainingClass: input.profile.trainingClass,
    runningExp: input.profile.runningExp,
    hybridExp: input.profile.hybridExp,
    liftingExp: input.profile.liftingExp,
    programType: input.programType,
    durationWeeks,
    trainingDays: input.profile.trainingDays,
    races,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
