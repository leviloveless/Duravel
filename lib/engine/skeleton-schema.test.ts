import { describe, it, expect } from "vitest";
import { buildSkeleton, type EngineInput } from "./index";
import { ProgramSkeletonSchema } from "./skeleton-schema";

/**
 * Guards roadmap #0.4: the adaptation path validates the persisted skeleton with
 * ProgramSkeletonSchema. This round-trip keeps that schema in lockstep with the
 * engine's ProgramSkeleton type — if buildSkeleton emits a shape the schema
 * doesn't accept, that's schema drift and this fails.
 */

const baseInput: EngineInput = {
  trainingClass: "highly_trained",
  runningExp: "intermediate",
  hybridExp: "intermediate",
  liftingExp: "intermediate",
  programType: "general_fitness",
  durationWeeks: 12,
  trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
  races: [],
};

describe("ProgramSkeletonSchema", () => {
  it("accepts a freshly built general-fitness skeleton", () => {
    const skel = buildSkeleton(baseInput);
    const parsed = ProgramSkeletonSchema.safeParse(skel);
    expect(parsed.success).toBe(true);
  });

  it("accepts a goal-event skeleton with an A-race (taper + race weeks)", () => {
    const skel = buildSkeleton({
      ...baseInput,
      programType: "goal_event",
      durationWeeks: 16,
      races: [{ weekNumber: 16, priority: "A" }],
    });
    expect(ProgramSkeletonSchema.safeParse(skel).success).toBe(true);
  });

  it("rejects structurally invalid input", () => {
    expect(ProgramSkeletonSchema.safeParse({ durationWeeks: 12 }).success).toBe(false);
    expect(ProgramSkeletonSchema.safeParse(null).success).toBe(false);
  });
});
