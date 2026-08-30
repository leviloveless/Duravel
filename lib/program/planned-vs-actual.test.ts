/**
 * PLANNED VS ACTUAL ON A SYNCED SESSION (Levi, 2026-08-25).
 *
 * The data has been written on every link since sync-linking shipped; only the
 * display was missing. What these guard is that the two sides are measured the
 * same way — a watch records the WHOLE session, so the planned side has to be
 * the whole session too. Comparing a GPS trace against an interval run's main
 * set alone reports a correctly-executed session as a 100% overshoot.
 */
import { describe, it, expect } from "vitest";
import { plannedVsActual, deltaLabel } from "./planned-vs-actual";
import { sessionMiles, sessionTiming } from "@/lib/session-volume";
import type { Session, WorkoutLog } from "@/lib/schemas";

const interval: Session = {
  kind: "run",
  runType: "interval",
  durationMin: 21,
  paceMinMile: "6:55",
  distanceMiles: 3.1,
  goalZone: 5,
  overheadMiles: 2.8,
  recoveryMin: 16,
  recoveryMiles: 1.8,
} as unknown as Session;

const lift: Session = {
  kind: "lift",
  liftType: "full",
  movements: [{ pattern: "squat", sets: 3, repRange: "5" }],
} as unknown as Session;

const log = (over: Partial<WorkoutLog> = {}): WorkoutLog =>
  ({
    weekNumber: 1,
    day: "mon",
    sessionIndex: 0,
    status: "completed",
    rpe: 7,
    note: null,
    actuals: { distanceMiles: 7.31, durationMin: 61, avgHr: 158 },
    ...over,
  }) as WorkoutLog;

describe("what the comparison measures", () => {
  it("compares the WHOLE session against the whole trace, not the main set", () => {
    const c = plannedVsActual(interval, log())!;
    // 3.1 mi of reps, but 7.7 on the feet — the watch records the latter.
    expect(c.distance!.planned).toBe(sessionMiles(interval));
    expect(c.distance!.planned).toBeGreaterThan(
      interval.kind === "run" ? interval.distanceMiles : 0,
    );
    expect(c.time!.planned).toBe(sessionTiming(interval).total);
  });

  it("carries the actual straight from the source, rounded for display", () => {
    const c = plannedVsActual(interval, log())!;
    expect(c.distance!.actual).toBe(7.3);
    expect(c.time!.actual).toBe(61);
    expect(c.avgHr).toBe(158);
  });

  it("signs the difference as actual minus planned", () => {
    const short = plannedVsActual(interval, log({ actuals: { distanceMiles: 6.7 } }))!;
    expect(short.distance!.delta).toBeLessThan(0);
    const long = plannedVsActual(interval, log({ actuals: { distanceMiles: 9 } }))!;
    expect(long.distance!.delta).toBeGreaterThan(0);
  });
});

describe("what it declines to show", () => {
  it("nothing at all without a log", () => {
    expect(plannedVsActual(interval, null)).toBeNull();
  });

  it("nothing for a log the athlete filled in without any figures", () => {
    expect(plannedVsActual(interval, log({ actuals: null }))).toBeNull();
  });

  it("nothing for a skipped session — 'actual 0' is noise on a row that says skipped", () => {
    expect(plannedVsActual(interval, log({ status: "skipped" }))).toBeNull();
  });

  it("no DISTANCE for a lift, which has none to compare", () => {
    const c = plannedVsActual(lift, log())!;
    expect(c.distance).toBeUndefined();
    // …but the time still compares: a lift is a fixed 60 minutes.
    expect(c.time!.planned).toBe(sessionTiming(lift).total);
  });

  it("shows time alone when the source recorded no distance", () => {
    const c = plannedVsActual(interval, log({ actuals: { durationMin: 55 } }))!;
    expect(c.distance).toBeUndefined();
    expect(c.time!.actual).toBe(55);
  });
});

describe("the delta label", () => {
  it("says nothing when the session landed on plan", () => {
    expect(deltaLabel({ planned: 6.4, actual: 6.4, delta: 0 }, " mi")).toBeNull();
  });

  it("uses a real minus sign, not a hyphen", () => {
    expect(deltaLabel({ planned: 6.4, actual: 6.1, delta: -0.3 }, " mi")).toBe("−0.3 mi");
    expect(deltaLabel({ planned: 60, actual: 64, delta: 4 }, " min")).toBe("+4 min");
  });
});
