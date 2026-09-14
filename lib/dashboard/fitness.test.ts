import { describe, it, expect } from "vitest";
import {
  FATIGUE_DAYS,
  FITNESS_DAYS,
  addDays,
  dailyLoad,
  daysBetween,
  fitnessSeries,
  formState,
  sessionLoad,
} from "@/lib/dashboard/fitness";
import type { ProgramWeek, Session, WorkoutLog } from "@/lib/schemas";
import { sessionTiming } from "@/lib/session-volume";

function run(durationMin: number, goalZone = 2): Session {
  return {
    kind: "run",
    runType: "easy",
    durationMin,
    distanceMiles: 5,
    goalZone,
    description: "Easy run",
  } as unknown as Session;
}

describe("date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });
  it("adds days across a leap day", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("counts days between dates", () => {
    expect(daysBetween("2026-09-13", "2026-11-28")).toBe(76);
  });
  it("is unaffected by the local zone, because these are calendar dates", () => {
    // Computed in UTC on purpose — see the note in fitness.ts. If this ever
    // depends on TZ it will fail in America/* and pass in UTC, which is the
    // exact bug that shipped once already.
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST boundary
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26"); // EU DST boundary
  });
});

describe("sessionLoad", () => {
  it("weights a hard session above an easy one of the same length", () => {
    const easy = sessionLoad(run(60, 2) as never, "completed");
    const hard = sessionLoad(run(60, 5) as never, "completed");
    expect(hard).toBeGreaterThan(easy);
  });

  it("counts a skipped session as nothing", () => {
    expect(sessionLoad(run(60) as never, "skipped")).toBe(0);
  });

  it("counts a partial session as half, matching the hours chart", () => {
    expect(sessionLoad(run(60) as never, "partial")).toBeCloseTo(
      sessionLoad(run(60) as never, "completed") / 2,
      6,
    );
  });

  it("measures TOTAL session time, not the main set", () => {
    // Zone 2 has weight 1, so load should equal total minutes exactly — and
    // total exceeds durationMin because of warm-up and cool-down.
    const load = sessionLoad(run(60, 2) as never, "completed");
    expect(load).toBeCloseTo(sessionTiming(run(60)).total, 6);
    expect(load).toBeGreaterThan(60);
  });
});

describe("fitnessSeries", () => {
  const flat = (from: string, days: number, perDay: number) => {
    const m = new Map<string, number>();
    for (let i = 0; i <= days; i++) m.set(addDays(from, i), perDay);
    return m;
  };

  it("emits one point per calendar day, rest days included", () => {
    const s = fitnessSeries(new Map(), "2026-09-01", "2026-09-10");
    expect(s).toHaveLength(10);
    expect(s[0]!.date).toBe("2026-09-01");
    expect(s[9]!.date).toBe("2026-09-10");
  });

  it("starts near zero and climbs with steady training", () => {
    const s = fitnessSeries(flat("2026-01-01", 60, 100), "2026-01-01", "2026-03-02");
    // Day one already carries a little fitness: the curve INCLUDES that day's
    // session, the same way CTL does. Only FORM is a morning number, read from
    // yesterday — asserted separately below.
    expect(s[0]!.fitness).toBeGreaterThan(0);
    expect(s[0]!.fitness).toBeLessThan(5);
    expect(s[30]!.fitness).toBeGreaterThan(s[10]!.fitness);
    expect(s[60]!.fitness).toBeGreaterThan(s[30]!.fitness);
  });

  it("moves fatigue faster than fitness, which is the whole point", () => {
    const s = fitnessSeries(flat("2026-01-01", 20, 100), "2026-01-01", "2026-01-21");
    const last = s[s.length - 1]!;
    expect(last.fatigue).toBeGreaterThan(last.fitness);
  });

  it("decays both curves on a rest block, and fatigue falls faster", () => {
    const load = flat("2026-01-01", 30, 100);
    const s = fitnessSeries(load, "2026-01-01", "2026-02-14"); // 14 days off at the end
    const lastTrained = s.find((p) => p.date === "2026-01-31")!;
    const end = s[s.length - 1]!;
    expect(end.fatigue).toBeLessThan(lastTrained.fatigue);
    expect(end.fitness).toBeLessThan(lastTrained.fitness);
    // Freshness: form swings positive during a taper. This is the behaviour the
    // chart exists to show.
    expect(end.form).toBeGreaterThan(lastTrained.form);
  });

  it("approaches the daily load as its asymptote under constant training", () => {
    // An EWMA of a constant converges on that constant; a very long block should
    // put fatigue close to it, since 7 days is short relative to the block.
    const s = fitnessSeries(flat("2026-01-01", 200, 100), "2026-01-01", "2026-07-20");
    expect(s[s.length - 1]!.fatigue).toBeGreaterThan(95);
  });

  it("reads form as a MORNING number — before the day's session", () => {
    // Day 0 has load but form must still be 0: you have not trained yet.
    const m = new Map([["2026-01-01", 500]]);
    const s = fitnessSeries(m, "2026-01-01", "2026-01-02");
    expect(s[0]!.form).toBe(0);
    expect(s[1]!.form).toBeLessThan(0);
  });

  it("honours a seed so a window can continue an earlier one", () => {
    const s = fitnessSeries(new Map(), "2026-01-01", "2026-01-02", { fitness: 50, fatigue: 20 });
    expect(s[0]!.form).toBe(30);
  });

  it("returns nothing when the range is inverted", () => {
    expect(fitnessSeries(new Map(), "2026-02-01", "2026-01-01")).toEqual([]);
  });

  it("uses the documented time constants", () => {
    expect(FITNESS_DAYS).toBe(42);
    expect(FATIGUE_DAYS).toBe(7);
  });
});

describe("formState", () => {
  it("scales with fitness rather than using absolute numbers", () => {
    // −15 form is a hard block for a big engine and a crisis for a small one.
    expect(formState({ fitness: 100, form: -15 })).toBe("productive");
    expect(formState({ fitness: 30, form: -15 })).toBe("overreaching");
  });

  it("calls a positive swing fresh", () => {
    expect(formState({ fitness: 80, form: 12 })).toBe("fresh");
  });

  it("calls a balanced week neutral", () => {
    expect(formState({ fitness: 80, form: -4 })).toBe("neutral");
  });

  it("does not divide by zero at a cold start", () => {
    expect(formState({ fitness: 0, form: 0 })).toBe("neutral");
  });
});

describe("dailyLoad", () => {
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const week = (n: number, sessions: Session[][]): ProgramWeek =>
    ({
      weekNumber: n,
      phase: "base",
      microWeek: "build",
      summary: {
        totalCardioMinutes: 0,
        totalMileage: 0,
        zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
      },
      days: DAYS.map((day, i) => ({ day, sessions: sessions[i] ?? [] })),
    }) as unknown as ProgramWeek;

  const startOf = (n: number) => addDays("2026-01-05", (n - 1) * 7); // Mon 5 Jan 2026

  it("places a logged session on its own calendar day", () => {
    const logs: WorkoutLog[] = [
      {
        weekNumber: 1,
        day: "wed",
        sessionIndex: 0,
        status: "completed",
        rpe: null,
        actuals: null,
        note: null,
      } as WorkoutLog,
    ];
    const m = dailyLoad([week(1, [[], [], [run(60)]])], logs, [], startOf);
    expect([...m.keys()]).toEqual(["2026-01-07"]); // Wednesday
  });

  it("ignores a planned session that was never logged", () => {
    const m = dailyLoad([week(1, [[run(60)]])], [], [], startOf);
    expect(m.size).toBe(0);
  });

  it("counts extras on their day", () => {
    const extras = [{ weekNumber: 1, day: "fri", durationMin: 40, goalZone: 2 }] as never;
    const m = dailyLoad([week(1, [])], [], extras, startOf);
    expect(m.get("2026-01-09")).toBe(40);
  });

  it("sums two sessions landing on the same day", () => {
    const logs: WorkoutLog[] = [
      {
        weekNumber: 1,
        day: "mon",
        sessionIndex: 0,
        status: "completed",
        rpe: null,
        actuals: null,
        note: null,
      } as WorkoutLog,
      {
        weekNumber: 1,
        day: "mon",
        sessionIndex: 1,
        status: "completed",
        rpe: null,
        actuals: null,
        note: null,
      } as WorkoutLog,
    ];
    const m = dailyLoad([week(1, [[run(30), run(30)]])], logs, [], startOf);
    expect(m.get("2026-01-05")).toBeCloseTo(sessionLoad(run(30) as never, "completed") * 2, 6);
  });
});
