/**
 * The trailing window the long-run ceiling measures against.
 *
 * Specification of new behaviour — `main` has no such module, so this file fails
 * there by ABSENCE. The behavioural guard is
 * `lib/generation/long-run-jump.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { LONG_RUN_MAX_JUMP_PCT, longRunCapMiles, trailingLongRunMax } from "./long-run-cap";

describe("the trailing window", () => {
  it("measures against the MAX of the window, not last week", () => {
    // A deload cuts the long run 40%. Measured against last week the rebound
    // reads as a 67% jump and would be throttled every microcycle; against the
    // trailing max it is simply a return to a distance already run.
    expect(trailingLongRunMax([10, 10, 6])).toBe(10);
    expect(longRunCapMiles([10, 10, 6])).toBeCloseTo(11, 5);
  });

  it("skips weeks with no long run rather than treating them as zero", () => {
    // A race week carries none. Counting it would cap the next week at zero.
    expect(trailingLongRunMax([8, 0, 0, 0])).toBe(8);
  });

  it("forgets a distance that has aged out of the window", () => {
    expect(trailingLongRunMax([20, 6, 6, 6, 6])).toBe(6);
  });

  it("has no opinion at the start of a program", () => {
    expect(longRunCapMiles([])).toBeNull();
    expect(longRunCapMiles([0, 0])).toBeNull();
  });

  it("allows exactly the documented jump", () => {
    expect(longRunCapMiles([10])).toBeCloseTo(10 * (1 + LONG_RUN_MAX_JUMP_PCT), 5);
  });
});
