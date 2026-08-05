/**
 * The POWER / explosive lift day (Levi, 2026-08-05).
 *
 * Before this existed a `power` day was routed into `MAX_STRENGTH` and came out
 * as the hardest session of the week: 6 x 4-5 @ 85% 1RM with 2 RIR across four
 * patterns, 24 working sets, plus an 18-rep reverse lunge. These tests pin the
 * properties that make it a power session rather than a second heavy day.
 */
import { describe, it, expect } from "vitest";
import {
  movementScheme,
  acceptsPattern,
  pickExercise,
  suggestedWeight,
  POWER_PATTERNS,
  POWER_EXERCISE,
  MAX_POWER_SESSION_SETS,
  MAX_SESSION_WORKING_SETS,
  capSessionWorkingSets,
  ensurePowerSessionPatterns,
  type LiftPattern,
} from "./strength";
import type { PhaseName } from "./types";

const PHASES: PhaseName[] = ["base", "build", "peak", "taper"];

describe("the power scheme is not a heavy scheme", () => {
  it("never prescribes more than 3 reps", () => {
    for (const phase of PHASES) {
      const s = movementScheme("squat", "power", phase, "rebound");
      expect(Number(s.repRange)).toBeLessThanOrEqual(3);
    }
  });

  it("stays submaximal in every phase — above ~2/3 1RM it stops being ballistic", () => {
    for (const phase of PHASES) {
      const s = movementScheme("squat", "power", phase, "increase");
      expect(s.intensityPct).toBeLessThanOrEqual(67);
    }
  });

  it("is always lighter than the heavy full-body day in the same phase", () => {
    for (const phase of PHASES) {
      const power = movementScheme("squat", "power", phase, "rebound");
      const heavy = movementScheme("squat", "full", phase, "rebound");
      expect(power.intensityPct).toBeLessThan(heavy.intensityPct);
    }
  });

  it("never runs near failure", () => {
    for (const phase of PHASES) {
      expect(movementScheme("squat", "power", phase, "rebound").rir).toBeGreaterThanOrEqual(4);
    }
  });

  it("carries the power emphasis, including for the lunge", () => {
    // The lunge is HYROX's endurance pattern everywhere ELSE. On a power day it
    // is a split-squat jump, so the endurance override must not win here.
    expect(movementScheme("lunge", "power", "build", "rebound").emphasis).toBe("power");
    expect(movementScheme("lunge", "full", "build", "rebound").emphasis).toBe("endurance");
  });

  it("shows the velocity rule instead of a reps-in-reserve figure", () => {
    const scheme = movementScheme("squat", "power", "build", "rebound");
    const text = suggestedWeight(scheme, "squat");
    expect(text).toContain("bar speed");
    expect(text).not.toContain("RIR");
  });
});

describe("a power day only trains patterns with a ballistic expression", () => {
  it("rejects the isolation pattern outright", () => {
    expect(acceptsPattern("power", "chest_fly")).toBe(false);
    expect(POWER_PATTERNS).not.toContain("chest_fly" as LiftPattern);
  });

  it("is not the wildcard it used to be — that is what made it a dumping ground", () => {
    // `full` still accepts everything; `power` must not.
    expect(acceptsPattern("full", "chest_fly")).toBe(true);
    expect(POWER_PATTERNS.length).toBeLessThan(8);
  });

  it("has a performable option for every pattern it does accept", () => {
    for (const p of POWER_PATTERNS) {
      expect(POWER_EXERCISE[p]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("power exercise selection", () => {
  it("picks ballistic movements, not the strength library", () => {
    const strength = pickExercise("squat", 3, undefined, "full");
    const power = pickExercise("squat", 3, undefined, "power");
    expect(power).not.toBe(strength);
    expect(POWER_EXERCISE.squat).toContain(power);
  });

  it("still falls back to something a bodyweight-only athlete can do", () => {
    for (const p of POWER_PATTERNS) {
      const ex = pickExercise(p, 1, ["bodyweight_only"], "power");
      expect(typeof ex).toBe("string");
      expect(ex.length).toBeGreaterThan(0);
    }
  });

  it("leaves non-power days completely unchanged", () => {
    expect(pickExercise("squat", 3, undefined, "full")).toBe(pickExercise("squat", 3));
  });
});

describe("the power day is short", () => {
  it("caps well below the general session ceiling", () => {
    expect(MAX_POWER_SESSION_SETS).toBeLessThan(MAX_SESSION_WORKING_SETS);
  });

  it("trims an overloaded power session down to its own ceiling", () => {
    const sessions = [
      {
        liftType: "power" as const,
        movements: POWER_PATTERNS.slice(0, 4).map((pattern) => ({
          pattern,
          sets: 6,
          repRange: "3",
        })),
      },
    ];
    expect(sessions[0]!.movements.reduce((n, m) => n + m.sets, 0)).toBe(24);
    capSessionWorkingSets(sessions);
    const total = sessions[0]!.movements.reduce((n, m) => n + m.sets, 0);
    expect(total).toBeLessThanOrEqual(MAX_POWER_SESSION_SETS);
  });
});

describe("a power session is always trainable and lower-body inclusive", () => {
  const mk = (patterns: LiftPattern[]) => ({
    liftType: "power" as const,
    movements: patterns.map((pattern) => ({ pattern, sets: 3, repRange: "3" })),
  });

  it("adds a squat or hinge to an all-upper power day", () => {
    // Levi's live Wednesday: Med-Ball Chest Pass / Kettlebell High Pull /
    // Push Press / Explosive Barbell Row — four upper patterns, no jump, no swing.
    const s = mk(["horizontal_press", "vertical_pull", "vertical_press", "horizontal_pull"]);
    ensurePowerSessionPatterns(s, 1);
    expect(s.movements.some((m) => m.pattern === "squat" || m.pattern === "hip_hinge")).toBe(true);
  });

  it("puts the lower-body work FIRST — it wants the freshest nervous system", () => {
    const s = mk(["vertical_press", "horizontal_pull"]);
    ensurePowerSessionPatterns(s, 1);
    expect(["squat", "hip_hinge"]).toContain(s.movements[0]!.pattern);
  });

  it("alternates which lower pattern it adds across weeks", () => {
    const a = mk(["vertical_press"]);
    const b = mk(["vertical_press"]);
    ensurePowerSessionPatterns(a, 1);
    ensurePowerSessionPatterns(b, 2);
    expect(a.movements[0]!.pattern).not.toBe(b.movements[0]!.pattern);
  });

  it("never leaves a power session empty", () => {
    const s = mk([]);
    ensurePowerSessionPatterns(s, 1);
    expect(s.movements.length).toBeGreaterThan(0);
    expect(s.movements.some((m) => m.pattern === "squat" || m.pattern === "hip_hinge")).toBe(true);
  });

  it("leaves a session that already has lower-body work alone", () => {
    const s = mk(["squat", "vertical_press"]);
    const before = s.movements.map((m) => m.pattern);
    ensurePowerSessionPatterns(s, 1);
    expect(s.movements.map((m) => m.pattern)).toEqual(before);
  });

  it("does nothing to a non-power session", () => {
    const s = { liftType: "full" as const, movements: [] };
    ensurePowerSessionPatterns(s, 1);
    expect(s.movements).toEqual([]);
  });
});
