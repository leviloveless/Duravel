/**
 * The weekly summary's ACTUAL columns (Levi, 2026-08-22).
 *
 * The complaint that produced this file: "the weekly summary tab is not showing
 * the actual completed cardio time, weightlifting time." Two separate holes:
 * the Training-time block had no actual column at ALL, and the one actual column
 * that did exist — cardio — read `log.actuals.durationMin`, which is OPTIONAL in
 * the log form. Ticking a session complete without typing minutes is the normal
 * way to log, so the normal way to log produced a dash.
 *
 * Every case below is one of those two holes, or a trap in closing them.
 *
 * This file imports a module `main` does not have, so it fails there by ABSENCE
 * rather than on behaviour — the weaker kind of proof, and worth saying plainly.
 * The rename half of this change is guarded on behaviour instead, in
 * `lib/session-volume-hybrid.test.ts`.
 */
import { describe, it, expect } from "vitest";
import type { ExtraWorkout, Session, WorkoutLog } from "@/lib/schemas";
import { weekActualTimeByCategory, groupExtrasByWeek } from "./week-actual-time";
import { sessionTiming, weekTimeByCategory } from "@/lib/session-volume";

/** An easy run: 30 min of work, plus the 5+5 warm-up/cool-down the engine adds. */
const RUN: Session = {
  kind: "run",
  runType: "easy",
  durationMin: 30,
  distanceMiles: 3,
} as Session;

const LIFT: Session = { kind: "lift", liftType: "full", exercises: [] } as unknown as Session;

const HYBRID: Session = {
  kind: "hybrid",
  workMin: 40,
  elements: [],
} as unknown as Session;

function week(sessions: Session[][] = [[RUN], [LIFT]]) {
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  return { days: sessions.map((s, i) => ({ day: days[i]!, sessions: s })) };
}

function log(over: Partial<WorkoutLog> = {}): WorkoutLog {
  return {
    weekNumber: 1,
    day: "mon",
    sessionIndex: 0,
    status: "completed",
    rpe: 6,
    actuals: null,
    note: null,
    ...over,
  } as WorkoutLog;
}

function extra(over: Partial<ExtraWorkout> = {}): ExtraWorkout {
  return { id: "x1", weekNumber: 1, day: "wed", kind: "run", ...over } as ExtraWorkout;
}

describe("a completed session with no minutes typed counts as prescribed", () => {
  // THE bug. Before this, a whole program of diligently ticked sessions showed
  // an empty Act column, because nobody types their durations.
  it("counts the run's FULL time, warm-up and cool-down included", () => {
    const w = week([[RUN]]);
    const a = weekActualTimeByCategory(w, [log()]);
    expect(a.running).toBe(sessionTiming(RUN).total);
    expect(a.running).toBe(40); // 5 + 30 + 5 — not the 30 of `durationMin`
    expect(a.miles).toBe(3);
  });

  it("counts weightlifting, which had no actual column at all before", () => {
    const w = week([[LIFT]]);
    const a = weekActualTimeByCategory(w, [log()]);
    expect(a.strength).toBe(sessionTiming(LIFT).total);
    expect(a.strength).toBeGreaterThan(0);
    // …and a lift is NOT cardio, the same exclusion the planned side makes.
    expect(a.cardioMinutes).toBe(0);
  });

  it("gives a PARTIAL session half, matching the adaptation engine", () => {
    const a = weekActualTimeByCategory(week([[RUN]]), [log({ status: "partial" })]);
    expect(a.running).toBe(20);
    expect(a.miles).toBe(1.5);
  });

  it("gives a SKIPPED session nothing — but the week still counts as logged", () => {
    const a = weekActualTimeByCategory(week([[RUN]]), [log({ status: "skipped", rpe: null })]);
    expect(a.running).toBe(0);
    expect(a.total).toBe(0);
    // A week logged as skipped is a real zero. An unlogged week is a dash. The
    // table cannot tell them apart without this flag.
    expect(a.any).toBe(false);
  });

  it("prints nothing for a week with no logs at all", () => {
    expect(weekActualTimeByCategory(week(), []).any).toBe(false);
  });
});

describe("a typed duration always wins", () => {
  it("uses the athlete's number over the prescription", () => {
    const a = weekActualTimeByCategory(week([[RUN]]), [log({ actuals: { durationMin: 52 } })]);
    expect(a.running).toBe(52);
  });

  it("is NOT halved on a partial — 30 minutes reported is 30 minutes done", () => {
    const a = weekActualTimeByCategory(week([[RUN]]), [
      log({ status: "partial", actuals: { durationMin: 30 } }),
    ]);
    expect(a.running).toBe(30);
  });
});

describe("extras count, as they do in the week header and the adaptation", () => {
  it("adds an extra lift to strength and an extra run to running", () => {
    const a = weekActualTimeByCategory(
      week(),
      [],
      [
        extra({ kind: "lift", durationMin: 45 }),
        extra({ id: "x2", kind: "run", durationMin: 25, distanceMiles: 2.5 }),
      ],
    );
    expect(a.strength).toBe(45);
    expect(a.running).toBe(25);
    expect(a.miles).toBe(2.5);
    expect(a.cardioMinutes).toBe(25); // the lift is excluded
    expect(a.any).toBe(true);
  });

  it("invents nothing for an extra with no duration", () => {
    const a = weekActualTimeByCategory(week(), [], [extra({ kind: "run" })]);
    expect(a.total).toBe(0);
  });
});

describe("the totals stay consistent with the planned side", () => {
  it("totals the four categories, and cardio excludes only lifting", () => {
    const w = week([[RUN], [LIFT], [HYBRID]]);
    const a = weekActualTimeByCategory(w, [
      log({ day: "mon" }),
      log({ day: "tue" }),
      log({ day: "wed" }),
    ]);
    expect(a.total).toBe(a.hybrid + a.strength + a.running + a.nonRunningCardio);
    expect(a.cardioMinutes).toBe(a.total - a.strength);
  });

  it("matches the PLAN exactly when every session is completed as prescribed", () => {
    // The property that makes the two columns comparable at a glance: a
    // perfectly executed week shows the same number twice.
    const w = week([[RUN], [LIFT], [HYBRID]]);
    const planned = weekTimeByCategory(w);
    const a = weekActualTimeByCategory(w, [
      log({ day: "mon" }),
      log({ day: "tue" }),
      log({ day: "wed" }),
    ]);
    expect(a.total).toBe(planned.total);
    expect(a.hybrid).toBe(planned.hybrid);
    expect(a.strength).toBe(planned.strength);
  });

  it("ignores a log pointing at a session that no longer exists", () => {
    // Weeks get regenerated; the logs outlive the sessions they named.
    const a = weekActualTimeByCategory(week([[RUN]]), [log({ sessionIndex: 4 })]);
    expect(a.total).toBe(0);
    expect(a.any).toBe(false);
  });
});

describe("groupExtrasByWeek", () => {
  it("keys extras by their own week", () => {
    const m = groupExtrasByWeek([extra(), extra({ id: "x2", weekNumber: 3 })]);
    expect(m.get(1)).toHaveLength(1);
    expect(m.get(3)).toHaveLength(1);
    expect(m.get(2)).toBeUndefined();
  });
});
