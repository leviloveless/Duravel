import { describe, it, expect } from "vitest";
import { assembleArgsFromInput } from "./assemble";
import type { GenerationInput } from "@/lib/schemas";

/**
 * Guards the adaptation regression (roadmap #0.1): the per-week refill must
 * reuse the SAME individualization args as the initial generation. The bug was
 * passing only runningExp + 5K time, which silently reverted VDOT paces, working
 * weights, and division/sex station loads on any adapted week.
 */

const female: GenerationInput = {
  profile: {
    firstName: "Ada",
    age: 34,
    bodyWeight: 62,
    weightUnit: "kg",
    runningExp: "advanced",
    hybridExp: "intermediate",
    liftingExp: "advanced",
    trainingClass: "highly_trained",
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    sex: "female",
    division: "pro",
    benchmarks: {
      mileTime: "6:10",
      fiveKTime: "21:00",
      tenKTime: "44:00",
      fiveRmSquat: 100,
      fiveRmDeadlift: 120,
      fiveRmBench: 55,
    },
  },
  programType: "general_fitness",
};

describe("assembleArgsFromInput", () => {
  it("threads full VDOT inputs, strength benchmarks, unit, division and sex", () => {
    const a = assembleArgsFromInput(female);
    expect(a.raceTimes).toEqual({ mileTime: "6:10", fiveKTime: "21:00", tenKTime: "44:00" });
    expect(a.benchmarks).toEqual({ fiveRmSquat: 100, fiveRmDeadlift: 120, fiveRmBench: 55 });
    expect(a.weightUnit).toBe("kg");
    expect(a.division).toBe("pro");
    expect(a.sex).toBe("female");
    expect(a.runningExp).toBe("advanced");
  });

  it("defaults division to open and sex to male when unset", () => {
    const minimal: GenerationInput = {
      profile: { ...female.profile, sex: undefined, division: undefined, benchmarks: undefined },
      programType: "general_fitness",
    };
    const a = assembleArgsFromInput(minimal);
    expect(a.division).toBe("open");
    expect(a.sex).toBe("male");
    expect(a.raceTimes).toEqual({ mileTime: undefined, fiveKTime: undefined, tenKTime: undefined });
  });

  it("maps sex 'other' to the male station anchor (not female)", () => {
    const other: GenerationInput = {
      profile: { ...female.profile, sex: "other" },
      programType: "general_fitness",
    };
    expect(assembleArgsFromInput(other).sex).toBe("male");
  });
});
