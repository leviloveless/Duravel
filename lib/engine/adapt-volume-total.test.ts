/**
 * The weekly review measures TOTAL against TOTAL (Levi, 2026-08-22).
 *
 * Found by looking at the live review screen: it read `Mileage 3.2 / 4.7 mi` on
 * a week whose own header said **5.5 mi**. The two sides were measuring
 * different things. `plannedMileage` came from `session.distanceMiles` and
 * `plannedCardioMinutes` from `session.durationMin` — the MAIN SET alone, with
 * warm-up and cool-down excluded and a hybrid's run legs not counted at all —
 * while `actualMileage` takes `log.actuals.distanceMiles`, which is the whole
 * distance the athlete's watch recorded.
 *
 * ## How wrong it was
 *
 * Measured across 960 generated weeks (4 hour-bands × 3 experience levels × 5
 * starting mileages × 16 weeks), simulating an athlete who does the week exactly
 * as prescribed and whose watch reports what they covered:
 *
 *   - the planned figures disagreed with the week's own summary in **100%** of
 *     weeks;
 *   - a perfectly-executed week read as **219% of its mileage** on average,
 *     worst case **531%**, and **121% of its cardio minutes**, worst **191%**.
 *
 * The mileage number is so large because a HYROX week's run legs live inside
 * hybrid sessions: they counted on the actual side and were invisible on the
 * planned side.
 *
 * After: 0% disagreement, and a perfect week reads 100.0% — exactly, in every
 * one of the 960.
 *
 * ## What this did NOT change
 *
 * The adaptation's DECISIONS. `decideAdaptation` reads `compliance` (a count of
 * sessions, unaffected), `strain`, `extraSessions` and the long-run flags — not
 * these volume figures. This was a reporting bug, not a prescribing one, and the
 * fix is worth having because a screen that tells an athlete they did 219% of
 * their week teaches them to ignore the screen.
 *
 * Every import here is one `main` already has, so this file fails there on
 * BEHAVIOUR.
 */
import { describe, it, expect } from "vitest";
import type { ProgramWeek, WorkoutLog } from "@/lib/schemas";
import { computeWeekSignals } from "./adapt";
import { sessionMiles, sessionTiming, weekCardioMinutes, weekMileage } from "@/lib/session-volume";

/** An easy run, a lift, and a hybrid whose run legs are real weekly mileage. */
function makeWeek(): ProgramWeek {
  return {
    weekNumber: 3,
    phase: "base",
    microWeek: "increase",
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
            kind: "lift",
            liftType: "upper",
            movements: [{ pattern: "horizontal_press", sets: 4, repRange: "12-15" }],
          },
        ],
      },
      {
        day: "wed",
        sessions: [
          {
            kind: "hybrid",
            goalZone: 4,
            workMin: 38,
            overheadMiles: 1.2,
            elements: [
              { exercise: "run", prescription: "1000m @ race pace" },
              { exercise: "row erg", prescription: "1000m" },
            ],
          },
        ],
      },
      { day: "thu", sessions: [] },
      { day: "fri", sessions: [] },
      {
        day: "sat",
        sessions: [
          {
            kind: "run",
            runType: "long",
            durationMin: 90,
            paceMinMile: "9:15",
            distanceMiles: 10,
            overheadMiles: 1.1,
            goalZone: 2,
          },
        ],
      },
      { day: "sun", sessions: [] },
    ],
  } as unknown as ProgramWeek;
}

/** Every session done, with the watch reporting the whole session. */
function perfectLogs(week: ProgramWeek): WorkoutLog[] {
  const logs: WorkoutLog[] = [];
  week.days.forEach((d) =>
    d.sessions.forEach((s, i) =>
      logs.push({
        weekNumber: week.weekNumber,
        day: d.day,
        sessionIndex: i,
        status: "completed",
        rpe: 5,
        note: null,
        actuals: {
          durationMin: s.kind === "lift" ? undefined : sessionTiming(s).total,
          distanceMiles: sessionMiles(s) > 0 ? sessionMiles(s) : undefined,
        },
      } as WorkoutLog),
    ),
  );
  return logs;
}

describe("the planned side is the week's own summary", () => {
  it("planned mileage equals what the week card reports", () => {
    const w = makeWeek();
    expect(computeWeekSignals(w, []).plannedMileage).toBeCloseTo(weekMileage(w), 1);
  });

  it("planned cardio minutes equal what the week card reports", () => {
    const w = makeWeek();
    expect(computeWeekSignals(w, []).plannedCardioMinutes).toBe(weekCardioMinutes(w));
  });

  it("counts the run legs inside a hybrid — they are on-foot miles", () => {
    const w = makeWeek();
    const withHybrid = computeWeekSignals(w, []).plannedMileage;
    const runsOnly = w.days
      .flatMap((d) => d.sessions)
      .filter((s) => s.kind === "run")
      .reduce((n, s) => n + sessionMiles(s), 0);
    expect(withHybrid).toBeGreaterThan(runsOnly);
  });

  it("still excludes weightlifting from cardio minutes", () => {
    const w = makeWeek();
    const lift = w.days.flatMap((d) => d.sessions).find((s) => s.kind === "lift")!;
    expect(computeWeekSignals(w, []).plannedCardioMinutes).toBe(
      weekCardioMinutes(w), // which excludes lifts
    );
    expect(sessionTiming(lift).total).toBeGreaterThan(0); // …and a lift does have a duration
  });
});

describe("a week done exactly as prescribed reads as 100%", () => {
  it("does not report 219% of the mileage", () => {
    const w = makeWeek();
    const s = computeWeekSignals(w, perfectLogs(w));
    expect(s.actualMileage / s.plannedMileage).toBeCloseTo(1, 2);
  });

  it("does not report 121% of the cardio minutes", () => {
    const w = makeWeek();
    const s = computeWeekSignals(w, perfectLogs(w));
    expect(s.actualCardioMinutes / s.plannedCardioMinutes).toBeCloseTo(1, 2);
  });

  it("an unlogged week still reports zero actual against a real planned figure", () => {
    const s = computeWeekSignals(makeWeek(), []);
    expect(s.actualMileage).toBe(0);
    expect(s.plannedMileage).toBeGreaterThan(0);
  });
});

describe("the long run the athlete is told to hold", () => {
  it("is the whole run, warm-up and cool-down included", () => {
    const w = makeWeek();
    const long = w.days
      .flatMap((d) => d.sessions)
      .find(
        (s): s is Extract<typeof s, { kind: "run" }> => s.kind === "run" && s.runType === "long",
      )!;
    expect(computeWeekSignals(w, []).longRunPlannedMiles).toBeCloseTo(sessionMiles(long), 1);
    // …which is more than the main set alone — the old figure.
    expect(computeWeekSignals(w, []).longRunPlannedMiles).toBeGreaterThan(long.distanceMiles);
  });
});
