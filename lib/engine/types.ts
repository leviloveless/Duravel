/**
 * Periodization Engine — shared internal types (architecture-plan.md §6).
 *
 * The engine works in "week space": it takes a normalized EngineInput
 * (duration in weeks + races positioned by week number) and produces a
 * fully deterministic ProgramSkeleton. Converting real calendar dates
 * (goal_event programs) into week numbers is the adapter's job
 * (see toEngineInput in skeleton.ts), not the core math's.
 */

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export type TrainingClassName = "non_highly_trained" | "highly_trained";
export type ProgramTypeName = "goal_event" | "fixed_duration" | "general_fitness";
export type TrainingDayName =
  | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type PhaseName = "base" | "build" | "peak" | "taper";
export type MicroWeekType = "rebound" | "increase" | "deload" | "taper" | "race";
export type RacePriorityName = "A" | "B" | "C";

export type RunType =
  | "easy" | "fartlek" | "long" | "tempo" | "threshold" | "interval" | "hybrid_run";

// --- Engine input ---

export interface EngineRace {
  /** 1-based week number in which the race falls (usually the week's end). */
  weekNumber: number;
  priority: RacePriorityName;
  /** Optional ISO date, carried through for display only. */
  date?: string;
}

export interface EngineInput {
  trainingClass: TrainingClassName;
  runningExp: ExperienceLevel;
  hybridExp: ExperienceLevel;
  liftingExp: ExperienceLevel;
  programType: ProgramTypeName;
  durationWeeks: number; // 4–24
  trainingDays: TrainingDayName[]; // ≥3
  races: EngineRace[]; // may be empty (general fitness / fixed duration)
}

// --- Allocation ---

export interface MesocycleAllocation {
  base: number;
  build: number;
  peak: number;
  taper: number;
}

// --- Session slots (engine assigns kinds + intensity; AI fills content) ---

export interface RunSlot {
  kind: "run";
  runType: RunType;
  goalZone: number;
  isLong?: boolean;
}
export interface LiftSlot {
  kind: "lift";
  liftType: "upper" | "lower" | "full";
}
export interface HybridSlot {
  kind: "hybrid";
  goalZone: number;
}
export interface RestSlot {
  kind: "rest";
}
export interface RaceSlot {
  kind: "race";
  priority: RacePriorityName;
}
export type SessionSlot = RunSlot | LiftSlot | HybridSlot | RestSlot | RaceSlot;

export interface DaySlot {
  day: TrainingDayName;
  /** May hold >1 session (e.g. AM run + PM lift on a busy training day). */
  sessions: SessionSlot[];
}

// --- Weekly + program output ---

export interface ZoneDistribution {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

export interface WeekSkeleton {
  weekNumber: number;
  phase: PhaseName;
  microWeek: MicroWeekType;
  targetMileage: number;
  targetCardioMinutes: number;
  zoneTargets: ZoneDistribution;
  days: DaySlot[];
  raceDay?: { priority: RacePriorityName; date?: string };
}

export interface ProgramSkeleton {
  durationWeeks: number;
  trainingClass: TrainingClassName;
  allocation: MesocycleAllocation;
  weeks: WeekSkeleton[];
}
