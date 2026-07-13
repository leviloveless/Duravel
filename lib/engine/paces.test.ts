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
