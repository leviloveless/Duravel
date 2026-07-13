import { describe, it, expect } from "vitest";
import type { ProgramWeek, WorkoutLog } from "@/lib/schemas";
import type { WeekSkeleton } from "./types";
import {
  adherenceStreak,
  applyDecisionToWeek,
  clampToBounds,
  computeWeekSignals,
  decideAdaptation,
  type AdaptContext,
  type WeekSignals,
} from "./adapt";
import { ADAPT } from "./adapt-config";

// ---- fixtures ----

/** A 6-session training week: easy run, long run, tempo run, 2 lifts, 1 hybrid. */
function makeWeek(weekNumber = 5): ProgramWeek {
  return {
    weekNumber,
    phase: "base",
    microWeek: "increase",
    summary: {
      totalCardioMinutes: 240,
      totalMileage: 24,
      zoneDistribution: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
    },
    days: [
      { day: "mon", sessions: [{ kind: "run", runType: "easy", durationMin: 40, paceMinMile: "9:00", distanceMiles: 4.5, goalZone: 2 }] },
      { day: "tue", sessions: [{ kind: "lift", liftType: "upper", movements: [{ pattern: "horizontal_press", sets: 4, repRange: "12-15" }] }] },
      { day: "wed", sessions: [{ kind: "run", runType: "tempo", durationMin: 30, paceMinMile: "7:30", distanceMiles: 4, goalZone: 4 }] },
      { day: "thu", sessions: [{ kind: "lift", liftType: "lower", movements: [{ pattern: "squat", sets: 4, repRange: "12-15" }] }] },
      { day: "fri", sessions: [{ kind: "hybrid", goalZone: 4, elements: [{ exercise: "row erg", prescription: "1000m" }] }] },
      { day: "sat", sessions: [{ kind: "run", runType: "long", durationMin: 90, paceMinMile: "9:15", distanceMiles: 10, goalZone: 2 }] },
      { day: "sun", sessions: [] },
    ],
  };
}

function makeNextSkeleton(overrides: Partial<WeekSkeleton> = {}): WeekSkeleton {
  return {
    weekNumber: 6,
    phase: "base",
    microWeek: "increase",
    targetMileage: 25.5,
    targetCardioMinutes: 255,
    zoneTargets: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
    days: [],
    ...overrides,
  };
}

function log(
  day: WorkoutLog["day"],
  sessionIndex: number,
  status: WorkoutLog["status"],
  rpe: number | null = 5,
  weekNumber = 5,
  actuals: WorkoutLog["actuals"] = null,
): WorkoutLog {
  return { weekNumber, day, sessionIndex, status, rpe, actuals, note: null };
}

/** Logs marking every session of makeWeek() completed at the given RPE. */
function allCompleted(rpe = 5): WorkoutLog[] {
  return [
    log("mon", 0, "completed", rpe),
    log("tue", 0, "completed", rpe),
    log("wed", 0, "completed", rpe),
    log("thu", 0, "completed", rpe),
    log("fri", 0, "completed", rpe),
    log("sat", 0, "completed", rpe),
  ];
}

function makeCtx(overrides: Partial<AdaptContext> = {}): AdaptContext {
  return {
    reviewedTargets: { targetMileage: 24, targetCardioMinutes: 240 },
    nextWeek: makeNextSkeleton(),
    prevCompliance: null,
    prevStrain: null,
    lastRule: null,
    ...overrides,
  };
}

// ============================================================
// Signals
// ============================================================

describe("computeWeekSignals", () => {
  it("full compliance when everything is completed", () => {
    const s = computeWeekSignals(makeWeek(), allCompleted());
    expect(s.plannedSessions).toBe(6);
    expect(s.compliance).toBe(1);
    expect(s.longRunCompleted).toBe(true);
    expect(s.qualityRunCompleted).toBe(true);
  });

  it("partial sessions count as half; unlogged count as zero", () => {
    const s = computeWeekSignals(makeWeek(), [
      log("mon", 0, "completed"),
      log("wed", 0, "partial"),
      // tue/thu/fri/sat unlogged
    ]);
    expect(s.compliance).toBe(0.25); // (1 + 0.5) / 6
  });

  it("race sessions are excluded from planned count", () => {
    const week = makeWeek();
    week.days[6]!.sessions = [{ kind: "race", priority: "A" }];
    const s = computeWeekSignals(week, allCompleted());
    expect(s.plannedSessions).toBe(6); // race not counted
    expect(s.compliance).toBe(1);
  });

  it("weights easy-session RPE 1.5× in strain", () => {
    // Easy run (Z2) at RPE 9, tempo (Z4) at RPE 5 → (9*1.5 + 5) / 2.5 = 7.4.
    // The long run is also Z2, so leave it unlogged to isolate the two.
    const s = computeWeekSignals(makeWeek(), [
      log("mon", 0, "completed", 9),
      log("wed", 0, "completed", 5),
    ]);
    expect(s.strain).toBe(7.4);
  });

  it("strain is null when no RPE was logged", () => {
    const s = computeWeekSignals(makeWeek(), [log("mon", 0, "skipped", null)]);
    expect(s.strain).toBeNull();
  });

  it("logged actuals override planned values in actual totals", () => {
    const s = computeWeekSignals(makeWeek(), [
      log("sat", 0, "completed", 6, 5, { distanceMiles: 8, durationMin: 75 }),
    ]);
    expect(s.actualMileage).toBe(8); // only the long run logged, actual wins over 10
    expect(s.actualCardioMinutes).toBe(75);
  });

  it("skipped long run flips longRunCompleted false and records its planned miles", () => {
    const logs = allCompleted().map((l) => (l.day === "sat" ? { ...l, status: "skipped" as const, rpe: null } : l));
    const s = computeWeekSignals(makeWeek(), logs);
    expect(s.longRunCompleted).toBe(false);
    expect(s.longRunPlannedMiles).toBe(10);
  });
});

// ============================================================
// Rules — ordered, first match wins (phase2-spec.md §4b)
// ============================================================

describe("decideAdaptation — rule order and outcomes", () => {
  it("rule 1: taper next week → none, regardless of signals", () => {
    const s = computeWeekSignals(makeWeek(), []); // 0% compliance
    const d = decideAdaptation(s, makeCtx({ nextWeek: makeNextSkeleton({ phase: "taper", microWeek: "taper" }) }));
    expect(d.rule).toBe("none");
    expect(d.revisedTargets).toBeNull();
  });

  it("rule 1: race next week → none", () => {
    const s = computeWeekSignals(makeWeek(), []);
    const d = decideAdaptation(s, makeCtx({ nextWeek: makeNextSkeleton({ raceDay: { priority: "A" } }) }));
    expect(d.rule).toBe("none");
  });

  it("rule 1: no next week → none", () => {
    const s = computeWeekSignals(makeWeek(), []);
    expect(decideAdaptation(s, makeCtx({ nextWeek: null })).rule).toBe("none");
  });

  it("rule 2: two consecutive <40% weeks → re-anchor with decayed targets", () => {
    const s = computeWeekSignals(makeWeek(), [log("mon", 0, "completed")]); // 1/6 ≈ 17%
    const d = decideAdaptation(s, makeCtx({ prevCompliance: 0.2 }));
    expect(d.rule).toBe("re_anchor");
    const factor = Math.max(ADAPT.REANCHOR_FLOOR, ADAPT.REANCHOR_DECAY_PER_WEEK ** 2);
    expect(d.revisedTargets?.targetMileage).toBe(Math.round(24 * factor * 10) / 10);
    expect(d.revisedTargets?.microWeek).toBe("rebound");
  });

  it("rule 2 needs the trend: one bad week alone falls through to hold", () => {
    const s = computeWeekSignals(makeWeek(), [log("mon", 0, "completed")]);
    const d = decideAdaptation(s, makeCtx({ prevCompliance: 0.9 }));
    expect(d.rule).toBe("hold");
  });

  it("rule 3: <60% compliance → hold at reviewed week's volume", () => {
    const s = computeWeekSignals(makeWeek(), [
      log("mon", 0, "completed"),
      log("tue", 0, "completed"),
      log("wed", 0, "completed"),
    ]); // 3/6 = 50%
    const d = decideAdaptation(s, makeCtx());
    expect(d.rule).toBe("hold");
    // Reviewed 24 mi vs next-original 25.5 mi: within ±20%, so kept as-is.
    expect(d.revisedTargets?.targetMileage).toBe(24);
    expect(d.revisedTargets?.microWeek).toBeUndefined();
  });

  it("rule 4: strain ≥ 8 → early deload at standard −40%", () => {
    const s = computeWeekSignals(makeWeek(), allCompleted(9));
    const d = decideAdaptation(s, makeCtx());
    expect(d.rule).toBe("early_deload");
    expect(d.revisedTargets?.targetMileage).toBe(Math.round(24 * ADAPT.DELOAD_FACTOR * 10) / 10);
    expect(d.revisedTargets?.targetCardioMinutes).toBe(Math.round(240 * ADAPT.DELOAD_FACTOR));
    expect(d.revisedTargets?.microWeek).toBe("deload");
  });

  it("rule 4: strain ≥ 7.5 two weeks running → early deload", () => {
    const s = computeWeekSignals(makeWeek(), allCompleted(8)); // 8 ≥ 8 triggers anyway; use 7.6 via prevStrain path
    const s2: WeekSignals = { ...s, strain: 7.6 };
    const d = decideAdaptation(s2, makeCtx({ prevStrain: 7.7 }));
    expect(d.rule).toBe("early_deload");
  });

  it("rule 4: strain 7.6 with a fresh previous week does NOT deload", () => {
    const s = computeWeekSignals(makeWeek(), allCompleted(5));
    const s2: WeekSignals = { ...s, strain: 7.6 };
    const d = decideAdaptation(s2, makeCtx({ prevStrain: 5 }));
    expect(d.rule).not.toBe("early_deload");
  });

  it("rule 5: missed long run (compliance OK) → protect long run, volume unchanged", () => {
    const logs = allCompleted(5).map((l) => (l.day === "sat" ? { ...l, status: "skipped" as const, rpe: null } : l));
    const s = computeWeekSignals(makeWeek(), logs); // 5/6 ≈ 83%
    const d = decideAdaptation(s, makeCtx());
    expect(d.rule).toBe("protect_long_run");
    expect(d.revisedTargets).toBeNull();
    expect(d.constraints.longRunMaxMiles).toBe(10);
  });

  it("rule 6: ≥90% compliance at low strain on an increase week → earned bump", () => {
    const s = computeWeekSignals(makeWeek(), allCompleted(3));
    const d = decideAdaptation(s, makeCtx());
    expect(d.rule).toBe("earned_bump");
    expect(d.revisedTargets?.targetMileage).toBeCloseTo(25.5 * 1.025, 1);
    expect(d.revisedTargets?.targetCardioMinutes).toBe(255); // cardio unchanged
  });

  it("rule 6: bump never fires twice consecutively", () => {
    const s = computeWeekSignals(makeWeek(), allCompleted(3));
    const d = decideAdaptation(s, makeCtx({ lastRule: "earned_bump" }));
    expect(d.rule).toBe("none");
  });

  it("rule 6: bump only fires on a scheduled increase week", () => {
    const s = computeWeekSignals(makeWeek(), allCompleted(3));
    const d = decideAdaptation(s, makeCtx({ nextWeek: makeNextSkeleton({ microWeek: "rebound" }) }));
    expect(d.rule).toBe("none");
  });

  it("rule 7: a normal solid week changes nothing", () => {
    const s = computeWeekSignals(makeWeek(), allCompleted(6));
    const d = decideAdaptation(s, makeCtx({ nextWeek: makeNextSkeleton({ microWeek: "rebound" }) }));
    expect(d.rule).toBe("none");
    expect(d.revisedTargets).toBeNull();
  });
});

// ============================================================
// Invariants (phase2-spec.md §4c)
// ============================================================

describe("bounds and invariants", () => {
  it("clampToBounds caps at ±20% of the original week", () => {
    const original = makeNextSkeleton({ targetMileage: 20, targetCardioMinutes: 200 });
    expect(clampToBounds({ targetMileage: 30, targetCardioMinutes: 300 }, original)).toEqual({
      targetMileage: 24,
      targetCardioMinutes: 240,
    });
    expect(clampToBounds({ targetMileage: 10, targetCardioMinutes: 100 }, original)).toEqual({
      targetMileage: 16,
      targetCardioMinutes: 160,
    });
  });

  it("hold is clamped when last week's volume is >20% below the next week's plan", () => {
    // Reviewed at 24 mi but next week originally planned 32 mi → floor at 25.6.
    const s = computeWeekSignals(makeWeek(), [
      log("mon", 0, "completed"),
      log("tue", 0, "completed"),
      log("wed", 0, "completed"),
    ]);
    const d = decideAdaptation(s, makeCtx({ nextWeek: makeNextSkeleton({ targetMileage: 32, targetCardioMinutes: 320 }) }));
    expect(d.rule).toBe("hold");
    expect(d.revisedTargets?.targetMileage).toBe(25.6);
    expect(d.revisedTargets?.targetCardioMinutes).toBe(256);
  });

  it("applyDecisionToWeek only touches volume targets and the micro label", () => {
    const next = makeNextSkeleton();
    const s = computeWeekSignals(makeWeek(), allCompleted(9));
    const d = decideAdaptation(s, makeCtx());
    const revised = applyDecisionToWeek(next, d);
    expect(revised.weekNumber).toBe(next.weekNumber);
    expect(revised.phase).toBe(next.phase);
    expect(revised.zoneTargets).toEqual(next.zoneTargets);
    expect(revised.days).toBe(next.days); // structure untouched
    expect(revised.targetMileage).not.toBe(next.targetMileage);
  });

  it("applyDecisionToWeek is a no-op for null revisions", () => {
    const next = makeNextSkeleton();
    const s = computeWeekSignals(makeWeek(), allCompleted(6));
    const d = decideAdaptation(s, makeCtx({ nextWeek: makeNextSkeleton({ microWeek: "rebound" }) }));
    expect(applyDecisionToWeek(next, d)).toBe(next);
  });
});

// ============================================================
// Streak
// ============================================================

describe("adherenceStreak", () => {
  it("counts consecutive ≥80% weeks backward and stops at a bad week", () => {
    const weeks = [3, 4, 5].map((n) => makeWeek(n));
    const goodLogs = (n: number) => allCompleted(5).map((l) => ({ ...l, weekNumber: n }));
    // Week 3 bad (nothing logged), weeks 4 and 5 good.
    const logs = [...goodLogs(4), ...goodLogs(5)];
    expect(adherenceStreak(weeks, logs, 5)).toBe(2);
    expect(adherenceStreak(weeks, goodLogs(5), 5)).toBe(1);
    expect(adherenceStreak(weeks, [], 5)).toBe(0);
  });
});
