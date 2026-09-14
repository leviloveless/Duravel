import { describe, it, expect } from "vitest";
import type { ProgramWeek, Session, WorkoutLog } from "@/lib/schemas";
import {
  asHours,
  countdown,
  formatSplit,
  stationBands,
  weeklyHours,
  zoneMix,
} from "@/lib/dashboard/derive";
import { sessionTiming } from "@/lib/session-volume";

// ── fixtures ────────────────────────────────────────────────────────────────

function easyRun(durationMin: number, goalZone = 2): Session {
  return {
    kind: "run",
    runType: "easy",
    durationMin,
    distanceMiles: 5,
    goalZone,
    description: "Easy run",
  } as unknown as Session;
}

function week(weekNumber: number, sessions: Session[][]): ProgramWeek {
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  return {
    weekNumber,
    phase: "base",
    microWeek: "build",
    summary: {
      totalCardioMinutes: 0,
      totalMileage: 0,
      zoneDistribution: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    },
    days: DAYS.map((day, i) => ({ day, sessions: sessions[i] ?? [] })),
  } as unknown as ProgramWeek;
}

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

describe("weeklyHours", () => {
  const w1 = week(1, [[easyRun(60)], [easyRun(40)]]);

  it("measures planned time as TOTAL, not the main set", () => {
    // The whole point: sessionTiming adds warm-up and cool-down, so planned
    // minutes must exceed the sum of durationMin. If this ever equals 100 the
    // work-vs-total bug has come back for a twelfth time.
    const [row] = weeklyHours([w1], [], [], 0);
    const expected = sessionTiming(easyRun(60)).total + sessionTiming(easyRun(40)).total;
    expect(row!.plannedMin).toBe(expected);
    expect(row!.plannedMin).toBeGreaterThan(100);
  });

  it("reports a future week as null rather than zero", () => {
    // Zero would draw a bar at the baseline and read as a missed week.
    const [row] = weeklyHours([w1], [], [], 0);
    expect(row!.completedMin).toBeNull();
  });

  it("counts a completed session in full", () => {
    const [row] = weeklyHours([w1], [log(1, "mon", 0, "completed")], [], 1);
    expect(row!.completedMin).toBe(Math.round(sessionTiming(easyRun(60)).total));
  });

  it("counts a partial session as half", () => {
    const [row] = weeklyHours([w1], [log(1, "mon", 0, "partial")], [], 1);
    expect(row!.completedMin).toBe(Math.round(sessionTiming(easyRun(60)).total / 2));
  });

  it("counts a skipped session as nothing", () => {
    const [row] = weeklyHours([w1], [log(1, "mon", 0, "skipped")], [], 1);
    expect(row!.completedMin).toBe(0);
  });

  it("adds off-plan extras, the way compliance does", () => {
    const extras = [{ weekNumber: 1, durationMin: 30 }] as never;
    const [row] = weeklyHours([w1], [], extras, 1);
    expect(row!.completedMin).toBe(30);
  });
});

describe("asHours", () => {
  it("rounds to one decimal", () => {
    expect(asHours(95)).toBe(1.6);
    expect(asHours(600)).toBe(10);
  });
});

describe("zoneMix", () => {
  it("carries the engine's 20/60/10/5/5 target through", () => {
    const mix = zoneMix([]);
    expect(mix.map((m) => m.target)).toEqual([20, 60, 10, 5, 5]);
  });

  it("returns zeros rather than NaN when there is nothing to measure", () => {
    expect(zoneMix([]).every((m) => m.actual === 0)).toBe(true);
  });

  it("splits minutes by zone", () => {
    const w = week(1, [[easyRun(60, 2)], [easyRun(60, 4)]]);
    const mix = zoneMix([w]);
    expect(mix.find((m) => m.zone === 2)!.actual).toBe(50);
    expect(mix.find((m) => m.zone === 4)!.actual).toBe(50);
  });

  it("always sums to exactly 100", () => {
    // Three equal shares are 33.33% each; five independently-rounded numbers
    // reaching 99 is what the largest-remainder pass exists to prevent.
    const w = week(1, [[easyRun(30, 1)], [easyRun(30, 2)], [easyRun(30, 3)]]);
    const mix = zoneMix([w]);
    expect(mix.reduce((s, m) => s + m.actual, 0)).toBe(100);
  });
});

describe("stationBands", () => {
  // Male / Open bands from lib/engine/hyrox-standards.ts.
  const marks = {
    hyroxRunTotal: "34:25", // F 1720, C 2360 → 2065 s
    hyroxWallBalls: "6:45", // F 300,  C 510  → 405 s
    hyroxFarmersCarry: "1:58", // F 100,  C 165  → 118 s
  };

  it("places a split between the novice ceiling and the elite floor", () => {
    const [run] = stationBands(marks, { sex: "male", division: "open", age: 27 });
    // (2360 - 2065) / (2360 - 1720) = 0.4609…
    expect(run!.position).toBeCloseTo(0.4609, 3);
  });

  it("rates a strong station above a mid-pack one", () => {
    const rows = stationBands(marks, { sex: "male", division: "open", age: 27 });
    const carry = rows.find((r) => r.key === "hyroxFarmersCarry")!;
    const wall = rows.find((r) => r.key === "hyroxWallBalls")!;
    expect(carry.position).toBeGreaterThan(wall.position);
  });

  it("skips benchmarks that are missing or unparseable", () => {
    const rows = stationBands({ hyroxRow: "not a time", hyroxSkiErg: "4:08" }, {});
    expect(rows.map((r) => r.key)).toEqual(["hyroxSkiErg"]);
  });

  it("returns nothing at all when there are no benchmarks", () => {
    expect(stationBands(null, {})).toEqual([]);
    expect(stationBands({}, {})).toEqual([]);
  });

  it("flags nothing when every station is equally developed", () => {
    // Nothing is below average, so there is no weakness to point at — and
    // flagging three anyway would be advice the data does not support.
    // Both land at exactly 0.60 of their own band: ski F225/C280 → 247 s, row
    // F235/C330 → 273 s. Chosen rather than eyeballed, because "roughly equal"
    // times are NOT equal positions — the bands have different widths.
    const even = { hyroxSkiErg: "4:07", hyroxRow: "4:33" };
    const rows = stationBands(even, { sex: "male" });
    expect(rows.some((r) => r.focus)).toBe(false);
  });

  it("flags the weakest by POSITION, not by raw seconds", () => {
    // The run is by far the slowest station in seconds and must not be flagged
    // just for that — it is mid-band here, while wall balls are worse.
    const rows = stationBands(marks, { sex: "male", division: "open", age: 27 });
    const flagged = rows.filter((r) => r.focus).map((r) => r.key);
    expect(flagged).toContain("hyroxWallBalls");
    expect(flagged).not.toContain("hyroxFarmersCarry");
  });

  it("puts a goal split ahead of the current one", () => {
    const rows = stationBands(marks, {
      sex: "male",
      division: "open",
      age: 27,
      goalFinishSeconds: 2000, // well inside the current total
    });
    for (const r of rows) {
      expect(r.goalPosition, r.key).not.toBeNull();
      expect(r.goalPosition!, r.key).toBeGreaterThanOrEqual(r.position);
    }
  });

  it("offers no goal marker when the goal is slower than today", () => {
    const rows = stationBands(marks, { sex: "male", goalFinishSeconds: 99_999 });
    expect(rows.every((r) => r.goalPosition === null)).toBe(true);
  });

  it("moves the band for a masters athlete", () => {
    const young = stationBands(marks, { sex: "male", age: 27 })[0]!;
    const older = stationBands(marks, { sex: "male", age: 55 })[0]!;
    // Older bands are slower, so the same time sits further toward elite.
    expect(older.position).toBeGreaterThan(young.position);
  });
});

describe("formatSplit", () => {
  it("prints mm:ss under an hour", () => {
    expect(formatSplit(405)).toBe("6:45");
    expect(formatSplit(65)).toBe("1:05");
  });
  it("prints h:mm:ss past an hour", () => {
    expect(formatSplit(4630)).toBe("1:17:10");
  });
});

describe("countdown", () => {
  const from = new Date(2026, 8, 13); // 13 Sep 2026, local

  it("counts whole days to the race", () => {
    expect(countdown("2026-11-28", from)).toEqual({ days: 76, weeks: 10, spareDays: 6 });
  });

  it("reads race day as zero, not as past", () => {
    expect(countdown("2026-09-13", from)).toEqual({ days: 0, weeks: 0, spareDays: 0 });
  });

  it("returns null once the race has gone", () => {
    expect(countdown("2026-09-12", from)).toBeNull();
  });

  it("is unaffected by the local clock, because a countdown is a date difference", () => {
    // Late evening local, which is the next UTC day — the count must not shift.
    const lateEvening = new Date(2026, 8, 13, 23, 30);
    expect(countdown("2026-11-28", lateEvening)!.days).toBe(76);
  });

  it("rejects a malformed date", () => {
    expect(countdown("not-a-date", from)).toBeNull();
  });
});
