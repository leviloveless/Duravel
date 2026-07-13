import { describe, it, expect } from "vitest";
import {
  maxHeartRate,
  resolveHrModel,
  zoneBpmRange,
  ZONE_BANDS_HRMAX,
} from "./zones";

describe("maxHeartRate", () => {
  it("uses a tested override when given", () => {
    expect(maxHeartRate(30, "male", 195)).toBe(195);
  });
  it("female → Gulati (206 − 0.88·age)", () => {
    expect(maxHeartRate(40, "female")).toBe(Math.round(206 - 0.88 * 40)); // 171
  });
  it("male/other → Tanaka (208 − 0.70·age), better than 220−age", () => {
    expect(maxHeartRate(40, "male")).toBe(Math.round(208 - 0.7 * 40)); // 180
    expect(maxHeartRate(40)).toBe(180);
    // differs from the old 220−age everywhere except the ~age-40 crossover
    expect(maxHeartRate(60, "male")).toBe(166);
    expect(maxHeartRate(60, "male")).not.toBe(220 - 60); // 166 ≠ 160
  });
  it("falls back to age 30 when age missing", () => {
    expect(maxHeartRate(undefined, "male")).toBe(Math.round(208 - 0.7 * 30));
  });
});

describe("resolveHrModel cascade", () => {
  const base = { age: 30, sex: "male" as const };

  it("HRmax when no resting/threshold HR", () => {
    const m = resolveHrModel(base);
    expect(m.method).toBe("hrmax");
    expect(m.bands).toBe(ZONE_BANDS_HRMAX);
  });

  it("corrected HRmax Z2 is 70–80% (easy running no longer mislabeled Z3)", () => {
    const m = resolveHrModel(base);
    expect(m.bands[2]).toEqual({ low: 0.7, high: 0.8 });
  });

  it("resting HR ⇒ %HRR (Karvonen), folded into fraction-of-max", () => {
    const m = resolveHrModel({ ...base, maxHr: 190, restingHr: 50 });
    expect(m.method).toBe("hrr");
    // Z2 60–70% HRR over reserve 140 ⇒ 134–148 bpm
    expect(zoneBpmRange(m, 2)).toEqual({ min: 134, max: 148 });
  });

  it("threshold HR ⇒ %LTHR (Friel); threshold sits at the Z4/5 boundary", () => {
    const m = resolveHrModel({ ...base, maxHr: 190, thresholdHr: 170 });
    expect(m.method).toBe("lthr");
    // Z4 tops out at 100% LTHR = 170 bpm; low 95% ⇒ ~162 bpm
    expect(zoneBpmRange(m, 4)).toEqual({ min: 162, max: 170 });
  });

  it("LTHR takes priority over HRR when both present", () => {
    const m = resolveHrModel({ ...base, restingHr: 50, thresholdHr: 165 });
    expect(m.method).toBe("lthr");
  });

  it("explicit custom bands win over everything", () => {
    const custom = {
      1: { low: 0, high: 0.6 },
      2: { low: 0.6, high: 0.7 },
      3: { low: 0.7, high: 0.8 },
      4: { low: 0.8, high: 0.9 },
      5: { low: 0.9, high: 1 },
    } as const;
    const m = resolveHrModel({ ...base, restingHr: 50, thresholdHr: 165, customBands: custom });
    expect(m.method).toBe("custom");
    expect(m.bands).toBe(custom);
  });

  it("ignores an implausible resting HR ≥ max", () => {
    const m = resolveHrModel({ ...base, maxHr: 180, restingHr: 190 });
    expect(m.method).toBe("hrmax");
  });
});
