import { describe, it, expect } from "vitest";
import { powerElementFor, patternEmphasis } from "./strength";
import { researchLiftSplit } from "./slots";

/**
 * Research strength dose (Batch 2): a dedicated power-focus session keeps its
 * plyometric element through Peak and Taper (forced), while the legacy behavior
 * — plyometrics in Base/Build only — is preserved for normal lift days.
 */
describe("power-focus strength session", () => {
  it("keeps a plyometric element through Peak and Taper when forced", () => {
    expect(powerElementFor("peak", "increase", 0, true)).not.toBeNull();
    expect(powerElementFor("taper", "taper", 0, true)).not.toBeNull();
  });

  it("legacy (non-forced) still restricts plyometrics to Base/Build", () => {
    expect(powerElementFor("base", "increase", 0)).not.toBeNull();
    expect(powerElementFor("peak", "increase", 0)).toBeNull();
    expect(powerElementFor("taper", "taper", 0)).toBeNull();
  });

  it("never adds plyometrics on recovery weeks (deload/race), even forced", () => {
    expect(powerElementFor("base", "deload", 0, true)).toBeNull();
    expect(powerElementFor("peak", "race", 0, true)).toBeNull();
  });

  /**
   * Rewritten 2026-08-05. This previously asserted `max_strength` — which is
   * precisely how the power day became a duplicate of the heavy full-body day,
   * only harder (6 x 4-5 @ 85% 1RM, 24 working sets). Power is its own emphasis
   * now: submaximal load, 2-3 reps, full recovery, governed by bar speed.
   * See lib/engine/power-session.test.ts for the rest of the behaviour.
   */
  it("treats a power lift as POWER — not as another max-strength day", () => {
    expect(patternEmphasis("squat", "power")).toBe("power");
    expect(patternEmphasis("squat", "full")).toBe("max_strength");
    expect(patternEmphasis("squat", "upper")).toBe("strength");
  });
});

describe("research lift split (max 2 heavy days/week)", () => {
  it("distributes heavy/power with heavy capped at 2", () => {
    expect(researchLiftSplit(1)).toEqual(["full"]);
    expect(researchLiftSplit(2)).toEqual(["full", "power"]);
    expect(researchLiftSplit(3)).toEqual(["full", "power", "full"]); // 2 heavy, 1 power
    expect(researchLiftSplit(4)).toEqual(["full", "power", "full", "power"]); // 2 heavy, 2 power
  });
  it("never programs more than 2 heavy days", () => {
    for (const n of [1, 2, 3, 4]) {
      expect(researchLiftSplit(n).filter((t) => t === "full").length).toBeLessThanOrEqual(2);
    }
  });
});
