import { describe, it, expect } from "vitest";
import {
  computePaces,
  vdotFromRace,
  paceForVdotFraction,
  parseTimeToSeconds,
  formatPace,
  effectivePace,
  MILE_M,
  FIVE_K_M,
  TEN_K_M,
} from "./paces";

const sec = (t: string) => parseTimeToSeconds(t)!;

describe("VDOT core", () => {
  it("is consistent across distances for a Riegel-consistent runner (±1.5)", () => {
    const vMile = vdotFromRace(MILE_M, sec("5:30"))!;
    const v5k = vdotFromRace(FIVE_K_M, sec("19:00"))!;
    const v10k = vdotFromRace(TEN_K_M, sec("39:30"))!;
    expect(Math.max(vMile, v5k, v10k) - Math.min(vMile, v5k, v10k)).toBeLessThan(1.5);
  });

  it("faster race ⇒ higher VDOT", () => {
    expect(vdotFromRace(FIVE_K_M, sec("18:00"))!).toBeGreaterThan(
      vdotFromRace(FIVE_K_M, sec("24:00"))!,
    );
  });

  it("higher VDOT fraction ⇒ faster (smaller) pace", () => {
    const vdot = vdotFromRace(FIVE_K_M, sec("20:00"))!;
    expect(paceForVdotFraction(vdot, 0.975)).toBeLessThan(paceForVdotFraction(vdot, 0.7));
  });
});

describe("computePaces", () => {
  it("returns null with no usable times", () => {
    expect(computePaces(undefined)).toBeNull();
    expect(computePaces({})).toBeNull();
    expect(computePaces("")).toBeNull();
  });

  it("accepts a bare 5K string (backward compatible)", () => {
    const p = computePaces("20:00")!;
    expect(p).not.toBeNull();
    // predicted 5K pace ≈ actual (1200s / 3.107 mi ≈ 6:26/mi)
    expect(Math.abs(p.fiveKSecPerMile - 1200 / (FIVE_K_M / MILE_M))).toBeLessThan(8);
  });

  it("uses the BEST performance across mile/5K/10K", () => {
    const strongMile = computePaces({ mileTime: "5:00", fiveKTime: "24:00" })!;
    const only5k = computePaces({ fiveKTime: "24:00" })!;
    // the strong mile raises VDOT ⇒ every pace gets faster
    expect(strongMile.vdot).toBeGreaterThan(only5k.vdot);
    expect(strongMile.easy).toBeLessThan(only5k.easy);
    expect(strongMile.vdot).toBeCloseTo(vdotFromRace(MILE_M, sec("5:00"))!, 1);
  });

  it("long runs are prescribed at easy pace (Daniels L = E)", () => {
    const p = computePaces("22:00")!;
    expect(p.long).toBe(p.easy);
  });

  it("threshold sits ~15–35 s/mi slower than predicted 5K pace", () => {
    for (const t of ["18:00", "22:00", "28:00"]) {
      const p = computePaces(t)!;
      const d = p.threshold - p.fiveKSecPerMile;
      expect(d).toBeGreaterThan(15);
      expect(d).toBeLessThan(35);
    }
  });

  it("fixes the slow-runner edge case: 34:00 easy pace is well under 18 min/mi", () => {
    const p = computePaces("34:00")!;
    expect(p.easy).toBeLessThan(18 * 60); // old 162% model gave ~17:44/mi
    expect(p.easy).toBeGreaterThan(11 * 60); // still genuinely easy
  });

  it("effectivePace: fartlek/progression blend easy+threshold", () => {
    const p = computePaces("21:00")!;
    expect(effectivePace("fartlek", p)).toBeCloseTo((p.easy + p.threshold) / 2, 5);
    expect(effectivePace("hybrid_run", p)).toBe(p.threshold);
  });
});

describe("formatPace", () => {
  it("formats seconds/mile as m:ss", () => {
    expect(formatPace(512)).toBe("8:32");
    expect(formatPace(600)).toBe("10:00");
  });
});

describe("manual pace overrides", () => {
  it("replaces the derived pace for a run type and drives effectivePace", () => {
    const base = computePaces({ fiveKTime: "21:00" })!;
    const p = computePaces({ fiveKTime: "21:00", thresholdPace: "7:30" })!;
    // 7:30/mi = 450 s/mi overrides threshold; other paces untouched.
    expect(p.threshold).toBe(450);
    expect(effectivePace("threshold", p)).toBe(450);
    expect(effectivePace("hybrid_run", p)).toBe(450); // hybrid_run uses threshold
    expect(p.easy).toBe(base.easy);
    expect(p.interval).toBe(base.interval);
  });

  it("an easy override also moves the long pace (L = E)", () => {
    const p = computePaces({ fiveKTime: "21:00", easyPace: "10:00" })!;
    expect(p.easy).toBe(600);
    expect(p.long).toBe(600);
  });

  it("interprets km paces and converts to sec/mile", () => {
    const p = computePaces({ fiveKTime: "21:00", intervalPace: "5:00", paceUnit: "km" })!;
    // 5:00/km = 300 s/km × 1.609344 = ~482.8 s/mi
    expect(p.interval).toBeCloseTo(300 * 1.609344, 3);
  });

  it("blank or invalid overrides fall back to the derived pace", () => {
    const base = computePaces({ fiveKTime: "21:00" })!;
    const p = computePaces({ fiveKTime: "21:00", tempoPace: "", easyPace: "abc" })!;
    expect(p.tempo).toBe(base.tempo);
    expect(p.easy).toBe(base.easy);
  });

  it("all four paces can be overridden at once", () => {
    const p = computePaces({
      fiveKTime: "21:00",
      easyPace: "9:45",
      thresholdPace: "7:20",
      intervalPace: "6:40",
      tempoPace: "7:50",
      paceUnit: "mi",
    })!;
    expect([p.easy, p.threshold, p.interval, p.tempo]).toEqual([585, 440, 400, 470]);
  });
});
