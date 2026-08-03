import { describe, it, expect } from "vitest";
import { capExperience, trainingCaps, DEFAULT_CAPS } from "./caps";
import type { ExperienceLevel } from "./types";

const exp = (
  runningExp: ExperienceLevel,
  hybridExp?: ExperienceLevel,
  liftingExp?: ExperienceLevel,
) => ({ runningExp, hybridExp, liftingExp });

describe("capExperience — which level the caps key off", () => {
  it("HYROX / DEKA use running experience, ignoring the others", () => {
    expect(capExperience("station_hybrid", exp("beginner", "advanced", "advanced"))).toBe("beginner");
    expect(capExperience("station_hybrid", exp("advanced", "beginner", "beginner"))).toBe("advanced");
  });

  it("triathlon uses the LOWEST of the three", () => {
    expect(capExperience("triathlon", exp("advanced", "intermediate", "beginner"))).toBe("beginner");
    expect(capExperience("triathlon", exp("advanced", "advanced", "intermediate"))).toBe("intermediate");
    expect(capExperience("triathlon", exp("advanced", "advanced", "advanced"))).toBe("advanced");
  });

  it("general fitness follows the triathlon rule — it is mixed-modality too", () => {
    expect(capExperience("general_fitness", exp("advanced", "beginner", "advanced"))).toBe("beginner");
  });

  it("falls back to running experience when the others are missing", () => {
    expect(capExperience("triathlon", exp("intermediate"))).toBe("intermediate");
  });
});

describe("trainingCaps", () => {
  it("maps each level to its session and day cap", () => {
    expect(trainingCaps("station_hybrid", exp("beginner"))).toEqual({ session: 90, day: 180 });
    expect(trainingCaps("station_hybrid", exp("intermediate"))).toEqual({ session: 105, day: 210 });
    expect(trainingCaps("station_hybrid", exp("advanced"))).toEqual({ session: 120, day: 240 });
  });

  it("the day cap is exactly two capped sessions in every tier", () => {
    for (const level of ["beginner", "intermediate", "advanced"] as const) {
      const c = trainingCaps("station_hybrid", exp(level));
      expect(c.day).toBe(c.session * 2);
    }
  });

  it("defaults to the most conservative tier", () => {
    expect(DEFAULT_CAPS).toEqual({ session: 90, day: 180 });
  });

  it("the athlete's own profile: HYROX + beginner runner → 90 / 180 despite advanced lifting", () => {
    expect(trainingCaps("station_hybrid", exp("beginner", "intermediate", "advanced"))).toEqual({
      session: 90,
      day: 180,
    });
  });
});

describe("caps reach the skeleton through the real generation path", () => {
  it("a HYROX beginner runner gets the 90/180 tier regardless of lifting experience", async () => {
    const { toEngineInput } = await import("./skeleton");
    const engineInput = toEngineInput({
      sport: "hyrox",
      programType: "fixed_duration",
      durationWeeks: 8,
      profile: {
        trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        runningExp: "beginner",
        hybridExp: "intermediate",
        liftingExp: "advanced",
        trainingClass: "non_highly_trained",
        weightUnit: "lbs",
      },
    } as never);
    expect(engineInput.caps).toEqual({ session: 90, day: 180 });
  });

  it("a triathlete takes the lowest of the three", async () => {
    const { toEngineInput } = await import("./skeleton");
    const engineInput = toEngineInput({
      sport: "tri_70_3",
      programType: "fixed_duration",
      durationWeeks: 8,
      profile: {
        trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        runningExp: "advanced",
        hybridExp: "advanced",
        liftingExp: "beginner",
        trainingClass: "non_highly_trained",
        weightUnit: "lbs",
      },
    } as never);
    expect(engineInput.caps).toEqual({ session: 90, day: 180 });
  });
});
