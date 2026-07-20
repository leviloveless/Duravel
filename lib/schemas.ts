import { z } from "zod";

/**
 * Shared Zod schemas — spec §2 (user inputs) and §6 (generated program shape).
 * These do triple duty: form validation, AI response validation, DB read validation.
 */

export const ExperienceLevel = z.enum(["beginner", "intermediate", "advanced"]);
export const TrainingClass = z.enum(["non_highly_trained", "highly_trained"]);
export const WeightUnit = z.enum(["lbs", "kg"]);
export const Sex = z.enum(["male", "female", "other"]);
export const Division = z.enum(["open", "pro"]);
export const RacePriority = z.enum(["A", "B", "C"]);
export const ProgramType = z.enum(["goal_event", "fixed_duration", "general_fitness"]);
export const TrainingDay = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

/**
 * Target sport for the program (multi-sport expansion). Defaults to "hyrox"
 * for backward compatibility — existing programs and inputs omit it. The engine
 * resolves a SportConfig from this id (see lib/engine/sports).
 */
export const Sport = z.enum([
  "hyrox",
  "deka_fit",
  "deka_mile",
  "deka_strong",
  "deka_atlas",
  "deka_ultra",
  "tri_70_3",
  "tri_140_6",
  "general_fitness",
]);
export type SportId = z.infer<typeof Sport>;

/** General-fitness sub-goal — biases the emphasis rotation (balanced default). */
export const SubGoal = z.enum(["balanced", "recomp", "general_strength", "general_endurance"]);
export type SubGoalKey = z.infer<typeof SubGoal>;

/** Equipment the athlete has available (Tasks #17) — captured for session tailoring. */
export const Equipment = z.enum([
  "barbell",
  "dumbbells",
  "kettlebells",
  "pull_up_bar",
  "bench",
  "squat_rack",
  "rower",
  "ski_erg",
  "assault_bike",
  "sled",
  "wall_ball",
  "sandbag",
  "jump_rope",
  "treadmill",
  "running_outdoor",
  "bodyweight_only",
]);
export type EquipmentKey = z.infer<typeof Equipment>;

// Time/benchmark strings are short ("mm:ss" / "h:mm:ss"). Cap them so a large
// value can't inflate prompt token cost or become a prompt-injection payload —
// several of these are embedded verbatim into the generation prompt.
const TIME_STRING_MAX = 16;

export const BenchmarksSchema = z.object({
  mileTime: z.string().max(TIME_STRING_MAX).optional(),
  fiveKTime: z.string().max(TIME_STRING_MAX).optional(),
  tenKTime: z.string().max(TIME_STRING_MAX).optional(),
  fiveRmSquat: z.number().optional(),
  fiveRmBench: z.number().optional(),
  fiveRmDeadlift: z.number().optional(),
  ski2kTime: z.string().max(TIME_STRING_MAX).optional(),
  row2kTime: z.string().max(TIME_STRING_MAX).optional(),
  bike20MinCals: z.number().optional(),
  /** Triathlon swim anchor: CSS (critical swim speed) pace per 100 m, "mm:ss". */
  cssPace: z.string().max(TIME_STRING_MAX).optional(),
  /** Triathlon bike anchor: FTP (functional threshold power) in watts. */
  ftpWatts: z.number().positive().max(600).optional(),
  /** DEKA ATLAS anchor: max unbroken strict DB shoulder-to-overhead reps at Rx load. */
  ohpEnduranceReps: z.number().int().positive().max(200).optional(),
  /** DEKA ATLAS anchor: benchmark glycolytic couplet time (21-15-9), "mm:ss". */
  glycolyticTestSec: z.string().max(TIME_STRING_MAX).optional(),
});

/**
 * One heart-rate zone's bounds as a percentage of max HR (new-additions #3).
 * `low`/`high` are whole percentages (e.g. 60, 70); high must exceed low.
 */
export const HrZoneBandSchema = z
  .object({
    low: z.number().min(0).max(100),
    high: z.number().min(0).max(100),
  })
  .refine((b) => b.high > b.low, { message: "Zone high % must be greater than low %" });

/** Custom bands for all five zones (Z1…Z5). Optional — omit to use defaults. */
export const HrZonesSchema = z.object({
  z1: HrZoneBandSchema,
  z2: HrZoneBandSchema,
  z3: HrZoneBandSchema,
  z4: HrZoneBandSchema,
  z5: HrZoneBandSchema,
});

/**
 * Preferences for how session types land on the week (new-additions #4).
 * Both optional: `longRunDay` pins the weekly long run to a day; `restDays`
 * are days the athlete would rather keep as full rest when the schedule allows.
 */
export const DayPreferencesSchema = z.object({
  longRunDay: TrainingDay.optional(),
  restDays: z.array(TrainingDay).optional(),
  /** Preferred days for strength / lifting sessions (Tasks #1). */
  liftDays: z.array(TrainingDay).optional(),
  /** Preferred days for hybrid (HYROX) sessions (Tasks #1). */
  hybridDays: z.array(TrainingDay).optional(),
});

export const ProfileSchema = z.object({
  // firstName is embedded verbatim into every generation + adaptation prompt;
  // bound it so it can't be used to amplify token cost or inject instructions.
  firstName: z.string().min(1).max(80),
  age: z.number().int().min(13).max(100),
  bodyWeight: z.number().positive(),
  weightUnit: WeightUnit,
  runningExp: ExperienceLevel,
  hybridExp: ExperienceLevel,
  liftingExp: ExperienceLevel,
  /** Triathlon per-discipline experience — sets the swim/bike volume tier when
   *  provided (else derived from CSS/FTP benchmarks). Optional for other sports. */
  swimExp: ExperienceLevel.optional(),
  bikeExp: ExperienceLevel.optional(),
  trainingClass: TrainingClass,
  trainingDays: z.array(TrainingDay).min(3),
  benchmarks: BenchmarksSchema.optional(),
  /** Optional biological sex — drives the sex-specific max-HR formula (Review #3). */
  sex: Sex.optional(),
  /** Optional tested max HR (bpm). When omitted, a sex-specific age formula is used. */
  maxHr: z.number().int().min(100).max(230).optional(),
  /** Optional resting HR (bpm) — enables %HRR (Karvonen) zones (Review #3). */
  restingHr: z.number().int().min(25).max(120).optional(),
  /** Optional lactate-threshold HR (bpm) — enables %LTHR (Friel) zones (Review #3). */
  thresholdHr: z.number().int().min(90).max(220).optional(),
  /** Target HYROX division (Open/Pro) — drives station race loads (Review #6). */
  division: Division.optional(),
  /** Optional goal HYROX finish time (e.g. "1:15:00") for the pacing plan (Review #6). */
  goalFinishTime: z.string().max(TIME_STRING_MAX).optional(),
  /** Optional custom HR zone bands (% of max HR). When omitted, standard bands. */
  hrZones: HrZonesSchema.optional(),
  /** Optional day-placement preferences (long-run day, preferred rest days). */
  dayPreferences: DayPreferencesSchema.optional(),
  /** Equipment the athlete has available (Tasks #17). Empty/absent = no constraint. */
  equipment: z.array(Equipment).optional(),
  /** How many days per week the athlete CURRENTLY trains (Tasks #17) — a fitness
   *  context signal, distinct from trainingDays (the days they WILL train). */
  currentDaysPerWeek: z.number().int().min(0).max(7).optional(),
});

export const RaceSchema = z.object({
  raceDate: z.string().max(32), // ISO date
  priority: RacePriority,
});

export const GenerationInputSchema = z.object({
  profile: ProfileSchema,
  programType: ProgramType,
  /** Target sport (multi-sport expansion). Omitted → HYROX. */
  sport: Sport.optional(),
  /** General-fitness sub-goal. Omitted → balanced. */
  subGoal: SubGoal.optional(),
  durationWeeks: z.number().int().min(4).max(24).optional(),
  races: z.array(RaceSchema).optional(),
  /** Optional overrides for the engine's experience-derived starting volume. */
  startMileage: z.number().positive().max(200).optional(),
  startCardioMinutes: z.number().positive().max(2000).optional(),
  /** Program start date (ISO yyyy-mm-dd). Defaults to today when omitted. */
  startDate: z.string().max(32).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type HrZoneBand = z.infer<typeof HrZoneBandSchema>;
export type HrZones = z.infer<typeof HrZonesSchema>;
export type DayPreferences = z.infer<typeof DayPreferencesSchema>;
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

/** The engine's run subtypes. Named so `lib/engine/types.ts` can derive its
 *  `RunType` from this single source (roadmap #2.5) instead of re-listing them. */
export const RunType = z.enum([
  "easy",
  "fartlek",
  "progression",
  "long",
  "tempo",
  "threshold",
  "interval",
  "hybrid_run",
]);

export const RunSessionSchema = z.object({
  kind: z.literal("run"),
  runType: RunType,
  durationMin: z.number(),
  paceMinMile: z.string(),
  distanceMiles: z.number(),
  goalZone: z.number().int().min(1).max(5),
  /** 1–2 sentence explanation of the run + how to execute it (Tasks #2).
   *  Attached deterministically during assembly, so it's optional on input. */
  description: z.string().optional(),
});

export const StrengthEmphasis = z.enum(["max_strength", "strength", "endurance"]);

/** A plyometric / reactive-strength element (Review #4) — Base/Build only. */
export const PowerElementSchema = z.object({
  exercise: z.string(),
  sets: z.number().int(),
  reps: z.string(),
  note: z.string().optional(),
});

export const LiftSessionSchema = z.object({
  kind: z.literal("lift"),
  liftType: z.enum(["upper", "lower", "full"]),
  movements: z.array(
    z.object({
      pattern: MovementPattern,
      /** Specific exercise name for this pattern (Tasks #10). Alternates A/B by
       *  week so the athlete isn't repeating identical lifts week after week
       *  (overuse). Set deterministically at assembly; optional for back-compat. */
      exercise: z.string().optional(),
      sets: z.number().int(),
      repRange: z.string(),
      suggestedWeight: z.string().optional(),
      /** Periodized load + autoregulation (Review #4); set deterministically at assembly. */
      intensityPct: z.number().optional(),
      rir: z.number().optional(),
      emphasis: StrengthEmphasis.optional(),
    }),
  ),
  /** Optional plyometric/reactive element (Review #4), added at assembly in Base/Build. */
  power: PowerElementSchema.optional(),
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
  /** True for a Peak full-race simulation (Review #9). */
  simulation: z.boolean().optional(),
});

export const RaceSessionSchema = z.object({
  kind: z.literal("race"),
  priority: RacePriority,
});

/**
 * Non-running Zone 1–2 cardio (bike / row / ski / elliptical), added by the
 * volume reconciler to make a week's total cardio time hit the engine target
 * once the running (sized to the mileage target at fixed paces) is placed.
 * Contributes cardio minutes but no running mileage.
 */
export const CardioSessionSchema = z.object({
  kind: z.literal("cardio"),
  durationMin: z.number(),
  goalZone: z.number().int().min(1).max(5),
  modality: z.string().optional(),
  description: z.string().optional(),
});

/** Triathlon swim session (content templated deterministically from the skeleton). */
export const SwimSessionSchema = z.object({
  kind: z.literal("swim"),
  durationMin: z.number(),
  goalZone: z.number().int().min(1).max(5),
  sessionType: z.enum(["technique", "css", "threshold", "endurance", "open_water"]),
  description: z.string().optional(),
});

/** Triathlon bike session. */
export const BikeSessionSchema = z.object({
  kind: z.literal("bike"),
  durationMin: z.number(),
  goalZone: z.number().int().min(1).max(5),
  sessionType: z.enum(["endurance", "sweet_spot", "threshold", "vo2", "recovery"]),
  isLong: z.boolean().optional(),
  description: z.string().optional(),
});

/** Triathlon brick — ordered bike→run (or other) segments in one session. */
export const BrickSegmentSchema = z.object({
  discipline: z.enum(["bike", "run", "swim"]),
  durationMin: z.number(),
  goalZone: z.number().int().min(1).max(5),
  note: z.string().optional(),
});
export const BrickSessionSchema = z.object({
  kind: z.literal("brick"),
  goalZone: z.number().int().min(1).max(5),
  segments: z.array(BrickSegmentSchema),
  description: z.string().optional(),
});

export const SessionSchema = z.discriminatedUnion("kind", [
  RunSessionSchema,
  LiftSessionSchema,
  HybridSessionSchema,
  RaceSessionSchema,
  CardioSessionSchema,
  SwimSessionSchema,
  BikeSessionSchema,
  BrickSessionSchema,
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

// --- Workout logs (Phase 2 — phase2-spec.md §3a) ---

export const LogStatus = z.enum(["completed", "partial", "skipped"]);

export const LogActualsSchema = z.object({
  durationMin: z.number().positive().max(600).optional(),
  distanceMiles: z.number().positive().max(100).optional(),
  avgHr: z.number().int().min(40).max(230).optional(),
});

/** Body of POST /api/logs — one logged session, upserted by position. */
export const WorkoutLogInputSchema = z
  .object({
    programId: z.string().min(1),
    weekNumber: z.number().int().min(1).max(24),
    day: TrainingDay,
    sessionIndex: z.number().int().min(0).max(9),
    status: LogStatus,
    rpe: z.number().int().min(1).max(10).optional(),
    actuals: LogActualsSchema.optional(),
    note: z.string().max(280).optional(),
    /** Day the session was actually done, when moved off the planned day (#5). */
    actualDay: TrainingDay.optional(),
  })
  .refine((v) => v.status === "skipped" || v.rpe !== undefined, {
    message: "RPE is required unless the session was skipped",
    path: ["rpe"],
  });

/** Body of POST /api/readiness — one weekly readiness check-in (Review #7). */
export const ReadinessCheckinInputSchema = z.object({
  programId: z.string().min(1),
  weekNumber: z.number().int().min(1).max(24),
  sleep: z.number().int().min(1).max(7),
  fatigue: z.number().int().min(1).max(7),
  stress: z.number().int().min(1).max(7),
  soreness: z.number().int().min(1).max(7),
  restingHr: z.number().int().min(25).max(150).optional(),
  hrv: z.number().min(1).max(400).optional(),
});
export type ReadinessCheckinInput = z.infer<typeof ReadinessCheckinInputSchema>;

/** Body of POST /api/daily-metrics — one day's resting HR + HRV (Tasks #7). */
export const DailyMetricInputSchema = z
  .object({
    /** ISO date "YYYY-MM-DD" the reading was taken (usually on waking). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    restingHr: z.number().int().min(25).max(150).optional(),
    hrv: z.number().min(1).max(400).optional(),
  })
  .refine((v) => v.restingHr !== undefined || v.hrv !== undefined, {
    message: "Enter a resting HR and/or HRV",
    path: ["restingHr"],
  });
export type DailyMetricInput = z.infer<typeof DailyMetricInputSchema>;

export type LogActuals = z.infer<typeof LogActualsSchema>;
export type WorkoutLogInput = z.infer<typeof WorkoutLogInputSchema>;

/** Client-side shape of one stored log (subset of the DB row). */
export interface WorkoutLog {
  weekNumber: number;
  day: z.infer<typeof TrainingDay>;
  sessionIndex: number;
  status: z.infer<typeof LogStatus>;
  rpe: number | null;
  actuals: LogActuals | null;
  note: string | null;
  /** Day the session was actually completed when moved off the planned day (#5).
   *  null/absent = done as planned. Planned day/sessionIndex never change. */
  actualDay?: z.infer<typeof TrainingDay> | null;
}

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
