/**
 * `currentDaysPerWeek` -> starting volume (Tasks #17, wired 2026-08-05).
 *
 * The field was collected, validated and persisted since it shipped, and read by
 * NOTHING — onboarding promised "Helps us pitch your starting volume to where you
 * are now" and nothing pitched anything. These tests pin the promise.
 */
import { describe, it, expect } from "vitest";
import {
  MIN_START_READINESS,
  startVolumeReadiness,
  bandStartCardioMinutes,
  bandMinTrainingDays,
} from "./time-budget";
import { buildSkeleton } from "./skeleton";
import type { EngineInput } from "./types";
import type { WeeklyHoursBand } from "@/lib/schemas";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const base: EngineInput = {
  sport: "hyrox",
  weeklyHours: "h5_10",
  trainingClass: "non_highly_trained",
  runningExp: "intermediate",
  hybridExp: "intermediate",
  liftingExp: "intermediate",
  programType: "goal_event",
  durationWeeks: 12,
  trainingDays: [...DAYS.slice(0, 6)],
  races: [],
};

describe("startVolumeReadiness", () => {
  it("is a no-op when the athlete skipped the optional field", () => {
    expect(startVolumeReadiness(undefined, 6)).toBe(1);
  });

  it("returns 1.0 when they already train the days they signed up for", () => {
    expect(startVolumeReadiness(6, 6)).toBe(1);
  });

  it("never scales UP for training more days than committed", () => {
    expect(startVolumeReadiness(7, 6)).toBe(1);
    expect(startVolumeReadiness(7, 3)).toBe(1);
  });

  it("floors at MIN_START_READINESS for a fully detrained athlete", () => {
    expect(startVolumeReadiness(0, 6)).toBeCloseTo(MIN_START_READINESS, 10);
  });

  it("scales linearly in between", () => {
    expect(startVolumeReadiness(3, 6)).toBeCloseTo(0.9, 10);
    expect(startVolumeReadiness(2, 4)).toBeCloseTo(0.9, 10);
  });

  it("shrugs off garbage input rather than producing NaN volume", () => {
    expect(startVolumeReadiness(Number.NaN, 6)).toBe(1);
    expect(startVolumeReadiness(-3, 6)).toBeCloseTo(MIN_START_READINESS, 10);
    expect(startVolumeReadiness(3, 0)).toBe(1);
  });
});

describe("skeleton seeding", () => {
  const week1 = (input: EngineInput) => {
    const wk = buildSkeleton(input).weeks[0]!;
    return { mi: wk.targetMileage, ca: wk.targetCardioMinutes };
  };

  it("leaves programs without the field byte-identical", () => {
    expect(week1({ ...base, currentDaysPerWeek: undefined })).toEqual(week1(base));
  });

  it("starts a 2-day athlete below a 6-day athlete on the same band", () => {
    const ready = week1({ ...base, currentDaysPerWeek: 6 });
    const rusty = week1({ ...base, currentDaysPerWeek: 2 });
    expect(rusty.mi).toBeLessThan(ready.mi);
    expect(rusty.ca).toBeLessThan(ready.ca);
    // …but not by more than the floor allows.
    expect(rusty.ca).toBeGreaterThanOrEqual(ready.ca * MIN_START_READINESS - 1);
  });

  /**
   * THE test that justifies `MIN_START_READINESS`.
   *
   * The progression is multiplicative, so the week-1 discount rides all the way to
   * the peak — a floor set too low quietly under-delivers the band the athlete
   * chose. The line that has to hold: even a fully-detrained athlete must FINISH
   * the block training more than the band's own week-1 prescription. At 0.8 that
   * is true in every band; at 0.75 it already fails at h5_10 by one minute.
   */
  it("leaves a fully-detrained athlete peaking above their band's starting volume", () => {
    const bands: WeeklyHoursBand[] = ["h0_5", "h5_10", "h10_20", "h20_30"];
    for (const b of bands) {
      const days = bandMinTrainingDays(b);
      const input: EngineInput = {
        ...base,
        weeklyHours: b,
        trainingDays: [...DAYS.slice(0, days)],
        currentDaysPerWeek: 0,
      };
      const peak = Math.max(...buildSkeleton(input).weeks.map((w) => w.targetCardioMinutes));
      expect(peak, `${b} detrained peak vs band start`).toBeGreaterThanOrEqual(
        bandStartCardioMinutes(b),
      );
    }
  });

  it("never lets the discounted athlete out-volume the ready one", () => {
    const peakOf = (cur?: number) =>
      Math.max(
        ...buildSkeleton({ ...base, currentDaysPerWeek: cur }).weeks.map(
          (w) => w.targetCardioMinutes,
        ),
      );
    expect(peakOf(0)).toBeLessThanOrEqual(peakOf(6));
    expect(peakOf(6)).toBe(peakOf(undefined));
  });

  it("respects an explicit starting volume the athlete typed", () => {
    const a = week1({ ...base, currentDaysPerWeek: 1, startMileage: 30, startCardioMinutes: 400 });
    const b = week1({ ...base, currentDaysPerWeek: 6, startMileage: 30, startCardioMinutes: 400 });
    expect(a).toEqual(b);
  });
});
