import { describe, it, expect } from "vitest";
import type { EngineInput } from "./types";
import type { WeeklyHoursBand } from "@/lib/schemas";
import { buildSkeleton } from "./skeleton";

const BANDS: WeeklyHoursBand[] = ["h0_5", "h5_10", "h10_20", "h20_30", "h30_40"];

function hyroxInput(band: WeeklyHoursBand): EngineInput {
  return {
    sport: "hyrox",
    weeklyHours: band,
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    races: [{ weekNumber: 16, priority: "A" }],
  };
}
function triInput(band: WeeklyHoursBand): EngineInput {
  return {
    sport: "tri_70_3",
    weeklyHours: band,
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    swimLevel: "intermediate",
    bikeLevel: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    races: [{ weekNumber: 16, priority: "A" }],
  };
}
function dekaFitInput(band: WeeklyHoursBand): EngineInput {
  return {
    sport: "deka_fit",
    weeklyHours: band,
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    races: [{ weekNumber: 16, priority: "A" }],
  };
}

describe("time-budget skeletons (band-driven; snapshots auto-created on first run)", () => {
  for (const band of BANDS) {
    it(`HYROX @ ${band}`, () => {
      expect(buildSkeleton(hyroxInput(band))).toMatchSnapshot();
    });
    it(`70.3 @ ${band}`, () => {
      expect(buildSkeleton(triInput(band))).toMatchSnapshot();
    });
    it(`DEKA FIT @ ${band}`, () => {
      expect(buildSkeleton(dekaFitInput(band))).toMatchSnapshot();
    });
  }

  it("higher budget yields more peak volume (HYROX cardio minutes)", () => {
    const peak = (b: WeeklyHoursBand) =>
      Math.max(...buildSkeleton(hyroxInput(b)).weeks.map((w) => w.targetCardioMinutes));
    expect(peak("h20_30")).toBeGreaterThan(peak("h5_10"));
    expect(peak("h5_10")).toBeGreaterThan(peak("h0_5"));
  });

  it("higher budget yields more peak volume (70.3 cardio minutes)", () => {
    const peak = (b: WeeklyHoursBand) =>
      Math.max(...buildSkeleton(triInput(b)).weeks.map((w) => w.targetCardioMinutes));
    expect(peak("h20_30")).toBeGreaterThan(peak("h5_10"));
    expect(peak("h5_10")).toBeGreaterThan(peak("h0_5"));
  });
});
