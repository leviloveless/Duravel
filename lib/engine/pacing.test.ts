import { describe, it, expect } from "vitest";
import { computePacingPlan, formatDuration, RACE_STATION_ORDER } from "./pacing";

describe("computePacingPlan", () => {
  it("predicts a finish from benchmarks when no goal is set", () => {
    const p = computePacingPlan({ benchmarks: { fiveKTime: "20:00", ski2kTime: "7:30", row2kTime: "7:20" } });
    expect(p.source).toBe("predicted");
    expect(p.targetFinishSec).toBe(p.predictedFinishSec);
    expect(p.stations).toHaveLength(8);
    // sum of parts equals the finish
    expect(p.runTotalSec + p.stationsTotalSec + p.roxzoneSec).toBe(p.targetFinishSec);
  });

  it("faster runner ⇒ faster run split (individualized)", () => {
    const fast = computePacingPlan({ benchmarks: { fiveKTime: "17:30" } });
    const slow = computePacingPlan({ benchmarks: { fiveKTime: "28:00" } });
    expect(fast.runSplitSecPerKm).toBeLessThan(slow.runSplitSecPerKm);
  });

  it("scales toward a goal finish time", () => {
    const base = computePacingPlan({ benchmarks: { fiveKTime: "22:00" } });
    // goal faster than the ~72:30 prediction ⇒ splits pulled faster toward it
    const goal = computePacingPlan({ benchmarks: { fiveKTime: "22:00" }, goalFinishTime: "1:05:00" });
    expect(goal.source).toBe("goal");
    expect(goal.targetFinishSec).toBeLessThan(base.predictedFinishSec);
    expect(goal.runSplitSecPerKm).toBeLessThan(base.runSplitSecPerKm);
  });

  it("clamps unrealistic goals (never scales below 0.75×)", () => {
    const base = computePacingPlan({ benchmarks: { fiveKTime: "30:00" } });
    const crazy = computePacingPlan({ benchmarks: { fiveKTime: "30:00" }, goalFinishTime: "0:30:00" });
    expect(crazy.runSplitSecPerKm).toBeGreaterThanOrEqual(Math.round(base.runSplitSecPerKm * 0.75) - 1);
  });

  it("Pro division slows the strength stations vs Open", () => {
    const open = computePacingPlan({ benchmarks: { fiveKTime: "22:00" }, division: "open" });
    const pro = computePacingPlan({ benchmarks: { fiveKTime: "22:00" }, division: "pro" });
    const wOpen = open.stations.find((s) => s.id === "wall_balls")!.targetSec;
    const wPro = pro.stations.find((s) => s.id === "wall_balls")!.targetSec;
    expect(wPro).toBeGreaterThan(wOpen);
  });

  it("works with no benchmarks at all (all-reference prediction)", () => {
    const p = computePacingPlan({});
    expect(p.predictedFinishSec).toBeGreaterThan(0);
    expect(p.stations.map((s) => s.id)).toEqual(RACE_STATION_ORDER);
  });

  it("formatDuration renders h:mm:ss and m:ss", () => {
    expect(formatDuration(4500)).toBe("1:15:00");
    expect(formatDuration(245)).toBe("4:05");
  });
});
