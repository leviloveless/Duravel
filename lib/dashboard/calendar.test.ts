import { describe, it, expect } from "vitest";
import {
  buildMonth,
  daysInMonth,
  mondayOnOrBefore,
  monthLabel,
  monthStart,
  shiftMonth,
} from "@/lib/dashboard/calendar";
import type { ProgramWeek, Session, WorkoutLog } from "@/lib/schemas";
import { addDays } from "@/lib/dashboard/fitness";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function run(durationMin: number): Session {
  return {
    kind: "run",
    runType: "easy",
    durationMin,
    distanceMiles: 5,
    goalZone: 2,
    description: "Easy run",
  } as unknown as Session;
}

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

const log = (w: number, day: string, i: number, status: WorkoutLog["status"]): WorkoutLog =>
  ({
    weekNumber: w,
    day,
    sessionIndex: i,
    status,
    rpe: null,
    actuals: null,
    note: null,
  }) as WorkoutLog;

describe("date maths", () => {
  it("knows month lengths, leap years included", () => {
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it("finds the Monday on or before a date", () => {
    expect(mondayOnOrBefore("2026-09-13")).toBe("2026-09-07"); // a Sunday
    expect(mondayOnOrBefore("2026-09-07")).toBe("2026-09-07"); // already Monday
    expect(mondayOnOrBefore("2026-09-08")).toBe("2026-09-07");
  });

  it("steps months across a year boundary in both directions", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 9, 0)).toEqual({ year: 2026, month: 9 });
  });

  it("labels a month", () => {
    expect(monthLabel(2026, 9)).toBe("September 2026");
    expect(monthStart(2026, 9)).toBe("2026-09-01");
  });
});

describe("buildMonth", () => {
  const startOf = (n: number) => addDays("2026-09-07", (n - 1) * 7); // Mon 7 Sep 2026

  it("always returns whole weeks, and never fewer than six rows", () => {
    // A grid that changes height as you page through months reads as broken.
    for (let m = 1; m <= 12; m++) {
      const grid = buildMonth(2026, m, "2026-09-13", []);
      expect(grid.length, `month ${m}`).toBeGreaterThanOrEqual(6);
      for (const wk of grid) expect(wk.days).toHaveLength(7);
    }
  });

  it("starts every row on a Monday", () => {
    for (const wk of buildMonth(2026, 9, "2026-09-13", [])) {
      expect(mondayOnOrBefore(wk.startDate)).toBe(wk.startDate);
    }
  });

  it("marks padding days as outside the month", () => {
    // 1 Sep 2026 is a Tuesday, so the grid opens with Monday 31 August.
    const grid = buildMonth(2026, 9, "2026-09-13", []);
    expect(grid[0]!.days[0]!.date).toBe("2026-08-31");
    expect(grid[0]!.days[0]!.inMonth).toBe(false);
    expect(grid[0]!.days[1]!.date).toBe("2026-09-01");
    expect(grid[0]!.days[1]!.inMonth).toBe(true);
  });

  it("marks today exactly once", () => {
    const grid = buildMonth(2026, 9, "2026-09-13", []);
    const todays = grid.flatMap((w) => w.days).filter((d) => d.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0]!.date).toBe("2026-09-13");
  });

  it("places a session on its own calendar day", () => {
    const grid = buildMonth(2026, 9, "2026-09-13", [
      {
        id: "p1",
        weeks: [week(1, [[], [], [run(60)]])],
        logs: [],
        extras: [],
        weekStartISO: startOf,
      },
    ]);
    const withSessions = grid.flatMap((w) => w.days).filter((d) => d.sessions.length > 0);
    expect(withSessions).toHaveLength(1);
    expect(withSessions[0]!.date).toBe("2026-09-09"); // Wednesday of week 1
  });

  it("sums planned minutes per row from TOTAL session time", () => {
    const grid = buildMonth(2026, 9, "2026-09-13", [
      {
        id: "p1",
        weeks: [week(1, [[run(60)], [run(40)]])],
        logs: [],
        extras: [],
        weekStartISO: startOf,
      },
    ]);
    const row = grid.find((w) => w.startDate === "2026-09-07")!;
    // Warm-up and cool-down are included, so this must exceed 100.
    expect(row.plannedMin).toBeGreaterThan(100);
    expect(row.completedMin).toBe(0);
  });

  it("counts a partial session as half and a skipped one as nothing", () => {
    const weeks = [week(1, [[run(60)], [run(60)], [run(60)]])];
    const full = buildMonth(2026, 9, "2026-09-13", [
      { id: "p1", weeks, logs: [log(1, "mon", 0, "completed")], extras: [], weekStartISO: startOf },
    ]).find((w) => w.startDate === "2026-09-07")!;
    const half = buildMonth(2026, 9, "2026-09-13", [
      { id: "p1", weeks, logs: [log(1, "tue", 0, "partial")], extras: [], weekStartISO: startOf },
    ]).find((w) => w.startDate === "2026-09-07")!;
    const none = buildMonth(2026, 9, "2026-09-13", [
      { id: "p1", weeks, logs: [log(1, "wed", 0, "skipped")], extras: [], weekStartISO: startOf },
    ]).find((w) => w.startDate === "2026-09-07")!;

    expect(half.completedMin).toBeCloseTo(full.completedMin / 2, 0);
    expect(none.completedMin).toBe(0);
  });

  it("adds extras to completed time", () => {
    const extras = [
      { weekNumber: 1, day: "fri", durationMin: 45, kind: "run", title: "Parkrun" },
    ] as never;
    const row = buildMonth(2026, 9, "2026-09-13", [
      { id: "p1", weeks: [week(1, [])], logs: [], extras, weekStartISO: startOf },
    ]).find((w) => w.startDate === "2026-09-07")!;
    expect(row.completedMin).toBe(45);
    expect(row.days[4]!.extras[0]!.title).toBe("Parkrun");
  });

  it("labels a row with its program week number, and leaves others null", () => {
    const grid = buildMonth(2026, 9, "2026-09-13", [
      { id: "p1", weeks: [week(1, []), week(2, [])], logs: [], extras: [], weekStartISO: startOf },
    ]);
    expect(grid.find((w) => w.startDate === "2026-09-07")!.weekNumber).toBe(1);
    expect(grid.find((w) => w.startDate === "2026-09-14")!.weekNumber).toBe(2);
    expect(grid.find((w) => w.startDate === "2026-08-31")!.weekNumber).toBeNull();
  });

  it("shows sessions from more than one program at once", () => {
    const grid = buildMonth(2026, 9, "2026-09-13", [
      { id: "p1", weeks: [week(1, [[run(60)]])], logs: [], extras: [], weekStartISO: startOf },
      { id: "p2", weeks: [week(1, [[run(30)]])], logs: [], extras: [], weekStartISO: startOf },
    ]);
    const monday = grid.flatMap((w) => w.days).find((d) => d.date === "2026-09-07")!;
    expect(monday.sessions.map((s) => s.programId).sort()).toEqual(["p1", "p2"]);
  });

  it("copes with an empty month", () => {
    const grid = buildMonth(2026, 9, "2026-09-13", []);
    expect(grid.every((w) => w.plannedMin === 0 && w.completedMin === 0)).toBe(true);
  });

  it("handles a month that begins on a Monday without an empty leading row", () => {
    // June 2026 starts on a Monday.
    const grid = buildMonth(2026, 6, "2026-09-13", []);
    expect(grid[0]!.days[0]!.date).toBe("2026-06-01");
    expect(grid[0]!.days[0]!.inMonth).toBe(true);
  });
});
