/**
 * Runtime (Zod) schema for the engine's ProgramSkeleton (see ./types.ts).
 *
 * The skeleton is engine-owned structure that is persisted on the program row
 * and later read back by the weekly-adaptation path. This schema lets that read
 * VALIDATE the stored JSON instead of trusting a raw `as ProgramSkeleton` cast,
 * so schema drift or corruption fails cleanly (500) rather than flowing into the
 * adaptation math and the mini-refill. It is kept in lockstep with types.ts by a
 * round-trip test (skeleton-schema.test.ts) that parses a freshly built skeleton.
 */
import { z } from "zod";
import { MicroWeek, Phase, RacePriority, TrainingDay } from "@/lib/schemas";
import type { ProgramSkeleton } from "./types";

const RunTypeSchema = z.enum([
  "easy",
  "fartlek",
  "progression",
  "long",
  "tempo",
  "threshold",
  "interval",
  "hybrid_run",
]);

const ZoneDistributionSchema = z.object({
  z1: z.number(),
  z2: z.number(),
  z3: z.number(),
  z4: z.number(),
  z5: z.number(),
});

const SessionSlotSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("run"),
    runType: RunTypeSchema,
    goalZone: z.number(),
    isLong: z.boolean().optional(),
    durationMin: z.number().optional(),
  }),
  z.object({ kind: z.literal("lift"), liftType: z.enum(["upper", "lower", "full"]) }),
  z.object({
    kind: z.literal("hybrid"),
    goalZone: z.number(),
    simulation: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("rest") }),
  z.object({ kind: z.literal("race"), priority: RacePriority }),
  z.object({
    kind: z.literal("swim"),
    goalZone: z.number(),
    durationMin: z.number(),
    sessionType: z.enum(["technique", "css", "threshold", "endurance", "open_water"]),
  }),
  z.object({
    kind: z.literal("bike"),
    goalZone: z.number(),
    durationMin: z.number(),
    isLong: z.boolean().optional(),
    sessionType: z.enum(["endurance", "sweet_spot", "threshold", "vo2", "recovery"]),
  }),
  z.object({
    kind: z.literal("brick"),
    goalZone: z.number(),
    segments: z.array(
      z.object({
        discipline: z.enum(["bike", "run", "swim"]),
        durationMin: z.number(),
        goalZone: z.number(),
      }),
    ),
  }),
]);

const DaySlotSchema = z.object({
  day: TrainingDay,
  sessions: z.array(SessionSlotSchema),
});

const WeekSkeletonSchema = z.object({
  weekNumber: z.number().int(),
  phase: Phase,
  microWeek: MicroWeek,
  targetMileage: z.number(),
  targetCardioMinutes: z.number(),
  zoneTargets: ZoneDistributionSchema,
  days: z.array(DaySlotSchema),
  raceDay: z.object({ priority: RacePriority, date: z.string().optional() }).optional(),
  emphasis: z.string().optional(),
});

export const ProgramSkeletonSchema = z.object({
  durationWeeks: z.number().int(),
  trainingClass: z.enum(["non_highly_trained", "highly_trained"]),
  allocation: z.object({
    base: z.number(),
    build: z.number(),
    peak: z.number(),
    taper: z.number(),
  }),
  weeks: z.array(WeekSkeletonSchema),
  // `needs` is UI/audit metadata that the adaptation path does not consume, so
  // it is accepted structurally without re-validating the full NeedsAnalysis
  // shape — keeping this schema decoupled from that module's internals.
  needs: z.custom<ProgramSkeleton["needs"]>().optional(),
});

// Compile-time guarantee that the schema stays assignable to the engine type.
export type ProgramSkeletonParsed = z.infer<typeof ProgramSkeletonSchema>;
const _typecheck: ProgramSkeleton = {} as ProgramSkeletonParsed;
void _typecheck;
