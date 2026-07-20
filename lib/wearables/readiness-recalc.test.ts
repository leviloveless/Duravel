import { describe, it, expect } from "vitest";
import { objectiveReadiness, type DailyPoint } from "./readiness-recalc";

/** Build a descending run of daily points ending at `end` (YYYY-MM-DD). */
function daysBefore(end: string, n: number, rhr: number, hrv: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  const endMs = Date.parse(end + "T00:00:00Z");
  for (let i = 1; i <= n; i++) {
    const d = new Date(endMs - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: d, restingHr: rhr, hrv });
  }
  return out;
}

describe("objectiveReadiness", () => {
  it("returns null with no usable readings", () => {
    expect(objectiveReadiness([{ date: "2026-07-01", restingHr: null, hrv: null }])).toBeNull();
  });

  it("has no baseline (null score) until enough history", () => {
    const r = objectiveReadiness([
      { date: "2026-07-03", restingHr: 50, hrv: 80 },
      { date: "2026-07-02", restingHr: 51, hrv: 79 },
    ])!; // only 1 prior < MIN_BASELINE (3)
    expect(r.date).toBe("2026-07-03");
    expect(r.restingHrBaseline).toBeNull();
    expect(r.objectiveScore).toBeNull();
  });

  it("flags elevated RHR + suppressed HRV vs a solid baseline", () => {
    const today: DailyPoint = { date: "2026-07-15", restingHr: 58, hrv: 55 };
    const priors = daysBefore("2026-07-15", 10, 50, 80); // baseline RHR 50, HRV 80
    const r = objectiveReadiness([today, ...priors])!;
    expect(r.restingHrBaseline).toBe(50);
    expect(r.hrvBaseline).toBe(80);
    expect(r.restingHrDelta).toBe(8);
    expect(r.hrvDropPct).toBe(31);
    expect(r.objectiveScore).toBeLessThan(70); // penalized on both axes
    expect(r.note).toMatch(/resting HR/);
    expect(r.note).toMatch(/HRV/);
  });

  it("scores ~100 when today sits at baseline", () => {
    const today: DailyPoint = { date: "2026-07-15", restingHr: 50, hrv: 80 };
    const priors = daysBefore("2026-07-15", 10, 50, 80);
    const r = objectiveReadiness([today, ...priors])!;
    expect(r.objectiveScore).toBe(100);
    expect(r.note).toBe("");
  });

  it("excludes readings older than the baseline window", () => {
    const today: DailyPoint = { date: "2026-07-15", restingHr: 50, hrv: 80 };
    // 3 stale points ~60 days back should NOT form a baseline.
    const stale = daysBefore("2026-05-10", 3, 48, 90);
    const r = objectiveReadiness([today, ...stale])!;
    expect(r.restingHrBaseline).toBeNull();
    expect(r.objectiveScore).toBeNull();
  });
});
