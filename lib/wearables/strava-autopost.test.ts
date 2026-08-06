/**
 * REGRESSION — what the AUTO-POST actually sends to Strava.
 *
 * Two live findings, both on the same path, both invisible to every existing
 * test because nothing covered `strava-autopost.ts` at all:
 *
 *  1. 2026-08-05 — the auto-post built its own `Duravel Run — Week 1` title over a
 *     program blurb while the manual "To Strava" button wrote the real workout.
 *     Fixed in `fd4b58b` by routing both through `sessionSummary`. Nothing pinned
 *     it, so the wiring (does `dayKey` reach the title? does the summary's title
 *     land in `name`?) could silently come apart again.
 *
 *  2. 2026-08-06 — Levi's week-1 Thursday threshold run auto-posted as
 *     `8 min / 1.00 mi`. The session is 28 min / 2.5 mi, and the description
 *     written by the SAME call said "Warm up: 12 min … Cooldown: 8 min". The
 *     payload read `session.durationMin` / `session.distanceMiles`, which on a run
 *     are the WORK portion only.
 *
 * The fixture below IS that Thursday session, so case 2 is asserted against the
 * numbers that were actually observed on Strava.
 */
import { describe, it, expect } from "vitest";
import type { Session } from "@/lib/schemas";
import { buildAutoPostActivity, type AutoPostContext } from "./strava-autopost";

type RunSession = Extract<Session, { kind: "run" }>;
type LiftSession = Extract<Session, { kind: "lift" }>;

const START = "2026-08-06T13:00:00.000Z";
const METERS_PER_MILE = 1609.34;

/** Week 1 / Thursday of Levi's "Fall prep" — 12 min warmup, 1 mi work, 8 min cooldown. */
const THRESHOLD_RUN: RunSession = {
  kind: "run",
  runType: "threshold",
  distanceMiles: 1,
  durationMin: 8,
  paceMinMile: "8:00",
  goalZone: 4,
  overheadMiles: 1.5,
  description: [
    "Warm up: 12 min easy (~0.9 mi) @ 13:20/mi",
    "Work: 1 x 1 mile at 8:00/mi (4:58/km)",
    "Cooldown: 8 min easy (~0.6 mi) @ 13:20/mi",
  ].join("\n"),
} as RunSession;

function ctx(over: Partial<AutoPostContext> = {}): AutoPostContext {
  return {
    session: THRESHOLD_RUN,
    status: "completed",
    weekNumber: 1,
    dayKey: "thu",
    programName: "Fall prep",
    ...over,
  };
}

describe("auto-post payload", () => {
  it("names the activity 'Week N - Day - Workout Name'", () => {
    expect(buildAutoPostActivity(ctx(), START).name).toBe("Week 1 - Thursday - Threshold Run");
  });

  it("posts the prescription as the description, titled the same way", () => {
    const { name, description } = buildAutoPostActivity(ctx(), START);
    expect(description).toBe(
      [
        "Week 1 - Thursday - Threshold Run",
        "Warm up: 12 min easy (~0.9 mi) @ 13:20/mi",
        "Work: 1 x 1 mile at 8:00/mi (4:58/km)",
        "Cooldown: 8 min easy (~0.6 mi) @ 13:20/mi",
      ].join("\n"),
    );
    // The title doubles as the idempotency anchor for `replaceWorkoutBlock`.
    expect(description!.startsWith(name)).toBe(true);
  });

  it("posts the WHOLE session, not just the main set", () => {
    const { elapsedSeconds, distanceMeters } = buildAutoPostActivity(ctx(), START);
    // Observed live as 8 min / 1.00 mi — the work portion — before the fix.
    expect(elapsedSeconds).toBe(28 * 60);
    expect(distanceMeters).toBeCloseTo(2.5 * METERS_PER_MILE, 0);
    expect(elapsedSeconds).not.toBe(8 * 60);
  });

  it("a lift is a full 60 minutes, not the 45-minute fallback", () => {
    const lift: LiftSession = {
      kind: "lift",
      liftType: "full",
      movements: [{ pattern: "squat", exercise: "Back Squat", sets: 3, repRange: "5-6" }],
    };
    const a = buildAutoPostActivity(ctx({ session: lift }), START);
    expect(a.sportType).toBe("WeightTraining");
    expect(a.elapsedSeconds).toBe(60 * 60);
    expect(a.distanceMeters).toBeUndefined();
  });

  it("the athlete's own actuals still win over the plan", () => {
    const a = buildAutoPostActivity(
      ctx({ actualDurationMin: 31, actualDistanceMiles: 2.7 }),
      START,
    );
    expect(a.elapsedSeconds).toBe(31 * 60);
    expect(a.distanceMeters).toBeCloseTo(2.7 * METERS_PER_MILE, 0);
  });

  it("drops missing fields from the title instead of printing 'undefined'", () => {
    const a = buildAutoPostActivity(ctx({ dayKey: null, weekNumber: 0 }), START);
    expect(a.name).toBe("Threshold Run");
    expect(a.name).not.toMatch(/undefined/);
  });
});
