/**
 * A hybrid carries 20–40 MINUTES of threshold, scaled to running experience
 * (Levi, 2026-08-17).
 *
 * ## The bug in the previous design
 *
 * The race-structure hybrid shipped with all eight run+station couplets, which
 * fixes the DISTANCE at 8 km — and therefore hands the dose to the athlete's
 * pace instead of the plan:
 *
 *      6:00/mi → 30 min      8:00/mi → 40 min
 *     10:00/mi → 50 min     12:00/mi → 60 min
 *
 * Only the fastest athletes landed inside the 20–40 min window the endurance
 * literature converges on. Everyone else was over, and the slowest sat at DOUBLE
 * a beginner's appropriate dose — precisely the athletes least able to absorb
 * it. A fixed distance does not merely fail to scale; it scales BACKWARDS.
 *
 * ## The fix
 *
 * Runs stay at the race's own 1 km (Levi's call — rehearsing the real distance
 * is the point), so the COUPLET COUNT flexes instead. Target minutes come from
 * RUNNING experience, matching `caps.ts`, which already sizes station-hybrid
 * sessions the same way.
 *
 * The couplets a beginner loses are not lost training: `fitHybridToCap` rotates
 * WHICH stations are dropped by week number, so coverage completes across a
 * few weeks rather than within one session.
 */
import { describe, it, expect } from "vitest";
import {
  coupletsForThresholdDose,
  fitHybridToCap,
  HYBRID_THRESHOLD_TARGET_MINUTES,
  HYBRID_THRESHOLD_CEILING_MINUTES,
  MIN_HYBRID_COUPLETS,
  RACE_STATION_ORDER,
  HYROX_CATALOG,
} from "./stations";
import type { ExperienceLevel } from "./types";

const M_PER_MILE = 1609.344;
const LEVELS: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];
const PACES = [6, 7, 8, 9, 10, 11, 12].map((m) => m * 60);

/** Minutes of threshold running `n` couplets buys at this pace. */
function minutesFor(n: number, secPerMile: number): number {
  return (n * ((1000 / M_PER_MILE) * secPerMile)) / 60;
}

describe("every athlete lands in the 20–40 minute threshold window", () => {
  it("never exceeds the ceiling, at any pace or experience", () => {
    for (const exp of LEVELS) {
      for (const pace of PACES) {
        const n = coupletsForThresholdDose(exp, pace);
        const min = minutesFor(n, pace);
        expect(min, `${exp} @ ${pace / 60}:00/mi = ${min.toFixed(0)}min`).toBeLessThanOrEqual(
          HYBRID_THRESHOLD_CEILING_MINUTES + 0.5,
        );
      }
    }
  });

  it("never drops below a real stimulus (~20 min) for a trainable pace", () => {
    for (const exp of LEVELS) {
      for (const pace of PACES) {
        const min = minutesFor(coupletsForThresholdDose(exp, pace), pace);
        expect(min, `${exp} @ ${pace / 60}:00/mi`).toBeGreaterThanOrEqual(19);
      }
    }
  });

  it("scales with experience — a beginner never gets more than an advanced athlete", () => {
    for (const pace of PACES) {
      const b = coupletsForThresholdDose("beginner", pace);
      const i = coupletsForThresholdDose("intermediate", pace);
      const a = coupletsForThresholdDose("advanced", pace);
      expect(b, `${pace / 60}:00/mi`).toBeLessThanOrEqual(i);
      expect(i, `${pace / 60}:00/mi`).toBeLessThanOrEqual(a);
    }
  });

  it("gives a SLOWER athlete fewer couplets — the inversion that started this", () => {
    // The old fixed-8 design gave the 12:00/mi athlete 60 minutes and the
    // 6:00/mi athlete 30. Same session, double the dose, wrong way round.
    for (const exp of LEVELS) {
      const fast = coupletsForThresholdDose(exp, 6 * 60);
      const slow = coupletsForThresholdDose(exp, 12 * 60);
      expect(slow, exp).toBeLessThanOrEqual(fast);
    }
  });

  it("gives a fast advanced athlete the full eight — race distance intact", () => {
    expect(coupletsForThresholdDose("advanced", 6 * 60)).toBe(RACE_STATION_ORDER.length);
    expect(coupletsForThresholdDose("advanced", 8 * 60)).toBe(RACE_STATION_ORDER.length);
  });

  it("floors at three couplets rather than collapsing", () => {
    // A very slow athlete: even three 1 km reps is a long time at threshold. The
    // floor holds and the session is honest about what it costs.
    const n = coupletsForThresholdDose("beginner", 16 * 60);
    expect(n).toBe(MIN_HYBRID_COUPLETS);
  });

  it("falls back to a mid-pack pace when the athlete has no benchmark", () => {
    for (const exp of LEVELS) {
      const withNull = coupletsForThresholdDose(exp, null);
      const at9 = coupletsForThresholdDose(exp, 9 * 60);
      expect(withNull, exp).toBe(at9);
    }
  });

  it("leaves station-only formats alone — no runs means no dose to scale", () => {
    const stationOnly = { ...HYROX_CATALOG, interStationRunMeters: 0 };
    expect(coupletsForThresholdDose("beginner", 12 * 60, stationOnly)).toBe(
      stationOnly.raceOrder.length,
    );
  });
});

describe("the dose drives the session, the cap only trims further", () => {
  it("hands fitHybridToCap the dose-sized session when the cap is generous", () => {
    const ids = fitHybridToCap(
      1,
      200,
      8 * 60,
      "peak",
      "open",
      "male",
      undefined,
      [],
      undefined,
      "beginner",
    );
    expect(ids).toHaveLength(coupletsForThresholdDose("beginner", 8 * 60));
  });

  it("still lets a tight cap cut BELOW the dose", () => {
    const dose = coupletsForThresholdDose("advanced", 8 * 60);
    const capped = fitHybridToCap(
      1,
      30,
      8 * 60,
      "peak",
      "open",
      "male",
      undefined,
      [],
      undefined,
      "advanced",
    );
    expect(capped.length).toBeLessThan(dose);
  });

  it("keeps race order and rotates which stations are dropped", () => {
    const w1 = fitHybridToCap(
      1,
      200,
      11 * 60,
      "peak",
      "open",
      "male",
      undefined,
      [],
      undefined,
      "beginner",
    );
    const w2 = fitHybridToCap(
      2,
      200,
      11 * 60,
      "peak",
      "open",
      "male",
      undefined,
      [],
      undefined,
      "beginner",
    );
    expect(w1.length).toBeLessThan(RACE_STATION_ORDER.length);
    expect(w1).not.toEqual(w2); // a station missed this week returns next
    for (const ids of [w1, w2]) {
      const ranks = ids.map((id) =>
        RACE_STATION_ORDER.indexOf(id as (typeof RACE_STATION_ORDER)[number]),
      );
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("targets are the published window, not arbitrary", () => {
    expect(HYBRID_THRESHOLD_TARGET_MINUTES.beginner).toBeGreaterThanOrEqual(20);
    expect(HYBRID_THRESHOLD_TARGET_MINUTES.advanced).toBeLessThanOrEqual(40);
    expect(HYBRID_THRESHOLD_TARGET_MINUTES.beginner).toBeLessThan(
      HYBRID_THRESHOLD_TARGET_MINUTES.intermediate,
    );
    expect(HYBRID_THRESHOLD_TARGET_MINUTES.intermediate).toBeLessThan(
      HYBRID_THRESHOLD_TARGET_MINUTES.advanced,
    );
  });
});
