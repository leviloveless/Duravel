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

/**
 * Levi's lift-day priority, 2026-08-05:
 *
 *     1 day  -> strength
 *     2 days -> strength, power
 *     3 days -> strength, power, light
 *
 * "light" is a full-body slot that `applyStrengthSchemes` runs at 12-15 reps —
 * only the FIRST full-body day of a week is heavy — so the slot shape here is
 * `full, power, full` and the third comes out light. The alternating shape is
 * also what `separateLiftDays` uses to keep heavy days off consecutive dates.
 */
describe("lift-day priority: strength, then power, then light", () => {
  it("gives one lift day the strength workout", () => {
    expect(researchLiftSplit(1)).toEqual(["full"]);
  });
  it("gives two lift days strength and power", () => {
    expect(researchLiftSplit(2)).toEqual(["full", "power"]);
  });
  it("gives three lift days strength, power and light", () => {
    expect(researchLiftSplit(3)).toEqual(["full", "power", "full"]);
  });
  it("adds further days as more LIGHT volume, never a second power day", () => {
    expect(researchLiftSplit(4)).toEqual(["full", "power", "full", "full"]);
    for (const n of [2, 3, 4, 5]) {
      expect(researchLiftSplit(n).filter((t) => t === "power").length).toBe(1);
    }
  });
  it("is empty for a week with no lift days", () => {
    expect(researchLiftSplit(0)).toEqual([]);
  });
});
