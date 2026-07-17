import { describe, it, expect } from "vitest";
import type { EngineInput } from "../types";
import { buildSkeleton } from "../skeleton";
import { getSport } from "./index";
import { general_fitness } from "./general-fitness";

function gfInput(o: Partial<EngineInput> = {}): EngineInput {
  return {
    sport: "general_fitness",
    trainingClass: "non_highly_trained",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    programType: "general_fitness",
    durationWeeks: 16,
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    races: [],
    ...o,
  };
}
function countKind(skel: ReturnType<typeof buildSkeleton>, kind: string): number {
  let n = 0;
  for (const w of skel.weeks) for (const d of w.days) for (const s of d.sessions) if (s.kind === kind) n++;
  return n;
}

describe("General Fitness", () => {
  it("resolves and is a general_fitness ProgramType", () => {
    expect(getSport("general_fitness")).toBe(general_fitness);
    expect(general_fitness.programType).toBe("general_fitness");
    expect(general_fitness.family).toBe("general_fitness");
  });

  it("builds a rotating skeleton: no taper, no race, emphasis on every week", () => {
    const skel = buildSkeleton(gfInput());
    expect(skel.weeks).toHaveLength(16);
    expect(skel.allocation.taper).toBe(0);
    for (const w of skel.weeks) {
      expect(w.microWeek).not.toBe("taper");
      expect(w.microWeek).not.toBe("race");
      expect(["aerobic", "mixed", "strength"]).toContain(w.emphasis);
      expect(w.raceDay).toBeUndefined();
    }
  });

  it("has runs + lifts but NO hybrid/station sessions", () => {
    const skel = buildSkeleton(gfInput());
    expect(countKind(skel, "hybrid")).toBe(0);
    expect(countKind(skel, "run")).toBeGreaterThan(0);
    expect(countKind(skel, "lift")).toBeGreaterThan(0);
  });

  it("balanced rotation cycles aerobic → strength → mixed in ~4-week blocks", () => {
    const skel = buildSkeleton(gfInput());
    expect(skel.weeks[0]!.emphasis).toBe("aerobic");
    expect(skel.weeks[4]!.emphasis).toBe("strength");
    expect(skel.weeks[8]!.emphasis).toBe("mixed");
    expect(skel.weeks[12]!.emphasis).toBe("aerobic");
  });

  it("sub-goal changes the rotation (general_strength leads with a strength block)", () => {
    const skel = buildSkeleton(gfInput({ subGoal: "general_strength" }));
    expect(skel.weeks[0]!.emphasis).toBe("strength");
    const endurance = buildSkeleton(gfInput({ subGoal: "general_endurance" }));
    expect(endurance.weeks[0]!.emphasis).toBe("aerobic");
  });

  it("volume rises across blocks (continuous progression, no taper reset)", () => {
    const skel = buildSkeleton(gfInput({ durationWeeks: 20 }));
    const firstIncrease = skel.weeks.find((w) => w.microWeek === "increase")!;
    const lastIncrease = [...skel.weeks].reverse().find((w) => w.microWeek === "increase")!;
    expect(lastIncrease.targetCardioMinutes).toBeGreaterThan(firstIncrease.targetCardioMinutes);
  });
});
