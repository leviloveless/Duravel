import { describe, it, expect } from "vitest";
import { WorkoutLogInputSchema, ReadinessCheckinInputSchema, ProfileSchema } from "./schemas";

/**
 * Contract tests for the request/validation boundary (roadmap #3.3) — these Zod
 * schemas gate every write API, so their refinements and caps are worth pinning.
 */

describe("WorkoutLogInputSchema", () => {
  const base = { programId: "p1", weekNumber: 1, day: "mon" as const, sessionIndex: 0 };

  it("requires an RPE unless the session was skipped", () => {
    expect(WorkoutLogInputSchema.safeParse({ ...base, status: "completed" }).success).toBe(false);
    expect(WorkoutLogInputSchema.safeParse({ ...base, status: "completed", rpe: 7 }).success).toBe(true);
    expect(WorkoutLogInputSchema.safeParse({ ...base, status: "skipped" }).success).toBe(true);
  });

  it("bounds rpe (1–10) and note (≤280)", () => {
    expect(WorkoutLogInputSchema.safeParse({ ...base, status: "completed", rpe: 11 }).success).toBe(false);
    expect(
      WorkoutLogInputSchema.safeParse({ ...base, status: "completed", rpe: 7, note: "x".repeat(281) }).success,
    ).toBe(false);
  });
});

describe("ProfileSchema free-text caps (Tier 0 #0.6)", () => {
  const base = {
    firstName: "A",
    age: 30,
    bodyWeight: 70,
    weightUnit: "lbs" as const,
    runningExp: "intermediate" as const,
    hybridExp: "intermediate" as const,
    liftingExp: "intermediate" as const,
    trainingClass: "non_highly_trained" as const,
    trainingDays: ["mon", "tue", "wed"] as const,
  };

  it("rejects an over-long firstName but accepts a normal one", () => {
    expect(ProfileSchema.safeParse({ ...base, firstName: "x".repeat(81) }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...base, firstName: "Levi" }).success).toBe(true);
  });

  it("caps benchmark time strings at 16 chars", () => {
    expect(ProfileSchema.safeParse({ ...base, benchmarks: { fiveKTime: "x".repeat(17) } }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...base, benchmarks: { fiveKTime: "21:30" } }).success).toBe(true);
  });

  it("requires at least 3 training days", () => {
    expect(ProfileSchema.safeParse({ ...base, trainingDays: ["mon", "tue"] }).success).toBe(false);
  });
});

describe("ReadinessCheckinInputSchema", () => {
  const ok = { programId: "p", weekNumber: 1, sleep: 4, fatigue: 4, stress: 4, soreness: 4 };

  it("accepts valid 1–7 Hooper fields and rejects out-of-range", () => {
    expect(ReadinessCheckinInputSchema.safeParse(ok).success).toBe(true);
    expect(ReadinessCheckinInputSchema.safeParse({ ...ok, sleep: 8 }).success).toBe(false);
    expect(ReadinessCheckinInputSchema.safeParse({ ...ok, soreness: 0 }).success).toBe(false);
  });
});
