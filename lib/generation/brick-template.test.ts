/**
 * AN AUTHORED BRICK, END TO END (Levi, 2026-09-09: "one of the session types
 * that can be added in should be a Brick; which will be a bike followed by a
 * run").
 *
 * Bricks already existed — triathlon programs have built them since the
 * multi-sport engine — but they were built by `buildTriathlonSkeleton` against a
 * TIME budget, and a HYROX week is budgeted in MILES. Putting one in an authored
 * week therefore crosses two currencies at once, and both crossings had a bug
 * waiting in them:
 *
 *  1. `sessionWorkMiles` returned 0 for a brick, so the run off the bike was
 *     running that the week did not count. The reported mileage would have
 *     understated what the athlete ran, AND the reconciler would have grown the
 *     other runs to close a shortfall that was not there. That is the work-vs-
 *     total shape for the tenth time.
 *  2. `placeholderFor` returned null for a brick. The AI is asked for run / lift
 *     / hybrid and never returns a brick, so the athlete's session was dropped
 *     between the skeleton and the calendar — an engine decision discarded by
 *     the wiring, the failure shape this repo has now seen four times.
 *
 * Neither is visible from the designer, and neither would fail a test that only
 * checked "the brick is on Wednesday". So this file checks the ARITHMETIC.
 */
import { describe, it, expect } from "vitest";
import { buildSkeleton, toEngineInput } from "@/lib/engine";
import { assembleProgram } from "./assemble";
import {
  BRICK_BIKE_MIN,
  BRICK_BIKE_MAX,
  sessionWorkMiles,
  weekMileage,
} from "@/lib/session-volume";
import type { Session } from "@/lib/schemas";
import type { WeekTemplate } from "@/lib/engine/types";

const START = "2026-08-17";

/** Levi's own shape, with a brick on Wednesday. */
const withBrick: WeekTemplate = {
  days: [
    { day: "mon", sessions: [{ kind: "lift", liftType: "full" }] },
    { day: "tue", sessions: [{ kind: "run", runType: "threshold" }] },
    { day: "wed", sessions: [{ kind: "brick" }] },
    { day: "thu", sessions: [{ kind: "hybrid" }] },
    { day: "fri", sessions: [{ kind: "run", runType: "easy" }] },
    { day: "sat", sessions: [{ kind: "run", runType: "long" }] },
  ],
};

/** The same week with the brick swapped for an easy run — the control. */
const withoutBrick: WeekTemplate = {
  days: withBrick.days.map((d) =>
    d.day === "wed" ? { day: "wed", sessions: [{ kind: "run", runType: "easy" } as const] } : d,
  ),
};

const gen = (weekTemplate: WeekTemplate) =>
  ({
    profile: {
      firstName: "L",
      age: 35,
      bodyWeight: 80,
      weightUnit: "kg",
      runningExp: "intermediate",
      hybridExp: "intermediate",
      liftingExp: "intermediate",
      trainingClass: "non_highly_trained",
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
      sex: "male",
      weeklyHours: "h10_20",
      benchmarks: { fiveKTime: "24:00" },
    },
    startMileage: 25,
    programType: "goal_event",
    durationWeeks: 16,
    races: [{ raceDate: "2026-12-05", priority: "A" }],
    startDate: START,
    weekTemplate,
  }) as never;

function build(weekTemplate: WeekTemplate) {
  const sk = buildSkeleton(toEngineInput(gen(weekTemplate), START));
  const { program } = assembleProgram(sk, [], "intermediate", { fiveKTime: "24:00" } as never);
  return { sk, program };
}

const sessionsOf = (week: { days: { sessions: Session[] }[] }) =>
  week.days.flatMap((d) => d.sessions);
const brickIn = (week: { days: { sessions: Session[] }[] }) =>
  sessionsOf(week).find((s): s is Extract<Session, { kind: "brick" }> => s.kind === "brick");

describe("an authored brick survives into the program", () => {
  const { program } = build(withBrick);
  const w1 = program.weeks[0]!;

  it("is still there on the day it was authored on", () => {
    // The regression guard for `placeholderFor` returning null. Before that case
    // existed this expectation failed outright — the session was simply gone.
    const wed = w1.days.find((d) => d.day === "wed")!;
    expect(wed.sessions.some((s) => s.kind === "brick")).toBe(true);
  });

  it("is a bike leg and then a run leg, in that order", () => {
    const brick = brickIn(w1)!;
    expect(brick.segments.map((s) => s.discipline)).toEqual(["bike", "run"]);
  });

  it("keeps both legs in Zone 2", () => {
    // Deliberate: a brick adds fatigue, not intensity. Compromised running AT
    // intensity is what the hybrid is for.
    const brick = brickIn(w1)!;
    for (const seg of brick.segments) expect(seg.goalZone).toBe(2);
  });

  it("rides within the band, never past its ceiling", () => {
    const bike = brickIn(w1)!.segments.find((s) => s.discipline === "bike")!;
    expect(bike.durationMin).toBeGreaterThanOrEqual(BRICK_BIKE_MIN);
    expect(bike.durationMin).toBeLessThanOrEqual(BRICK_BIKE_MAX);
  });
});

describe("the run off the bike is running the week counts", () => {
  const { program } = build(withBrick);
  const w1 = program.weeks[0]!;

  it("gives the run leg a distance", () => {
    const run = brickIn(w1)!.segments.find((s) => s.discipline === "run")!;
    expect(run.distanceMiles).toBeGreaterThan(0);
  });

  it("counts that distance as the session's work miles", () => {
    // The tenth work-vs-total guard. `sessionWorkMiles` used to return 0 here.
    const brick = brickIn(w1)!;
    const run = brick.segments.find((s) => s.discipline === "run")!;
    expect(sessionWorkMiles(brick)).toBeCloseTo(run.distanceMiles!, 1);
  });

  it("counts it in the week's mileage", () => {
    const brick = brickIn(w1)!;
    const others = sessionsOf(w1).filter((s) => s !== brick);
    const withoutIt = others.reduce((a, s) => a + sessionWorkMiles(s), 0);
    expect(weekMileage(w1)).toBeGreaterThan(withoutIt);
  });

  it("does NOT push the week over its mileage — the other runs come down", () => {
    // The point of making a brick a FIXED contribution rather than a resizable
    // run: the week's stated total is unchanged, the brick simply takes its share
    // of it. Compared like-for-like against the same week with an easy run on
    // Wednesday instead, both land on the same target.
    const control = build(withoutBrick).program.weeks[0]!;
    expect(weekMileage(w1)).toBeCloseTo(control.summary.totalMileage, 0);
    expect(weekMileage(w1)).toBeCloseTo(w1.summary.totalMileage, 0);
  });
});

describe("a triathlon brick is left exactly as it was", () => {
  it("contributes no run mileage without the flag", () => {
    // Triathlon bricks are budgeted in TIME and have never counted toward
    // mileage. Switching them on is a real change to every existing triathlon
    // week, so it is deliberately NOT part of this one. If that is ever revisited
    // this test is the thing that should fail first.
    const triathlonBrick: Session = {
      kind: "brick",
      goalZone: 2,
      segments: [
        { discipline: "bike", durationMin: 120, goalZone: 2 },
        { discipline: "run", durationMin: 25, goalZone: 2, distanceMiles: 2.5 },
      ],
    };
    expect(sessionWorkMiles(triathlonBrick)).toBe(0);
  });
});
