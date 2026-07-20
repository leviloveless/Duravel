import { describe, it, expect } from "vitest";
import { pickExercise, EXERCISE_AB } from "./strength";

describe("pickExercise (A/B by week)", () => {
  it("odd weeks → A variant, even weeks → B", () => {
    expect(pickExercise("squat", 1)).toBe("Back Squat");
    expect(pickExercise("squat", 2)).toBe("Front Squat");
    expect(pickExercise("squat", 3)).toBe("Back Squat");
    expect(pickExercise("hip_hinge", 2)).toBe("Romanian Deadlift");
    expect(pickExercise("vertical_pull", 1)).toBe("Pull-Up");
  });
  it("consecutive weeks never repeat the same exercise for a pattern", () => {
    for (const pattern of Object.keys(EXERCISE_AB) as (keyof typeof EXERCISE_AB)[]) {
      for (let w = 1; w <= 12; w++) {
        expect(pickExercise(pattern, w)).not.toBe(pickExercise(pattern, w + 1));
      }
    }
  });
  it("covers every movement pattern with two distinct variants", () => {
    for (const [, [a, b]] of Object.entries(EXERCISE_AB)) {
      expect(a).not.toBe(b);
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
    }
  });
});
