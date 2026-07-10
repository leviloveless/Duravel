import { z } from "zod";

/**
 * Shared Zod schemas — spec §2 (user inputs) and §6 (generated program shape).
 * These do triple duty: form validation, AI response validation, DB read validation.
 */

export const ExperienceLevel = z.enum(["beginner", "intermediate", "advanced"]);
export const TrainingClass = z.enum(["non_highly_trained", "highly_trained"]);
export const WeightUnit = z.enum(["lbs", "kg"]);
export const RacePriority = z.enum(["A", "B", "C"]);
export const ProgramType = z.enum(["goal_event", "fixed_duration", "general_fitness"]);
export const TrainingDay = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export const BenchmarksSchema = z.object({
  mileTime: z.string().optional(),
  fiveKTime: z.string().optional(),
  tenKTime: z.string().optional(),
  fiveRmSquat: z.number().optional(),
  fiveRmBench: z.number().optional(),
  fiveRmDeadlift: z.number().optional(),
  ski2kTime: z.string().optional(),
  row2kTime: z.string().optional(),
  bike20MinCals: z.number().optional(),
});

export const ProfileSchema = z.object({
  firstName: z.string().min(1),
  age: z.number().int().min(13).max(100),
  bodyWeight: z.number().positive(),
  weightUnit: WeightUnit,
  runningExp: ExperienceLevel,
  hybridExp: ExperienceLevel,
  liftingExp: ExperienceLevel,
  trainingClass: TrainingClass,
  trainingDays: z.array(TrainingDay).min(3),
  benchmarks: BenchmarksSchema.optional(),
});

export const RaceSchema = z.object({
  raceDate: z.string(), // ISO date
  priority: RacePriority,
});

export const GenerationInputSchema = z.object({
  profile: ProfileSchema,
  programType: ProgramType,
  durationWeeks: z.number().int().min(4).max(24).optional(),
  races: z.array(RaceSchema).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Race = z.infer<typeof RaceSchema>;
export type GenerationInput = z.infer<typeof GenerationInputSchema>;

// --- Program skeleton / session types (architecture-plan.md §6) ---

export const Phase = z.enum(["base", "build", "peak", "taper"]);
export const MicroWeek = z.enum(["rebound", "increase", "deload", "taper", "race"]);
export const MovementPattern = z.enum([
  "squat",
  "hip_hinge",
  "lunge",
  "horizontal_press",
  "vertical_press",
  "horizontal_pull",
  "vertical_pull",
]);

export const RunSessionSchema = z.object({
  kind: z.literal("run"),
  runType: z.enum(["easy", "fartlek", "long", "tempo", "threshold", "interval", "hybrid_run"]),
  durationMin: z.number(),
  paceMinMile: z.string(),
  distanceMiles: z.number(),
  goalZone: z.number().int().min(1).max(5),
});

export const LiftSessionSchema = z.object({
  kind: z.literal("lift"),
  liftType: z.enum(["upper", "lower", "full"]),
  movements: z.array(
    z.object({
      pattern: MovementPattern,
      sets: z.number().int(),
      repRange: z.string(),
      suggestedWeight: z.string().optional(),
    }),
  ),
});

export const HybridSessionSchema = z.object({
  kind: z.literal("hybrid"),
  goalZone: z.number().int().min(1).max(5),
  elements: z.array(
    z.object({
      exercise: z.string(),
      prescription: z.string(),
    }),
  ),
});

export const RaceSessionSchema = z.object({
  kind: z.literal("race"),
  priority: RacePriority,
});

export const SessionSchema = z.discriminatedUnion("kind", [
  RunSessionSchema,
  LiftSessionSchema,
  HybridSessionSchema,
  RaceSessionSchema,
]);

export type Session = z.infer<typeof SessionSchema>;

// --- Assembled program shape (persisted to programs.program_data) ---

export const ZoneDistributionSchema = z.object({
  z1: z.number(),
  z2: z.number(),
  z3: z.number(),
  z4: z.number(),
  z5: z.number(),
});

/** Weekly summary block (spec §7). Recomputed from the engine's numeric
 *  targets during assembly — never taken from AI output. */
export const WeekSummarySchema = z.object({
  totalCardioMinutes: z.number(),
  totalMileage: z.number(),
  zoneDistribution: ZoneDistributionSchema,
});

export const DaySchema = z.object({
  day: TrainingDay,
  /** Empty array = rest day. */
  sessions: z.array(SessionSchema),
});

export const ProgramWeekSchema = z.object({
  weekNumber: z.number().int(),
  phase: Phase,
  microWeek: MicroWeek,
  summary: WeekSummarySchema,
  days: z.array(DaySchema),
  raceDay: z.object({ priority: RacePriority, date: z.string().optional() }).optional(),
});

export const ProgramDataSchema = z.object({
  generatedAt: z.string(),
  weeks: z.array(ProgramWeekSchema),
});

export type ZoneDistributionData = z.infer<typeof ZoneDistributionSchema>;
export type WeekSummary = z.infer<typeof WeekSummarySchema>;
export type ProgramDay = z.infer<typeof DaySchema>;
export type ProgramWeek = z.infer<typeof ProgramWeekSchema>;
export type ProgramData = z.infer<typeof ProgramDataSchema>;

// --- AI chunk response (what one Haiku call returns for a mesocycle) ---
//
// The AI fills concrete session *content* only; the engine owns structure,
// volume, and zones. Each returned day's sessions must line up with the
// engine's slot kinds for that day (validated during assembly).

export const AiDaySchema = z.object({
  day: TrainingDay,
  sessions: z.array(SessionSchema),
});

export const AiWeekSchema = z.object({
  weekNumber: z.number().int(),
  days: z.array(AiDaySchema),
});

export const AiChunkSchema = z.object({
  weeks: z.array(AiWeekSchema),
});

export type AiDay = z.infer<typeof AiDaySchema>;
export type AiWeek = z.infer<typeof AiWeekSchema>;
export type AiChunk = z.infer<typeof AiChunkSchema>;

/** The 7 non-negotiable lifting movement patterns (spec §5b). */
export const REQUIRED_MOVEMENT_PATTERNS = [
  "squat",
  "hip_hinge",
  "lunge",
  "horizontal_press",
  "vertical_press",
  "horizontal_pull",
  "vertical_pull",
] as const;
