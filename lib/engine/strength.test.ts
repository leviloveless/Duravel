import { describe, it, expect } from "vitest";
import {
  movementScheme,
  patternEmphasis,
  suggestedWeight,
  benchmarkForPattern,
  powerElementFor,
  weeklySetTarget,
  splitWeeklySets,
  MAX_SESSION_SETS_PER_PATTERN,
  WEEKLY_SETS_PER_PATTERN,
} from "./strength";

describe("patternEmphasis / movementScheme", () => {
  it("full-body compounds are heavy low-rep max strength", () => {
    expect(patternEmphasis("squat", "full")).toBe("max_strength");
    const s = movementScheme("squat", "full", "base", "rebound");
    expect(s).toMatchObject({
      sets: 4,
      repRange: "5-6",
      intensityPct: 78,
      rir: 3,
      emphasis: "max_strength",
    });
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

describe("weekly working-set volume (Levi 2026-08-04)", () => {
  it("targets 6 / 8 / 10 sets per pattern per week by lifting experience", () => {
    expect(WEEKLY_SETS_PER_PATTERN).toEqual({ beginner: 6, intermediate: 8, advanced: 10 });
    expect(weeklySetTarget("beginner", "increase")).toBe(6);
    expect(weeklySetTarget("intermediate", "increase")).toBe(8);
    expect(weeklySetTarget("advanced", "increase")).toBe(10);
    expect(weeklySetTarget("intermediate", "rebound")).toBe(8);
  });

  it("scales the target down on deload, taper and race weeks", () => {
    const work = weeklySetTarget("advanced", "increase");
    expect(weeklySetTarget("advanced", "deload")).toBeLessThan(work);
    expect(weeklySetTarget("advanced", "taper")).toBeLessThan(
      weeklySetTarget("advanced", "deload"),
    );
    expect(weeklySetTarget("advanced", "race")).toBeLessThan(work);
    expect(weeklySetTarget("beginner", "taper")).toBeGreaterThanOrEqual(1);
  });

  it("splits the weekly target across sessions, remainder to the earlier ones", () => {
    expect(splitWeeklySets(8, 2)).toEqual([4, 4]);
    expect(splitWeeklySets(8, 3)).toEqual([3, 3, 2]);
    expect(splitWeeklySets(10, 3)).toEqual([4, 3, 3]);
    expect(splitWeeklySets(6, 4)).toEqual([2, 2, 1, 1]);
    expect(splitWeeklySets(8, 0)).toEqual([]);
  });

  it("caps one session at MAX_SESSION_SETS_PER_PATTERN, spilling to sessions with headroom", () => {
    // A pattern trained ONCE cannot receive its whole weekly target: an advanced
    // athlete's 10 sets on a single day is 25+ minutes of one movement.
    expect(MAX_SESSION_SETS_PER_PATTERN).toBe(6);
    expect(splitWeeklySets(8, 1)).toEqual([6]); // week lands 2 short, deliberately
    expect(splitWeeklySets(10, 1)).toEqual([6]);
    expect(splitWeeklySets(6, 1)).toEqual([6]); // beginner still hits target on one day
    // Two sessions: the split is already under the cap, so nothing is lost.
    expect(splitWeeklySets(10, 2)).toEqual([5, 5]);
    // An explicit cap that binds spills the surplus onto the session with headroom
    // before dropping any of it.
    expect(splitWeeklySets(10, 2, 6)).toEqual([5, 5]);
    expect(splitWeeklySets(11, 2, 6)).toEqual([6, 5]);
    expect(splitWeeklySets(20, 2, 6)).toEqual([6, 6]); // nowhere left — 8 sets dropped
  });

  it("never returns a zero-set session, and never exceeds the per-session cap", () => {
    for (const n of [1, 2, 3, 5, 7, 9]) {
      for (const target of [1, 4, 6, 8, 10]) {
        const split = splitWeeklySets(target, n);
        expect(split).toHaveLength(n);
        for (const s of split) {
          expect(s).toBeGreaterThanOrEqual(1);
          expect(s).toBeLessThanOrEqual(MAX_SESSION_SETS_PER_PATTERN);
        }
        // The weekly target is met exactly whenever the sessions can hold it —
        // it is only ever missed because the cap ran out of room, never by
        // arithmetic.
        const capacity = n * MAX_SESSION_SETS_PER_PATTERN;
        if (target >= n && target <= capacity) {
          expect(split.reduce((a, b) => a + b, 0)).toBe(target);
        }
      }
    }
  });
});

describe("the light full-body scheme", () => {
  it("drops the later full-body day to 12-15 reps at a submaximal load", () => {
    const heavy = movementScheme("squat", "full", "base", "increase");
    const light = movementScheme("squat", "full", "base", "increase", true);
    expect(heavy.repRange).not.toBe("12-15");
    expect(light.repRange).toBe("12-15");
    expect(light.intensityPct).toBeLessThan(heavy.intensityPct);
    expect(light.rir).toBeGreaterThanOrEqual(heavy.rir);
    expect(light.emphasis).toBe("endurance");
  });

  it("applies to every pattern on that day, in every phase", () => {
    for (const phase of ["base", "build", "peak", "taper"] as const)
      for (const pattern of ["squat", "hip_hinge", "horizontal_press", "vertical_pull"] as const) {
        const light = movementScheme(pattern, "full", phase, "increase", true);
        expect(light.repRange, `${phase} ${pattern}`).toBe("12-15");
      }
    expect(patternEmphasis("horizontal_press", "full", true)).toBe("endurance");
  });
});
