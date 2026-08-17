/**
 * Extras count toward what the athlete ACTUALLY did — and toward nothing else
 * (Levi, 2026-08-13).
 *
 * Off-plan work used to be reported only alongside the summary ("1 extra
 * workout · 35 min — not counted in the totals above"), so a week with real
 * unplanned training still read as under-delivered.
 *
 * ## The two exclusions a naive sum gets wrong
 *
 * `extraTotals` already existed and sums duration and distance across EVERY
 * kind. Reusing it here would have produced two wrong numbers that look exactly
 * like right ones:
 *
 *  1. **A 20-mile bike ride would land in RUNNING mileage.** The weekly line is
 *     running mileage, and `sessionMiles` counts runs plus the run legs inside
 *     hybrids. Only `run` and `hybrid` extras may contribute miles.
 *  2. **A lift would add cardio minutes.** `computeWeekSignals` skips lifts when
 *     accumulating actual cardio; an extra has to obey the same rule or the
 *     planned and actual figures stop measuring the same thing.
 *
 * ## What must NOT change
 *
 * Planned totals, compliance %, and every adaptation input. The addition happens
 * at the render site in `week-card.tsx`, NOT inside `computeWeekSignals` — those
 * signals also drive the weekly adaptation, and folding extras in there would
 * let self-added work read as over-delivery and bump next week's prescription.
 */
import { describe, it, expect } from "vitest";
import { actualWithExtras, extraActualContribution, extraTotals } from "./extra-workouts";
import type { ExtraWorkout } from "@/lib/schemas";

function x(over: Partial<ExtraWorkout> = {}): ExtraWorkout {
  return {
    id: "x1",
    weekNumber: 1,
    day: "wed",
    kind: "run",
    ...over,
  } as ExtraWorkout;
}

describe("extraActualContribution", () => {
  it("adds an extra run's minutes and miles", () => {
    const c = extraActualContribution([x({ kind: "run", durationMin: 35, distanceMiles: 4.2 })]);
    expect(c).toEqual({ cardioMinutes: 35, miles: 4.2 });
  });

  it("counts a LIFT's minutes toward nothing — cardio excludes lifts", () => {
    // `computeWeekSignals` does `if (session.kind !== "lift")` before adding to
    // actual cardio. An extra must match, or planned and actual diverge.
    const c = extraActualContribution([x({ kind: "lift", durationMin: 60 })]);
    expect(c.cardioMinutes).toBe(0);
    expect(c.miles).toBe(0);
  });

  it("keeps a BIKE ride out of running mileage — the trap in extraTotals", () => {
    const ride = x({ kind: "cardio", durationMin: 90, distanceMiles: 20 });
    // Its time is real cardio...
    expect(extraActualContribution([ride]).cardioMinutes).toBe(90);
    // ...but its distance is NOT running mileage.
    expect(extraActualContribution([ride]).miles).toBe(0);
    // The pre-existing helper would have added all 20 miles. This is the bug
    // that reusing it would have shipped.
    expect(extraTotals([ride]).miles).toBe(20);
  });

  it("counts hybrid miles — a HYROX session's run legs are on foot", () => {
    const c = extraActualContribution([x({ kind: "hybrid", durationMin: 55, distanceMiles: 3 })]);
    expect(c).toEqual({ cardioMinutes: 55, miles: 3 });
  });

  it("keeps 'other' out of mileage but counts its time", () => {
    const c = extraActualContribution([x({ kind: "other", durationMin: 30, distanceMiles: 5 })]);
    expect(c.cardioMinutes).toBe(30);
    expect(c.miles).toBe(0);
  });

  it("sums a mixed week the way the header should read it", () => {
    const c = extraActualContribution([
      x({ kind: "run", durationMin: 40, distanceMiles: 5 }),
      x({ kind: "lift", durationMin: 60 }),
      x({ kind: "cardio", durationMin: 45, distanceMiles: 15 }),
      x({ kind: "hybrid", durationMin: 50, distanceMiles: 2.5 }),
    ]);
    // 40 + 45 + 50 = 135 cardio minutes (the lift's 60 excluded)
    expect(c.cardioMinutes).toBe(135);
    // 5 + 2.5 = 7.5 running miles (the ride's 15 excluded)
    expect(c.miles).toBe(7.5);
  });

  it("handles extras with nothing recorded, and an empty week", () => {
    expect(extraActualContribution([])).toEqual({ cardioMinutes: 0, miles: 0 });
    expect(extraActualContribution([x({ kind: "run" })])).toEqual({ cardioMinutes: 0, miles: 0 });
  });

  it("rounds miles to one decimal, so the header never shows 7.499999", () => {
    const c = extraActualContribution([
      x({ kind: "run", distanceMiles: 1.11 }),
      x({ kind: "run", distanceMiles: 2.22 }),
    ]);
    expect(c.miles).toBe(3.3);
  });
});

/**
 * The header used to gate its whole Actual line on `signals`, which is null
 * until a PLANNED session has a workout_log. So the week this feature exists
 * for — plan skipped, hour-long ride done instead — printed no Actual at all,
 * directly above a caption reading "counted in Actual". Found on Levi's own
 * week 1: an extra Zone 1–2 cardio, sessions 0%, and nowhere on the page did
 * that work appear as a number.
 */
describe("actualWithExtras — an extra alone is enough to print an Actual", () => {
  const signals = { actualCardioMinutes: 100, actualMileage: 8 };

  it("prints the extra when NOTHING planned was logged — the bug", () => {
    const line = actualWithExtras(null, [x({ kind: "cardio", durationMin: 60 })]);
    expect(line.cardioMinutes).toBe(60);
  });

  it("adds extras on top of logged sessions", () => {
    const line = actualWithExtras(signals, [
      x({ kind: "run", durationMin: 35, distanceMiles: 4.2 }),
    ]);
    expect(line).toEqual({ cardioMinutes: 135, miles: 12.2 });
  });

  it("still prints zeros once real logs exist — 0/150 min is information", () => {
    expect(actualWithExtras(signals, [])).toEqual({ cardioMinutes: 100, miles: 8 });
    expect(actualWithExtras({ actualCardioMinutes: 0, actualMileage: 0 }, [])).toEqual({
      cardioMinutes: 0,
      miles: 0,
    });
  });

  it("says nothing at all when there is nothing to say", () => {
    expect(actualWithExtras(null, [])).toEqual({ cardioMinutes: null, miles: null });
  });

  it("keeps mileage silent for a lift-only week rather than claiming 0 mi", () => {
    // "0 mi" reads as "ran nowhere". The truth is "did not run", and with no
    // logged sessions there is no basis for either claim.
    const line = actualWithExtras(null, [x({ kind: "lift", durationMin: 60 })]);
    expect(line.miles).toBeNull();
    // A lift adds no cardio either, so this week says nothing — correctly.
    expect(line.cardioMinutes).toBeNull();
  });

  it("keeps a bike ride's distance out of mileage even with no logs", () => {
    const line = actualWithExtras(null, [
      x({ kind: "cardio", durationMin: 90, distanceMiles: 20 }),
    ]);
    expect(line.cardioMinutes).toBe(90);
    expect(line.miles).toBeNull();
  });

  it("rounds the combined mileage, not each side", () => {
    const line = actualWithExtras({ actualCardioMinutes: 0, actualMileage: 3.05 }, [
      x({ kind: "run", distanceMiles: 1.02 }),
    ]);
    expect(line.miles).toBe(4.1);
  });
});
