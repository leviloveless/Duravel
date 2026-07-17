import { describe, it, expect } from "vitest";
import { analyzeAtlasNeeds, analyzeNeedsForSport } from "./needs-atlas";
import { analyzeNeeds, type NeedsProfile } from "./needs";

function atlasProfile(o: Partial<NeedsProfile["benchmarks"]> = {}, sex: "male" | "female" = "male"): NeedsProfile {
  return {
    bodyWeight: 85,
    weightUnit: "kg",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "advanced",
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    sex,
    benchmarks: {
      fiveRmSquat: 170,
      fiveRmDeadlift: 210,
      fiveRmBench: 130,
      ohpEnduranceReps: 22,
      glycolyticTestSec: "3:00",
      ...o,
    },
  };
}

describe("ATLAS needs analysis", () => {
  it("scores the three ATLAS domains from benchmarks", () => {
    const a = analyzeAtlasNeeds(atlasProfile());
    expect(a.domainScores.strength).not.toBeNull();
    expect(a.domainScores.press_endurance).not.toBeNull();
    expect(a.domainScores.glycolytic).not.toBeNull();
  });

  it("flags a weak overhead-pressing engine as the limiter and emphasizes press stations", () => {
    // Strong strength + fast glycolytic, but very low OHP reps → press_endurance limiter.
    const a = analyzeAtlasNeeds(
      atlasProfile({ fiveRmSquat: 220, fiveRmDeadlift: 270, ohpEnduranceReps: 5, glycolyticTestSec: "2:00" }),
    );
    expect(a.informative).toBe(true);
    expect(a.limiters).toContain("press_endurance");
    expect(a.summary.toLowerCase()).toContain("pressing");
    // Emphasis leads with a pressing station.
    expect(a.bias.stationEmphasis[0]).toBe("db shoulder-to-overhead");
  });

  it("a weak glycolytic engine adds a hybrid session and a specific build", () => {
    const a = analyzeAtlasNeeds(
      atlasProfile({ fiveRmSquat: 220, fiveRmDeadlift: 270, ohpEnduranceReps: 35, glycolyticTestSec: "5:30" }),
    );
    expect(a.limiters).toContain("glycolytic");
    expect(a.bias.hybridCountDelta).toBe(1);
    expect(a.bias.buildWeeksDelta).toBe(1);
    expect(a.bias.baseWeeksDelta).toBe(-1);
  });

  it("absolute-strength limiter biases toward more base", () => {
    // Weak lifts, strong press-endurance + glycolytic.
    const a = analyzeAtlasNeeds(
      atlasProfile({ fiveRmSquat: 90, fiveRmDeadlift: 110, fiveRmBench: 70, ohpEnduranceReps: 38, glycolyticTestSec: "1:50" }),
    );
    expect(a.limiters[0]).toBe("strength");
    expect(a.bias.baseWeeksDelta).toBe(1);
    expect(a.bias.peakWeeksDelta).toBe(-1);
  });

  it("no benchmarks → neutral (non-informative) bias", () => {
    const a = analyzeAtlasNeeds({ ...atlasProfile(), benchmarks: undefined });
    expect(a.informative).toBe(false);
    expect(a.bias.stationEmphasis).toEqual([]);
  });

  it("dispatcher routes ATLAS to the ATLAS analysis and everything else to analyzeNeeds", () => {
    const p = atlasProfile();
    // Non-ATLAS sports get the exact same object analyzeNeeds would produce.
    expect(analyzeNeedsForSport(p, "hyrox")).toEqual(analyzeNeeds(p));
    expect(analyzeNeedsForSport(p, "deka_fit")).toEqual(analyzeNeeds(p));
    // ATLAS uses its own domains.
    const atlas = analyzeNeedsForSport(p, "deka_atlas");
    expect(Object.keys(atlas.domainScores).sort()).toEqual(["glycolytic", "press_endurance", "strength"]);
  });
});
