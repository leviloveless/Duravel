import { describe, it, expect } from "vitest";
import {
  movementScheme,
  patternEmphasis,
  suggestedWeight,
  benchmarkForPattern,
  powerElementFor,
} from "./strength";

describe("patternEmphasis / movementScheme", () => {
  it("full-body compounds are heavy low-rep max strength", () => {
    expect(patternEmphasis("squat", "full")).toBe("max_strength");
    const s = movementScheme("squat", "full", "base", "rebound");
    expect(s).toMatchObject({ sets: 4, repRange: "5-6", intensityPct: 78, rir: 3, emphasis: "max_strength" });
  });

  it("peak full-body is heaviest and lowest-rep", () => {
    const s = movementScheme("squat", "full", "peak", "rebound");
    expect(s.repRange).toBe("3");
    expect(s.intensityPct).toBe(88);
    expect(s.rir).toBe(1);
  });

  it("upper/lower compounds are MODERATE strength, not hypertrophy 12–15", () => {
    const s = movementScheme("horizontal_press", "upper", "base", "rebound");
    expect(s.emphasis).toBe("strength");
    expect(s.repRange).toBe("8-10"); // was a flat 12-15 before
    expect(s.intensityPct).toBe(70);
  });

  it("the lunge is high-rep HYROX muscular endurance regardless of session", () => {
    expect(patternEmphasis("lunge", "lower")).toBe("endurance");
    expect(movementScheme("lunge", "lower", "peak", "rebound").repRange).toBe("20");
  });

  it("load progresses across the microcycle (increase > rebound > deload)", () => {
    const inc = movementScheme("squat", "full", "base", "increase").intensityPct;
    const reb = movementScheme("squat", "full", "base", "rebound").intensityPct;
    const del = movementScheme("squat", "full", "base", "deload").intensityPct;
    expect(inc).toBeGreaterThan(reb);
    expect(reb).toBeGreaterThan(del);
    expect(inc).toBe(80);
    expect(del).toBe(72);
  });

  it("intensity is capped so autoregulation stays safe", () => {
    // peak max-strength 88 + increase 2 = 90 (at cap, not above)
    expect(movementScheme("squat", "full", "peak", "increase").intensityPct).toBe(90);
  });
});

describe("suggestedWeight", () => {
  it("maps a 5RM benchmark to a working weight at the scheme intensity", () => {
    const s = movementScheme("squat", "full", "base", "rebound"); // 78%
    const w = suggestedWeight(s, "squat", { fiveRmSquat: 315 }, "lbs");
    // est 1RM = 315*1.1667 ≈ 367.5; 78% ≈ 286.6 → round5 285
    expect(w).toContain("285 lbs");
    expect(w).toContain("78% 1RM");
    expect(w).toContain("3 RIR");
  });

  it("falls back to a %1RM + RIR cue with no benchmark", () => {
    const s = movementScheme("vertical_press", "upper", "build", "rebound");
    const w = suggestedWeight(s, "vertical_press");
    expect(w).toBe(`~${s.intensityPct}% 1RM · ${s.rir} RIR`);
  });

  it("benchmarkForPattern only maps squat/hinge/horizontal_press", () => {
    const b = { fiveRmSquat: 300, fiveRmDeadlift: 400, fiveRmBench: 200 };
    expect(benchmarkForPattern("squat", b)).toBe(300);
    expect(benchmarkForPattern("hip_hinge", b)).toBe(400);
    expect(benchmarkForPattern("horizontal_press", b)).toBe(200);
    expect(benchmarkForPattern("lunge", b)).toBeUndefined();
    expect(benchmarkForPattern("vertical_pull", b)).toBeUndefined();
  });
});

describe("powerElementFor (plyometrics)", () => {
  it("adds a plyometric element in Base and Build only", () => {
    expect(powerElementFor("base", "rebound", 0)).toMatchObject({ sets: 4, reps: "3" });
    expect(powerElementFor("build", "increase", 0)).toMatchObject({ sets: 5, reps: "3" });
  });
  it("none in Peak/Taper or on deload/taper weeks", () => {
    expect(powerElementFor("peak", "rebound", 0)).toBeNull();
    expect(powerElementFor("taper", "taper", 0)).toBeNull();
    expect(powerElementFor("base", "deload", 0)).toBeNull();
  });
  it("rotates the exercise across a week's lift sessions", () => {
    const a = powerElementFor("base", "rebound", 0)!.exercise;
    const b = powerElementFor("base", "rebound", 1)!.exercise;
    expect(a).not.toBe(b);
  });
});
