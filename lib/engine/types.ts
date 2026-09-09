/**
 * Periodization Engine — shared internal types (architecture-plan.md §6).
 *
 * The engine works in "week space": it takes a normalized EngineInput
 * (duration in weeks + races positioned by week number) and produces a
 * fully deterministic ProgramSkeleton. Converting real calendar dates
 * (goal_event programs) into week numbers is the adapter's job
 * (see toEngineInput in skeleton.ts), not the core math's.
 */

import type { z } from "zod";
import type { TrainingCaps } from "./caps";
import {
  ExperienceLevel as ExperienceLevelEnum,
  TrainingClass as TrainingClassEnum,
  ProgramType as ProgramTypeEnum,
  TrainingDay as TrainingDayEnum,
  Phase as PhaseEnum,
  MicroWeek as MicroWeekEnum,
  RacePriority as RacePriorityEnum,
  RunType as RunTypeEnum,
} from "@/lib/schemas";
import type { NeedsAnalysis } from "./needs";
import type { SportId, WeeklyHoursBand } from "@/lib/schemas";

// Engine string-union types are DERIVED from the canonical Zod enums (roadmap
// #2.5) so the schema and the engine can never drift out of sync.
export type ExperienceLevel = z.infer<typeof ExperienceLevelEnum>;
export type TrainingClassName = z.infer<typeof TrainingClassEnum>;
export type ProgramTypeName = z.infer<typeof ProgramTypeEnum>;
export type TrainingDayName = z.infer<typeof TrainingDayEnum>;
export type PhaseName = z.infer<typeof PhaseEnum>;
export type MicroWeekType = z.infer<typeof MicroWeekEnum>;
export type RacePriorityName = z.infer<typeof RacePriorityEnum>;
export type RunType = z.infer<typeof RunTypeEnum>;

// --- Engine input ---

export interface EngineRace {
  /** 1-based week number in which the race falls (usually the week's end). */
  weekNumber: number;
  priority: RacePriorityName;
  /** Optional ISO date, carried through for display only. */
  date?: string;
}

export interface EngineInput {
  /** Target sport (multi-sport expansion). Omitted → HYROX. */
  sport?: SportId;
  /** Weekly training-time budget (volume-vs-intensity research). Omitted → legacy
   *  experience-derived volume (keeps golden-HYROX byte-identical). Consumed by
   *  volume/zone scaling in a later phase; carried through at P0 but unused. */
  weeklyHours?: WeeklyHoursBand;
  /** General-fitness sub-goal (biases the emphasis rotation). Omitted → balanced. */
  subGoal?: string;
  trainingClass: TrainingClassName;
  /** Athlete age — masters (≥ MASTERS_AGE) get more frequent deloads (Review #10). */
  age?: number;
  runningExp: ExperienceLevel;
  hybridExp: ExperienceLevel;
  liftingExp: ExperienceLevel;
  /** Triathlon swim proficiency, derived from CSS pace. Omitted → run level. */
  swimLevel?: ExperienceLevel;
  /** Triathlon bike proficiency, derived from FTP (W/kg). Omitted → run level. */
  bikeLevel?: ExperienceLevel;
  programType: ProgramTypeName;
  durationWeeks: number; // 4–24
  trainingDays: TrainingDayName[]; // ≥3
  races: EngineRace[]; // may be empty (general fitness / fixed duration)
  /** Optional user overrides for starting weekly volume. When omitted the
   *  engine derives these from running experience (see volume.ts). */
  startMileage?: number;
  startCardioMinutes?: number;
  /** How many days a week the athlete trains TODAY (onboarding, optional) — a
   *  starting-FITNESS signal, distinct from `trainingDays` (what they've committed
   *  to). Pitches the STARTING volume toward their real current base; see
   *  `startVolumeReadiness` in time-budget.ts. Omitted → no adjustment. */
  currentDaysPerWeek?: number;
  /** Optional preferred day(s) for the weekly long run (new-additions #4;
   *  multi-day selection added later). The engine uses the first (most-preferred)
   *  trained day consistently, so the long run lands on the same day every week. */
  longRunDays?: TrainingDayName[];
  /** Optional days the athlete prefers to keep as full rest (new-additions #4). */
  restDays?: TrainingDayName[];
  /** Session/day minute caps for this athlete on this sport (lib/engine/caps.ts). */
  caps?: TrainingCaps;
  /** Optional preferred days for strength / lifting sessions (Tasks #1). */
  liftDays?: TrainingDayName[];
  /** Optional preferred days for hybrid (HYROX) sessions (Tasks #1). */
  hybridDays?: TrainingDayName[];
  /** Needs analysis + program bias derived from the athlete's benchmarks
   *  (Review #1). When omitted the engine runs with a neutral (unbiased)
   *  program, exactly as before this feature. */
  needs?: NeedsAnalysis;
  /** Athlete bodyweight normalized to LBS. Batch 7: shifts the running share of
   *  the band aerobic budget down for heavier athletes (impact routing). */
  bodyWeightLbs?: number;
  /**
   * A week the ATHLETE authored, day by day (custom tier, Levi 2026-09-08).
   *
   * When present it replaces `planWeek`/`assignDays` as the source of the week's
   * SHAPE — which sessions, on which days. It never carries volume: no
   * distances, no durations, no zones. Every number still comes from the engine,
   * so the mileage progression, the long run's jump ceiling and 90-minute cap,
   * the 20% quality share, the 3-mile run floor and the deload/taper cuts all
   * apply exactly as they do to a generated week.
   *
   * Omitted → the phase tables decide, byte-for-byte as before.
   */
  weekTemplate?: WeekTemplate;
  /**
   * Later templates, each taking effect from its own week (custom tier).
   *
   * An athlete who adds a session in week 9 wants it in weeks 9 through 16 and
   * has already trained weeks 1 through 8 — so a program is not one authored
   * week, it is a sequence of them with the weeks they started on. Storing the
   * history rather than overwriting keeps the weeks they already trained
   * truthful, which matters: those weeks are what the long run's trailing
   * four-week maximum is measured against, so rewriting them would move a
   * ceiling that has already done its job.
   *
   * Entries need not be sorted; `templateForWeek` takes the latest that applies.
   */
  weekTemplateChanges?: { fromWeek: number; template: WeekTemplate }[];
}

// --- Athlete-authored week template (custom tier) ---

/**
 * One session in an authored week. Deliberately thin.
 *
 * `runType` and `liftType` are OPTIONAL, and that is the useful part: an athlete
 * who wants a hard Tuesday without caring which kind of hard leaves `runType`
 * off, and the slot is filled from the phase's own pool — so their shape still
 * progresses base → build → peak. A type they DID name always wins.
 */
export interface TemplateSession {
  kind: "run" | "lift" | "hybrid" | "brick" | "bike";
  runType?: RunType;
  liftType?: LiftSlot["liftType"];
  /**
   * How big this session STARTS, if the athlete said (custom tier, Levi
   * 2026-09-09: "the custom program builder needs to allow the user to input
   * times and mileage for the runs / bikes / bricks").
   *
   * This is the first crack in the rule the tier was built on — "the template
   * says WHAT and WHERE, never HOW MUCH" — and it is deliberately a crack rather
   * than a break. The number is WEEK ONE only. The engine still ramps it, still
   * deloads and tapers it, still holds it to the 3-mile floor, the session time
   * cap, the long run's +10% jump ceiling and hours-win. What the athlete gets is
   * the starting point; what the engine keeps is every guard that makes a custom
   * program the same engine rather than a second one.
   *
   * Which field applies depends on the kind:
   *
   *   run    `startMiles` — the designer converts a time the athlete typed into
   *          miles at that run type's own pace before storing, so the engine only
   *          ever sees one currency for running.
   *   bike   `startMin` — a ride has no mileage in a station program's budget.
   *   brick  `startMin` is the BIKE leg, `startMiles` the RUN leg. Two legs, two
   *          currencies, which is what a brick is.
   *   lift / hybrid — neither. A lift is a fixed hour and a hybrid's size is the
   *          race's, not the athlete's.
   *
   * Absent means what it has always meant: the engine sizes it.
   */
  startMiles?: number;
  startMin?: number;
}

export interface TemplateDay {
  day: TrainingDayName;
  sessions: TemplateSession[];
}

export interface WeekTemplate {
  days: TemplateDay[];
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
  /**
   * The share of the week's mileage this run should take, when the athlete sized
   * it (custom tier).
   *
   * A SHARE rather than the miles they typed, because the miles are week one and
   * a program is sixteen weeks. Holding the share means the run grows with the
   * ramp, shrinks in a deload and sheds in a taper without any of those passes
   * needing to know it was authored — and because week one's mileage target is
   * itself derived from the sizes, the share reproduces the athlete's own number
   * in week one exactly.
   */
  shareOfWeek?: number;
  /** Prescribed duration (triathlon runs carry it directly; HYROX runs omit it —
   *  the reconciler sizes them from the mileage target). */
  durationMin?: number;
}
export interface LiftSlot {
  kind: "lift";
  liftType: "upper" | "lower" | "full" | "power";
}
export interface HybridSlot {
  kind: "hybrid";
  goalZone: number;
  /** Marks a Peak race-simulation hybrid (Review #9). */
  simulation?: boolean;
}
export interface RestSlot {
  kind: "rest";
}
export interface RaceSlot {
  kind: "race";
  priority: RacePriorityName;
}
// --- Triathlon session slots (swim / bike / brick) ---
export interface SwimSlot {
  kind: "swim";
  goalZone: number;
  durationMin: number;
  sessionType: "technique" | "css" | "threshold" | "endurance" | "open_water";
}
export interface BikeSlot {
  kind: "bike";
  goalZone: number;
  durationMin: number;
  isLong?: boolean;
  sessionType: "endurance" | "sweet_spot" | "threshold" | "vo2" | "recovery";
}
export interface BrickSegment {
  discipline: "bike" | "run" | "swim";
  durationMin: number;
  goalZone: number;
  /**
   * On-feet distance for a RUN segment, stamped by the reconciler (2026-09-09).
   *
   * A segment has always carried minutes, which is all a triathlon brick needed
   * — the triathlon skeleton budgets in time. But `sessionWorkMiles` returned 0
   * for a brick, so once an athlete could put a brick in an authored HYROX week
   * the run off the bike would have been real running the week's mileage did not
   * count: the reported total would understate what was actually run, and the
   * reconciler would grow the OTHER runs to make up an apparent shortfall. That
   * is the work-vs-total shape for the tenth time.
   *
   * Optional because a triathlon brick built before this reads as it always did
   * — zero — rather than needing a migration.
   */
  distanceMiles?: number;
}
export interface BrickSlot {
  kind: "brick";
  goalZone: number;
  segments: BrickSegment[];
  /**
   * Whether the run leg counts toward the week's running mileage.
   *
   * True on an ATHLETE-AUTHORED brick (custom tier): the athlete put it in a
   * HYROX week whose whole budget is miles, so the run off the bike has to be
   * part of that budget or the week silently runs further than it says.
   *
   * Absent on a TRIATHLON brick, deliberately. Those are built by
   * `buildTriathlonSkeleton` against a TIME budget and have never counted, so
   * switching them on here would move every existing triathlon week's reported
   * mileage — a change worth measuring on its own rather than smuggling in
   * behind a feature. Flagged for Levi, 2026-09-09.
   */
  countsTowardMileage?: boolean;
}
export type SessionSlot =
  RunSlot | LiftSlot | HybridSlot | RestSlot | RaceSlot | SwimSlot | BikeSlot | BrickSlot;

/** A predicate over engine session slots (used by slot placement + sequencing). */
export type SlotPredicate = (slot: SessionSlot) => boolean;

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
  /** General-fitness rotating emphasis for this week (strength|aerobic|mixed). */
  emphasis?: string;
}

export interface ProgramSkeleton {
  durationWeeks: number;
  trainingClass: TrainingClassName;
  allocation: MesocycleAllocation;
  weeks: WeekSkeleton[];
  /**
   * Days the ATHLETE asked to keep clear. Distinct from a day that merely ended
   * up with no sessions — `assignDays` appends a `rest` slot to any empty day, so
   * the two are indistinguishable downstream unless the real preference is carried
   * through. The generation stage needs the difference: filler must never land on
   * a chosen rest day, but an incidentally-empty day is exactly where it should go.
   */
  restDays?: TrainingDayName[];
  /** Session/day minute caps for this athlete on this sport (lib/engine/caps.ts). */
  caps?: TrainingCaps;
  /** Needs analysis behind this program's biasing, for UI / audit (Review #1). */
  needs?: NeedsAnalysis;
}
