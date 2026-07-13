import { describe, it, expect } from "vitest";
import { hooperReadiness, computeReadiness, type ReadinessCheckin } from "./readiness";

const c = (over: Partial<ReadinessCheckin> = {}): ReadinessCheckin => ({
  weekNumber: 1, sleep: 4, fatigue: 4, stress: 4, soreness: 4, ...over,
});

describe("hooperReadiness", () => {
  it("maps the 4-item sum to 0–100 (best → 100, worst → 0)", () => {
    expect(hooperReadiness(c({ sleep: 1, fatigue: 1, stress: 1, soreness: 1 }))).toBe(100);
    expect(hooperReadiness(c({ sleep: 7, fatigue: 7, stress: 7, soreness: 7 }))).toBe(0);
    expect(hooperReadiness(c())).toBe(50); // sum 16
  });
});

describe("computeReadiness", () => {
  it("uses Hooper alone when there is no objective history", () => {
    const r = computeReadiness(c({ sleep: 2, fatigue: 2, stress: 2, soreness: 2 }));
    expect(r.score).toBe(r.hooperScore);
    expect(r.category).toBe("good");
  });

  it("categorizes very_low / low / moderate / good", () => {
    expect(computeReadiness(c({ sleep: 7, fatigue: 7, stress: 7, soreness: 6 })).category).toBe("very_low"); // 4
    expect(computeReadiness(c({ sleep: 5, fatigue: 5, stress: 4, soreness: 4 })).category).toBe("low"); // 42
    expect(computeReadiness(c({ sleep: 4, fatigue: 3, stress: 3, soreness: 3 })).category).toBe("moderate"); // 62
    expect(computeReadiness(c({ sleep: 2, fatigue: 2, stress: 2, soreness: 2 })).category).toBe("good"); // 83
  });

  it("elevated resting HR vs personal baseline lowers readiness", () => {
    const priors = [c({ restingHr: 50 }), c({ restingHr: 52 })];
    const base = computeReadiness(c({ sleep: 3, fatigue: 3, stress: 3, soreness: 3 }));
    const elevated = computeReadiness(
      c({ sleep: 3, fatigue: 3, stress: 3, soreness: 3, restingHr: 60 }),
      priors,
    );
    expect(elevated.score).toBeLessThan(base.score);
    expect(elevated.note).toContain("resting HR");
  });

  it("suppressed HRV vs personal baseline lowers readiness", () => {
    const priors = [c({ hrv: 80 }), c({ hrv: 82 })];
    const r = computeReadiness(c({ sleep: 3, fatigue: 3, stress: 3, soreness: 3, hrv: 60 }), priors);
    expect(r.note).toContain("HRV");
    expect(r.score).toBeLessThan(hooperReadiness(c({ sleep: 3, fatigue: 3, stress: 3, soreness: 3 })));
  });

  it("ignores objective inputs with <2 priors", () => {
    const r = computeReadiness(c({ restingHr: 80 }), [c({ restingHr: 50 })]);
    expect(r.score).toBe(r.hooperScore);
  });
});
