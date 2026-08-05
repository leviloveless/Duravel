/**
 * Equipment-aware exercise selection (backlog #17, built 2026-08-05).
 *
 * Onboarding has collected an equipment list since the field shipped, and told
 * athletes "we'll factor it in as this feature rolls out". Nothing ever read it:
 * a bodyweight-only athlete was still prescribed "Back Squat — 4 x 5-6 @ 285 lbs".
 */
import { describe, it, expect } from "vitest";
import type { EquipmentKey } from "@/lib/schemas";
import {
  pickExercise,
  canPerform,
  isBodyweight,
  usesBarbellBenchmark,
  EXERCISE_FALLBACKS,
  EXERCISE_EQUIPMENT,
  type LiftPattern,
} from "./strength";

const PATTERNS = Object.keys(EXERCISE_FALLBACKS) as LiftPattern[];

describe("equipment-aware exercise selection", () => {
  it("is a no-op when no equipment is known — existing programs are unchanged", () => {
    for (const p of PATTERNS) {
      for (const wk of [1, 2, 7, 12]) {
        expect(pickExercise(p, wk, undefined)).toBe(pickExercise(p, wk));
        expect(pickExercise(p, wk, [])).toBe(pickExercise(p, wk));
      }
    }
  });

  it("every pattern still resolves to something performable with NOTHING", () => {
    const none: EquipmentKey[] = ["bodyweight_only"];
    for (const p of PATTERNS) {
      for (const wk of [1, 2, 3, 4]) {
        const ex = pickExercise(p, wk, none);
        expect(canPerform(ex, none), `${p} wk${wk} → ${ex}`).toBe(true);
        expect(isBodyweight(ex), `${p} wk${wk} → ${ex}`).toBe(true);
      }
    }
  });

  it("substitutes down to the athlete's actual kit", () => {
    const db: EquipmentKey[] = ["dumbbells", "bench"];
    expect(pickExercise("squat", 1, db)).toBe("Goblet Squat");
    expect(pickExercise("horizontal_press", 1, db)).toBe("Dumbbell Bench Press");
    // A barbell athlete keeps the barbell movement.
    const full: EquipmentKey[] = ["barbell", "squat_rack", "bench", "dumbbells", "pull_up_bar"];
    expect(pickExercise("squat", 1, full)).toBe("Back Squat");
    expect(pickExercise("vertical_pull", 1, full)).toBe("Pull-Up");
  });

  it("keeps varying week to week within what the athlete can do", () => {
    const db: EquipmentKey[] = ["dumbbells", "bench"];
    const picks = new Set([1, 2, 3, 4].map((w) => pickExercise("horizontal_press", w, db)));
    expect(picks.size).toBeGreaterThan(1); // still rotating, not stuck on one lift
    for (const ex of picks) expect(canPerform(ex, db)).toBe(true);
  });

  it("only a BARBELL movement inherits the 5RM benchmark", () => {
    // Otherwise a substituted variant got the barbell number: "Goblet Squat — 285 lbs".
    expect(usesBarbellBenchmark("Back Squat")).toBe(true);
    expect(usesBarbellBenchmark("Conventional Deadlift")).toBe(true);
    expect(usesBarbellBenchmark("Goblet Squat")).toBe(false);
    expect(usesBarbellBenchmark("Dumbbell Romanian Deadlift")).toBe(false);
    expect(usesBarbellBenchmark("Push-Up")).toBe(false);
  });

  it("every fallback exercise has a declared equipment requirement", () => {
    for (const [pattern, ladder] of Object.entries(EXERCISE_FALLBACKS)) {
      expect(ladder.length, pattern).toBeGreaterThan(0);
      for (const ex of ladder) {
        expect(EXERCISE_EQUIPMENT[ex], `${pattern} → ${ex}`).toBeDefined();
      }
      // The ladder must END somewhere an athlete with nothing can go.
      expect(
        ladder.some((e) => EXERCISE_EQUIPMENT[e]?.length === 0),
        pattern,
      ).toBe(true);
    }
  });

  it("an unknown (AI-authored) exercise is never second-guessed", () => {
    expect(canPerform("Zercher Carry", ["bodyweight_only"])).toBe(true);
  });
});
