import { describe, it, expect } from "vitest";
import { microcyclePattern, buildSkeleton, type EngineInput } from "./index";

describe("masters deload frequency (Review #10)", () => {
  it("microcyclePattern: masters use the 3-week (2:1) pattern regardless of class", () => {
    expect(microcyclePattern("highly_trained", 55)).toEqual(["rebound", "increase", "deload"]);
    expect(microcyclePattern("highly_trained", 30)).toEqual(["rebound", "increase", "increase", "deload"]);
    expect(microcyclePattern("non_highly_trained", 55)).toEqual(["rebound", "increase", "deload"]);
  });

  const engine = (age: number): EngineInput => ({
    trainingClass: "highly_trained",
    age,
    runningExp: "advanced",
    hybridExp: "advanced",
    liftingExp: "advanced",
    programType: "general_fitness",
    durationWeeks: 12,
    trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    races: [],
  });

  it("a masters athlete gets more deload weeks than a younger one", () => {
    const deloads = (input: EngineInput) =>
      buildSkeleton(input).weeks.filter((w) => w.microWeek === "deload").length;
    expect(deloads(engine(55))).toBeGreaterThan(deloads(engine(30)));
  });
});
