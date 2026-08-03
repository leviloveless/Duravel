import { describe, it, expect } from "vitest";
import { AiChunkSchema, ProgramDataSchema, LiftSessionSchema } from "@/lib/schemas";

/**
 * Regression: generation used to die with
 *   "Schema validation failed: weeks.0.days.2.sessions.1.movements.0.sets —
 *    Invalid input: expected number, received undefined"
 *
 * The generator prompt tells the model "the engine sets sets/reps/intensity/RIR
 * deterministically — just choose which patterns go in each session", and
 * `applyStrengthSchemes` does overwrite both during assembly. But the AI response
 * was validated against a schema that REQUIRED `sets` and `repRange`, so a model
 * that followed the prompt killed the whole program generation.
 */

const liftMovement = (extra: Record<string, unknown> = {}) => ({
  pattern: "squat",
  ...extra,
});

const chunkWithLift = (movement: Record<string, unknown>) => ({
  weeks: [
    {
      weekNumber: 1,
      days: [
        {
          day: "wed",
          sessions: [
            { kind: "hybrid", goalZone: 4, elements: [{ exercise: "ski erg", prescription: "600m" }] },
            { kind: "lift", liftType: "full", movements: [movement] },
          ],
        },
      ],
    },
  ],
});

describe("AI lift movements: sets/repRange are engine-owned, not required of the model", () => {
  it("accepts a movement with NO sets and NO repRange (the reported failure)", () => {
    const parsed = AiChunkSchema.safeParse(chunkWithLift(liftMovement()));
    expect(parsed.success).toBe(true);
  });

  it("fills concrete numbers so downstream code always sees them", () => {
    const parsed = AiChunkSchema.parse(chunkWithLift(liftMovement()));
    const lift = parsed.weeks[0]!.days[0]!.sessions[1]!;
    expect(lift.kind).toBe("lift");
    if (lift.kind === "lift") {
      expect(typeof lift.movements[0]!.sets).toBe("number");
      expect(typeof lift.movements[0]!.repRange).toBe("string");
    }
  });

  it("still honours values the model DOES supply", () => {
    const parsed = AiChunkSchema.parse(chunkWithLift(liftMovement({ sets: 5, repRange: "3-5" })));
    const lift = parsed.weeks[0]!.days[0]!.sessions[1]!;
    if (lift.kind === "lift") {
      expect(lift.movements[0]!.sets).toBe(5);
      expect(lift.movements[0]!.repRange).toBe("3-5");
    }
  });

  it("an assembled program still validates with concrete sets", () => {
    const lift = LiftSessionSchema.parse({
      kind: "lift",
      liftType: "full",
      movements: [{ pattern: "squat" }],
    });
    const program = ProgramDataSchema.safeParse({
      generatedAt: new Date(0).toISOString(),
      weeks: [
        {
          weekNumber: 1,
          phase: "base",
          microWeek: "rebound",
          summary: { totalCardioMinutes: 0, totalMileage: 0, zoneDistribution: { z1: 20, z2: 60, z3: 10, z4: 5, z5: 5 } },
          days: [{ day: "mon", sessions: [lift] }],
        },
      ],
    });
    expect(program.success).toBe(true);
  });

  it("a genuinely malformed movement is still rejected", () => {
    const bad = AiChunkSchema.safeParse(chunkWithLift({ pattern: "not_a_real_pattern" }));
    expect(bad.success).toBe(false);
  });
});
