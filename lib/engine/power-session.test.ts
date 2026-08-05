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
  powerBlockFor,
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

describe("the power block that opens the heavy day", () => {
  it("is short — a primer, not a session", () => {
    for (const phase of PHASES) {
      const block = powerBlockFor(phase, "rebound", 1);
      expect(block.length).toBeGreaterThan(0);
      expect(block.length).toBeLessThanOrEqual(3);
    }
  });

  it("carries the power scheme and full recovery on every movement", () => {
    for (const m of powerBlockFor("build", "rebound", 1)) {
      expect(Number(m.reps)).toBeLessThanOrEqual(3);
      expect(m.intensityPct).toBeLessThanOrEqual(67);
      expect(m.restSeconds).toBeGreaterThanOrEqual(150);
      expect(m.note).toContain("bar speed");
    }
  });

  it("is empty on recovery weeks — same rule as the plyometrics", () => {
    expect(powerBlockFor("base", "deload", 1)).toEqual([]);
    expect(powerBlockFor("peak", "race", 1)).toEqual([]);
  });

  it("never repeats an exercise already prescribed on the day", () => {
    // A week landed "Push Press" in BOTH the block and the heavy work.
    const avoid = new Set(["Push Press", "Kettlebell Swing"]);
    const block = powerBlockFor("build", "rebound", 2, undefined, avoid);
    for (const m of block) expect(avoid.has(m.exercise)).toBe(false);
  });

  it("never repeats an exercise WITHIN the block", () => {
    for (let wk = 1; wk <= 12; wk++) {
      const names = powerBlockFor("base", "rebound", wk).map((m) => m.exercise);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("still fills for a bodyweight-only athlete", () => {
    expect(powerBlockFor("build", "rebound", 1, ["bodyweight_only"]).length).toBeGreaterThan(0);
  });
});
