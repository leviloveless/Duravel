import { describe, it, expect } from "vitest";
import { computeAdherence } from "./adherence";
import type { ProgramData, WorkoutLog } from "@/lib/schemas";

/** Minimal program: 2 weeks, each with a run + lift on mon and a race slot. */
function program(): ProgramData {
  const week = (weekNumber: number) => ({
    weekNumber,
    phase: "base",
    microWeek: "increase",
    summary: { totalCardioMinutes: 0, totalMileage: 0, zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } },
    days: [
      {
        day: "mon",
        sessions: [
          { kind: "run", runType: "easy", durationMin: 40, paceMinMile: "9:00", distanceMiles: 4, goalZone: 2 },
          { kind: "lift", liftType: "full", movements: [] },
        ],
      },
      {
        day: "wed",
        sessions: [{ kind: "race", priority: "A" }],
      },
    ],
  });
  return { generatedAt: "2026-07-01", weeks: [week(1), week(2)] } as unknown as ProgramData;
}

describe("computeAdherence", () => {
  it("counts planned non-race sessions and excludes races", () => {
    const a = computeAdherence(program(), []);
    // 2 non-race sessions/week × 2 weeks = 4 planned; race slot ignored.
    expect(a.overall.planned).toBe(4);
    expect(a.overall.completed).toBe(0);
    expect(a.overall.completionRate).toBe(0);
  });

  it("scores completion and partials, and sums logged minutes", () => {
    const logs: WorkoutLog[] = [
      { weekNumber: 1, day: "mon", sessionIndex: 0, status: "completed", rpe: 6, actuals: { durationMin: 42 }, note: null },
      { weekNumber: 1, day: "mon", sessionIndex: 1, status: "partial", rpe: 5, actuals: { durationMin: 20 }, note: null },
    ];
    const a = computeAdherence(program(), logs);
    const w1 = a.weeks.find((w) => w.weekNumber === 1)!;
    expect(w1.completed).toBe(1);
    expect(w1.partial).toBe(1);
    expect(w1.logged).toBe(2);
    expect(w1.loggedMinutes).toBe(62);
    // (1 + 0.5·1) / 2 = 0.75
    expect(w1.completionRate).toBeCloseTo(0.75, 5);
    expect(a.byKind.run!.completed).toBe(1);
    expect(a.byKind.lift!.completed).toBe(0);
  });

  it("respects throughWeek so future weeks don't count as missed", () => {
    const a = computeAdherence(program(), [], 1);
    expect(a.overall.planned).toBe(2); // only week 1
    expect(a.weeks).toHaveLength(1);
  });

  it("counts skipped separately from missed", () => {
    const logs: WorkoutLog[] = [
      { weekNumber: 1, day: "mon", sessionIndex: 0, status: "skipped", rpe: null, actuals: null, note: null },
    ];
    const a = computeAdherence(program(), logs, 1);
    const w1 = a.weeks[0]!;
    expect(w1.skipped).toBe(1);
    expect(w1.missed).toBe(1); // 2 planned − 0 logged − 1 skipped
  });
});
