import { describe, it, expect } from "vitest";
import type { ProgramWeek, WorkoutLog } from "@/lib/schemas";
import {
  computeWeekSignals,
  computeLoadMetrics,
  decideAdaptation,
  type AdaptContext,
} from "./adapt";
import { increaseStep, INCREASE_MILEAGE_PCT, INCREASE_MILEAGE_MIN_STEP } from "./volume";
import type { WeekSkeleton } from "./types";

function makeWeek(weekNumber: number): ProgramWeek {
  return {
    weekNumber,
    phase: "base",
    microWeek: "increase",
    summary: { totalCardioMinutes: 240, totalMileage: 24, zoneDistribution: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 } },
    days: [
      { day: "mon", sessions: [{ kind: "run", runType: "easy", durationMin: 40, paceMinMile: "9:00", distanceMiles: 4.5, goalZone: 2 }] },
      { day: "tue", sessions: [{ kind: "lift", liftType: "upper", movements: [{ pattern: "horizontal_press", sets: 4, repRange: "6-8" }] }] },
      { day: "wed", sessions: [{ kind: "run", runType: "tempo", durationMin: 30, paceMinMile: "7:30", distanceMiles: 4, goalZone: 4 }] },
      { day: "thu", sessions: [{ kind: "lift", liftType: "lower", movements: [{ pattern: "squat", sets: 4, repRange: "5" }] }] },
      { day: "fri", sessions: [{ kind: "hybrid", goalZone: 4, elements: [{ exercise: "row erg", prescription: "1000m" }] }] },
      { day: "sat", sessions: [{ kind: "run", runType: "long", durationMin: 90, paceMinMile: "9:15", distanceMiles: 10, goalZone: 2 }] },
      { day: "sun", sessions: [] },
    ],
  };
}

/** 6 completed sessions at fixed rpe + actual duration → deterministic sRPE. */
function logsFor(weekNumber: number, rpe: number, durationMin: number): WorkoutLog[] {
  const days: WorkoutLog["day"][] = ["mon", "tue", "wed", "thu", "fri", "sat"];
  return days.map((day) => ({
    weekNumber, day, sessionIndex: 0, status: "completed", rpe,
    actuals: { durationMin }, note: null,
  }));
}

function nextSkeleton(over: Partial<WeekSkeleton> = {}): WeekSkeleton {
  return { weekNumber: 6, phase: "base", microWeek: "increase", targetMileage: 25.5, targetCardioMinutes: 255, zoneTargets: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 }, days: [], ...over };
}
function ctx(over: Partial<AdaptContext> = {}): AdaptContext {
  return { reviewedTargets: { targetMileage: 24, targetCardioMinutes: 240 }, nextWeek: nextSkeleton(), prevCompliance: null, prevStrain: null, lastRule: null, ...over };
}

describe("session-RPE load + Foster monotony", () => {
  it("weeklyLoad = Σ rpe × session minutes", () => {
    const s = computeWeekSignals(makeWeek(5), logsFor(5, 6, 60));
    expect(s.weeklyLoad).toBe(6 * 6 * 60); // 2160
    expect(s.monotony).toBeCloseTo(2.45, 1);
    expect(s.fosterStrain).toBe(Math.round((s.monotony as number) * 2160));
  });

  it("monotony is null with no logged load", () => {
    const s = computeWeekSignals(makeWeek(5), []);
    expect(s.weeklyLoad).toBe(0);
    expect(s.monotony).toBeNull();
    expect(s.fosterStrain).toBeNull();
  });
});

describe("ACWR (computeLoadMetrics)", () => {
  const weeks = [makeWeek(3), makeWeek(4), makeWeek(5)];
  it("flags a spike vs the chronic baseline", () => {
    const logs = [...logsFor(3, 5, 50), ...logsFor(4, 5, 50), ...logsFor(5, 8, 90)];
    const m = computeLoadMetrics(weeks, logs, 5);
    expect(m.acute).toBe(6 * 8 * 90); // 4320
    expect(m.acwr).not.toBeNull();
    expect(m.acwr!).toBeGreaterThan(1.5);
  });
  it("acwr is null until ≥3 weeks carry load", () => {
    const logs = logsFor(5, 8, 90); // only the acute week logged
    expect(computeLoadMetrics(weeks, logs, 5).acwr).toBeNull();
  });
});

describe("decideAdaptation — load rules (gated on ACWR)", () => {
  const goodSignals = computeWeekSignals(makeWeek(5), logsFor(5, 3, 45)); // compliance 1, low strain

  it("ACWR ≥ 1.5 → early deload (load_spike)", () => {
    const d = decideAdaptation(goodSignals, ctx({ acwr: 1.6 }));
    expect(d.rule).toBe("load_spike");
    expect(d.revisedTargets?.microWeek).toBe("deload");
    expect(d.revisedTargets?.targetMileage).toBeCloseTo(24 * 0.6, 1);
  });

  it("ACWR in [1.3,1.5) into an increase → hold (load_caution)", () => {
    const d = decideAdaptation(goodSignals, ctx({ acwr: 1.35 }));
    expect(d.rule).toBe("load_caution");
    expect(d.revisedTargets?.targetMileage).toBeCloseTo(24, 1); // held, not progressed
  });

  it("a climbing ACWR suppresses the earned bump", () => {
    const bumpish = decideAdaptation(goodSignals, ctx({ acwr: 1.35 }));
    expect(bumpish.rule).not.toBe("earned_bump");
    // …but with a safe ACWR the bump still fires
    const d = decideAdaptation(goodSignals, ctx({ acwr: 1.1 }));
    expect(d.rule).toBe("earned_bump");
  });

  it("no ACWR data ⇒ unchanged legacy behavior (bump fires)", () => {
    const d = decideAdaptation(goodSignals, ctx());
    expect(d.rule).toBe("earned_bump");
  });
});

describe("ramp-rate inversion fix", () => {
  it("beginner mileage is capped at +10% (was +12.5%); advanced stays +7.5%", () => {
    expect(increaseStep(12, INCREASE_MILEAGE_PCT, INCREASE_MILEAGE_MIN_STEP)).toBeCloseTo(1.2, 3); // 10%
    expect(increaseStep(35, INCREASE_MILEAGE_PCT, INCREASE_MILEAGE_MIN_STEP)).toBeCloseTo(2.625, 3); // 7.5%
  });
});


describe("decideAdaptation — readiness rules (gated on a check-in)", () => {
  const goodSignals = computeWeekSignals(makeWeek(5), logsFor(5, 3, 45));

  it("very low readiness → preemptive early deload", () => {
    const d = decideAdaptation(goodSignals, ctx({ readiness: { score: 25, category: "very_low" } }));
    expect(d.rule).toBe("readiness_deload");
    expect(d.revisedTargets?.microWeek).toBe("deload");
  });

  it("low readiness into an increase → hold", () => {
    const d = decideAdaptation(goodSignals, ctx({ readiness: { score: 48, category: "low" } }));
    expect(d.rule).toBe("readiness_hold");
    expect(d.revisedTargets?.targetMileage).toBeCloseTo(24, 1);
  });

  it("low readiness suppresses the earned bump; good readiness allows it", () => {
    expect(decideAdaptation(goodSignals, ctx({ readiness: { score: 48, category: "low" } })).rule)
      .not.toBe("earned_bump");
    expect(decideAdaptation(goodSignals, ctx({ readiness: { score: 85, category: "good" } })).rule)
      .toBe("earned_bump");
  });

  it("no check-in ⇒ unchanged legacy behavior", () => {
    expect(decideAdaptation(goodSignals, ctx()).rule).toBe("earned_bump");
  });
});
