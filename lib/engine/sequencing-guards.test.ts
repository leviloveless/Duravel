import { describe, it, expect } from "vitest";
import { separateLifts, pairLegLiftWithCardio, spreadRuns, capSessionsPerDay } from "./sequencing";
import type { DaySlot, SessionSlot, TrainingDayName } from "./types";

/**
 * Batch 3 (engine-vs-research): research-lift programs must never stack two
 * weight sessions on one day, and every hard-leg lift day must carry easy
 * same-day cardio. Both guards relocate existing sessions and preserve counts.
 */

const DAYS: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function day(name: TrainingDayName, ...sessions: SessionSlot[]): DaySlot {
  return { day: name, sessions };
}
const fullLift: SessionSlot = { kind: "lift", liftType: "full" };
const powerLift: SessionSlot = { kind: "lift", liftType: "power" };
const upperLift: SessionSlot = { kind: "lift", liftType: "upper" };
const easyRun: SessionSlot = { kind: "run", runType: "easy", goalZone: 2, isLong: false };
const longRun: SessionSlot = { kind: "run", runType: "long", goalZone: 2, isLong: true };
const intervalRun: SessionSlot = { kind: "run", runType: "interval", goalZone: 5, isLong: false };

const countLifts = (days: DaySlot[]) =>
  days.reduce((n, d) => n + d.sessions.filter((s) => s.kind === "lift").length, 0);
const maxLiftsOnAnyDay = (days: DaySlot[]) =>
  Math.max(...days.map((d) => d.sessions.filter((s) => s.kind === "lift").length));

describe("separateLifts", () => {
  it("moves a second lift off a doubled-up day, preserving the lift count", () => {
    const days = [
      day("mon", fullLift, powerLift), // two lifts stacked
      day("tue", easyRun),
      day("wed"),
      day("thu", intervalRun),
    ];
    const before = countLifts(days);
    separateLifts(days, new Set());
    expect(maxLiftsOnAnyDay(days)).toBe(1);
    expect(countLifts(days)).toBe(before);
  });

  it("does not relocate onto a protected day", () => {
    const days = [
      day("mon", fullLift, powerLift),
      day("tue"), // the only free day, but protected
    ];
    separateLifts(days, new Set<TrainingDayName>(["tue"]));
    // nowhere safe to move → best-effort leaves both (still no data loss)
    expect(countLifts(days)).toBe(2);
    expect(days[1]!.sessions.filter((s) => s.kind === "lift").length).toBe(0);
  });

  it("does not park a hard-leg lift the day before a key run", () => {
    const days = [
      day("mon", fullLift, powerLift),
      day("tue"), // empty but sits before a key run → off-limits for a leg lift
      day("wed", intervalRun),
      day("thu"), // safe landing spot
    ];
    separateLifts(days, new Set());
    expect(maxLiftsOnAnyDay(days)).toBe(1);
    expect(days[1]!.sessions.some((s) => s.kind === "lift")).toBe(false);
    expect(days[3]!.sessions.some((s) => s.kind === "lift")).toBe(true);
  });
});

describe("pairLegLiftWithCardio", () => {
  it("pulls an easy run onto a hard-leg lift day that lacks cardio", () => {
    const days = [
      day("mon", fullLift), // leg lift, no cardio
      day("tue", easyRun, easyRun), // spare easy runs
    ];
    pairLegLiftWithCardio(days, new Set());
    expect(days[0]!.sessions.some((s) => s.kind === "run")).toBe(true);
  });

  it("leaves an already-paired leg lift day alone", () => {
    const days = [day("mon", fullLift, easyRun), day("tue", easyRun)];
    pairLegLiftWithCardio(days, new Set());
    expect(days[1]!.sessions.filter((s) => s.kind === "run").length).toBe(1); // source untouched
  });

  it("never strips the only cardio off another leg-lift day", () => {
    const days = [
      day("mon", powerLift), // needs cardio
      day("tue", fullLift, easyRun), // its easy run is the ONLY cardio guarding a leg lift
    ];
    pairLegLiftWithCardio(days, new Set());
    // tue must keep its run; mon stays unpaired rather than unpair tue
    expect(days[1]!.sessions.some((s) => s.kind === "run")).toBe(true);
  });

  it("does not treat an upper-body lift as a hard-leg lift", () => {
    const days = [day("mon", upperLift), day("tue", easyRun)];
    pairLegLiftWithCardio(days, new Set());
    expect(days[0]!.sessions.some((s) => s.kind === "run")).toBe(false); // no pairing forced
    expect(days[1]!.sessions.some((s) => s.kind === "run")).toBe(true);
  });

  it("never moves the long run", () => {
    const days = [day("mon", fullLift), day("tue", longRun)];
    pairLegLiftWithCardio(days, new Set());
    expect(days[1]!.sessions.some((s) => s.kind === "run" && s.runType === "long")).toBe(true);
  });
});

// keep the DAYS constant referenced (documents the weekly frame)
it("training week frame", () => expect(DAYS.length).toBe(7));


const hybrid: SessionSlot = { kind: "hybrid", goalZone: 4 };
const runsOnDay = (days: DaySlot[], i: number) => days[i]!.sessions.filter((s) => s.kind === "run").length;
const maxWorkoutsOnAnyDay = (days: DaySlot[]) => Math.max(...days.map((d) => d.sessions.length));
const totalSessions = (days: DaySlot[]) => days.reduce((n, d) => n + d.sessions.length, 0);

describe("spreadRuns (rule #2: no doubled runs until every day has one)", () => {
  it("moves a second run onto a run-less day", () => {
    const days = [day("mon", easyRun, intervalRun), day("tue"), day("wed", fullLift)];
    const before = totalSessions(days);
    spreadRuns(days, new Set());
    expect(days.every((d) => d.sessions.filter((s) => s.kind === "run").length <= 1)).toBe(true);
    expect(totalSessions(days)).toBe(before); // count-preserving
  });

  it("keeps the long run on its (protected) day, relocating the easy run", () => {
    const days = [day("sat", longRun, easyRun), day("sun")];
    spreadRuns(days, new Set<TrainingDayName>(["sat"]));
    expect(days[0]!.sessions.some((s) => s.kind === "run" && s.runType === "long")).toBe(true);
    expect(runsOnDay(days, 1)).toBe(1); // easy run moved to sunday
  });

  it("allows doubled runs when every day already has a run", () => {
    const days = [day("mon", easyRun, easyRun), day("tue", easyRun)];
    spreadRuns(days, new Set());
    // tue already has a run and is the only other day → mon keeps both
    expect(runsOnDay(days, 0)).toBe(2);
  });

  it("won't move a run onto a day that would exceed 2 workouts", () => {
    const days = [day("mon", easyRun, intervalRun), day("tue", fullLift, hybrid)];
    spreadRuns(days, new Set());
    expect(runsOnDay(days, 0)).toBe(2); // tue is full (2 workouts) → no room
  });
});

describe("capSessionsPerDay (rule #1: max 2 workouts/day)", () => {
  it("relocates the 3rd session to a lighter day, preserving count", () => {
    const days = [day("mon", fullLift, easyRun, hybrid), day("tue"), day("wed")];
    const before = totalSessions(days);
    capSessionsPerDay(days, new Set());
    expect(maxWorkoutsOnAnyDay(days)).toBeLessThanOrEqual(2);
    expect(totalSessions(days)).toBe(before);
  });

  it("never creates two lifts on a day when relocating", () => {
    const days = [day("mon", fullLift, powerLift, easyRun), day("tue", upperLift)];
    // mon has 3 (2 lifts already — separate first in the real pipeline); cap must
    // not move a lift onto tue (which has a lift). It moves the easy run instead.
    capSessionsPerDay(days, new Set());
    expect(days[1]!.sessions.filter((s) => s.kind === "lift").length).toBe(1);
    expect(maxWorkoutsOnAnyDay(days)).toBeLessThanOrEqual(2);
  });

  it("leaves a compliant week untouched", () => {
    const days = [day("mon", fullLift, easyRun), day("tue", intervalRun)];
    const before = JSON.stringify(days);
    capSessionsPerDay(days, new Set());
    expect(JSON.stringify(days)).toBe(before);
  });
});


describe("separateLifts — dense peak week (regression: 2 lifts stayed on one day)", () => {
  const thresholdRun: SessionSlot = { kind: "run", runType: "threshold", goalZone: 4 };
  it("relocates the 2nd hard-leg lift even when every open day is key-run-adjacent", () => {
    // mon stacks two full-body lifts; every other unprotected day holds a key run,
    // so the old hard key-run veto stranded the extra lift. It must still move.
    const days = [
      day("mon", fullLift, fullLift),
      day("tue", intervalRun),
      day("wed", thresholdRun),
      day("thu", longRun),
    ];
    separateLifts(days, new Set());
    const maxLifts = Math.max(...days.map((d) => d.sessions.filter((s) => s.kind === "lift").length));
    expect(maxLifts).toBe(1);
    expect(days.reduce((n, d) => n + d.sessions.filter((s) => s.kind === "lift").length, 0)).toBe(2);
  });
});

