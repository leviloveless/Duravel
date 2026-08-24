/**
 * The weekly summary tab and the week card report the SAME actual mileage
 * (Levi, 2026-08-23).
 *
 * His report: *"The actual mileage from week 3 does not match the mileage in the
 * weekly summary sheet for my fall prep program."* Seen live on `Fall prep`
 * before the fix:
 *
 *   | week | week card "Actual" | summary tab "Act" |
 *   |------|--------------------|-------------------|
 *   | 1    | 8.8 mi             | 8.6               |
 *   | 2    | **2.5 mi**         | **9.2**           |
 *   | 3    | **12.8 mi**        | **9.7**           |
 *
 * Two surfaces, two different sums. The card's line comes from
 * `computeWeekSignals`, which fell back to a session's WORK miles when a log
 * carried no typed distance and ignored hybrid mileage entirely; the summary
 * tab's column comes from `weekActualTimeByCategory`, which falls back to
 * `sessionMiles` — the whole session — and counts a hybrid's run legs. Week 2 is
 * the extreme: mostly-unlogged sessions, where the two fallbacks diverge most.
 *
 * `01a2267` moved the signals onto the same helpers. This file exists so the two
 * cannot drift apart again: they are DIFFERENT FUNCTIONS serving one number, and
 * that is exactly the arrangement that produced the bug.
 *
 * Imports only what `main` already has, so it fails there on BEHAVIOUR.
 */
import { describe, it, expect } from "vitest";
import type { ProgramWeek, WorkoutLog, ExtraWorkout } from "@/lib/schemas";
import { computeWeekSignals } from "@/lib/engine/adapt";
import { weekActualTimeByCategory } from "./week-actual-time";

function week(): ProgramWeek {
  return {
    weekNumber: 3,
    phase: "base",
    microWeek: "deload",
    summary: {
      totalCardioMinutes: 0,
      totalMileage: 0,
      zoneDistribution: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
    },
    days: [
      {
        day: "mon",
        sessions: [
          {
            kind: "run",
            runType: "easy",
            durationMin: 40,
            paceMinMile: "9:00",
            distanceMiles: 4.5,
            overheadMiles: 1.1,
            goalZone: 2,
          },
        ],
      },
      {
        day: "tue",
        sessions: [
          {
            kind: "hybrid",
            goalZone: 4,
            workMin: 38,
            overheadMiles: 1.2,
            elements: [{ exercise: "run", prescription: "1000m @ race pace" }],
          },
        ],
      },
      {
        day: "wed",
        sessions: [
          {
            kind: "lift",
            liftType: "full",
            movements: [{ pattern: "squat", sets: 4, repRange: "5-6" }],
          },
        ],
      },
      {
        day: "sat",
        sessions: [
          {
            kind: "run",
            runType: "long",
            durationMin: 70,
            paceMinMile: "9:15",
            distanceMiles: 7.5,
            overheadMiles: 1.1,
            goalZone: 2,
          },
        ],
      },
    ],
  } as unknown as ProgramWeek;
}

const log = (over: Partial<WorkoutLog>): WorkoutLog =>
  ({
    weekNumber: 3,
    day: "mon",
    sessionIndex: 0,
    status: "completed",
    rpe: 5,
    actuals: null,
    note: null,
    ...over,
  }) as WorkoutLog;

const extra = (over: Partial<ExtraWorkout> = {}): ExtraWorkout =>
  ({ id: "x1", weekNumber: 3, day: "thu", kind: "run", ...over }) as ExtraWorkout;

/** Both surfaces, same inputs, same number. */
function bothAgree(logs: WorkoutLog[], extras: ExtraWorkout[] = []) {
  const w = week();
  const card = computeWeekSignals(w, logs, extras);
  const table = weekActualTimeByCategory(w, logs, extras);
  return {
    card: card.actualMileage,
    table: table.miles,
    cardMin: card.actualCardioMinutes,
    tableMin: table.cardioMinutes,
  };
}

describe("the card's Actual line and the summary's Act column are one number", () => {
  it("agrees when nothing carries a typed distance — the case that broke", () => {
    const r = bothAgree([log({ day: "mon" }), log({ day: "sat" })]);
    expect(r.table).toBeCloseTo(r.card, 1);
    expect(r.tableMin).toBe(r.cardMin);
  });

  it("agrees when a hybrid is logged — its run legs are miles on both sides", () => {
    const r = bothAgree([log({ day: "tue" })]);
    expect(r.table).toBeCloseTo(r.card, 1);
    expect(r.table).toBeGreaterThan(0);
  });

  it("agrees on a partial", () => {
    const r = bothAgree([log({ day: "sat", status: "partial" })]);
    expect(r.table).toBeCloseTo(r.card, 1);
  });

  it("agrees when the watch reported a real distance", () => {
    const r = bothAgree([log({ day: "sat", actuals: { distanceMiles: 9.2, durationMin: 84 } })]);
    expect(r.table).toBeCloseTo(r.card, 1);
    expect(r.table).toBeCloseTo(9.2, 1);
  });

  it("agrees with an extra in the mix", () => {
    const r = bothAgree([log({ day: "mon" })], [extra({ durationMin: 30, distanceMiles: 3.1 })]);
    expect(r.table).toBeCloseTo(r.card, 1);
    expect(r.tableMin).toBe(r.cardMin);
  });
});
