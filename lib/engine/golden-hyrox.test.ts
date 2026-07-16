/**
 * GOLDEN HYROX ORACLE — the P0 byte-identical gate.
 *
 * The sport-abstraction refactor (making HYROX one `SportConfig` implementation
 * of a sport-parametric engine) must NOT change HYROX output. These snapshots
 * freeze the deterministic skeleton across a broad slice of the engine surface
 * (allocation, microcycle progression, peak drop, tapers, post-B recovery,
 * needs biasing, masters override, general fitness). If any of these snapshots
 * change during the refactor, HYROX behavior drifted — a P0 regression.
 *
 * Generated from the pre-refactor engine. Do not update the snapshots to make a
 * refactor pass; a diff here means the refactor is wrong.
 */
import { describe, it, expect } from "vitest";
import type { EngineInput } from "./types";
import { buildSkeleton } from "./skeleton";
import { analyzeNeeds, type NeedsProfile } from "./needs";

function makeInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "goal_event",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    races: [{ weekNumber: 16, priority: "A" }],
    ...overrides,
  };
}

describe("GOLDEN HYROX — deterministic skeleton must stay byte-identical through P0", () => {
  it("baseline: non-highly-trained, intermediate x3, 16wk, 5d, A@16", () => {
    expect(buildSkeleton(makeInput())).toMatchSnapshot();
  });

  it("highly-trained, advanced run, 20wk, 6d, A@20 + B@10 (multi-race + post-B recovery)", () => {
    expect(
      buildSkeleton(
        makeInput({
          trainingClass: "highly_trained",
          runningExp: "advanced",
          liftingExp: "advanced",
          durationWeeks: 20,
          trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
          races: [
            { weekNumber: 10, priority: "B" },
            { weekNumber: 20, priority: "A" },
          ],
        }),
      ),
    ).toMatchSnapshot();
  });

  it("general fitness (fixed_duration), beginner x3, 12wk, 4d, no races", () => {
    expect(
      buildSkeleton(
        makeInput({
          programType: "general_fitness",
          runningExp: "beginner",
          hybridExp: "beginner",
          liftingExp: "beginner",
          durationWeeks: 12,
          trainingDays: ["mon", "wed", "fri", "sat"],
          races: [],
        }),
      ),
    ).toMatchSnapshot();
  });

  it("masters override: age 55 forces 3-week microcycle, 18wk, A@18", () => {
    expect(
      buildSkeleton(
        makeInput({
          trainingClass: "highly_trained",
          age: 55,
          durationWeeks: 18,
          races: [{ weekNumber: 18, priority: "A" }],
        }),
      ),
    ).toMatchSnapshot();
  });

  it("C race (train-through), fixed_duration, 14wk, C@8 + A@14", () => {
    expect(
      buildSkeleton(
        makeInput({
          durationWeeks: 14,
          trainingDays: ["mon", "tue", "thu", "fri", "sat"],
          races: [
            { weekNumber: 8, priority: "C" },
            { weekNumber: 14, priority: "A" },
          ],
        }),
      ),
    ).toMatchSnapshot();
  });

  it("needs-biased: weak erg engine limiter shifts frequency + station emphasis", () => {
    const profile: NeedsProfile = {
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: "advanced",
      hybridExp: "intermediate",
      liftingExp: "advanced",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
      sex: "male",
      benchmarks: {
        mileTime: "5:40",
        fiveKTime: "19:30",
        tenKTime: "40:30",
        fiveRmSquat: 150,
        fiveRmDeadlift: 190,
        fiveRmBench: 110,
        ski2kTime: "8:30", // deliberately weak erg
        row2kTime: "8:20", // deliberately weak erg
        bike20MinCals: 180,
      },
    };
    const needs = analyzeNeeds(profile);
    expect(
      buildSkeleton(
        makeInput({
          runningExp: "advanced",
          liftingExp: "advanced",
          durationWeeks: 20,
          trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
          races: [{ weekNumber: 20, priority: "A" }],
          needs,
        }),
      ),
    ).toMatchSnapshot();
  });
});
