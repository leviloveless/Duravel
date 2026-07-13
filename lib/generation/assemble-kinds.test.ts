import { describe, it, expect } from "vitest";
import { daySessions } from "./assemble";
import type { AiWeek, Session } from "@/lib/schemas";
import type { SessionSlot, WeekSkeleton } from "@/lib/engine/types";

/**
 * Guards roadmap #2.1 / review E-H1: the assembled day must carry the engine's
 * planned session KINDS regardless of what the AI returned.
 */

type DaySlot = WeekSkeleton["days"][number];

const runSlot: SessionSlot = { kind: "run", runType: "easy", goalZone: 2 };
const liftSlot: SessionSlot = { kind: "lift", liftType: "full" };

const aRun: Session = { kind: "run", runType: "tempo", durationMin: 40, paceMinMile: "7:30", distanceMiles: 5, goalZone: 3 };
const aLift: Session = { kind: "lift", liftType: "full", movements: [{ pattern: "squat", sets: 3, repRange: "5-7" }] };

const skel = (sessions: SessionSlot[]): DaySlot => ({ day: "mon", sessions });
const ai = (sessions: Session[]): AiWeek => ({ weekNumber: 1, days: [{ day: "mon", sessions }] });

describe("daySessions kind enforcement", () => {
  it("passes matching kinds through with no issues", () => {
    const issues: string[] = [];
    const out = daySessions(skel([runSlot, liftSlot]), ai([aRun, aLift]), issues, 1);
    expect(out.map((s) => s.kind)).toEqual(["run", "lift"]);
    expect(issues).toHaveLength(0);
  });

  it("matches slots regardless of the AI's session order", () => {
    const issues: string[] = [];
    const out = daySessions(skel([runSlot, liftSlot]), ai([aLift, aRun]), issues, 1);
    expect(out.map((s) => s.kind)).toEqual(["run", "lift"]);
    expect(issues).toHaveLength(0);
  });

  it("drops an AI session with no planned slot", () => {
    const issues: string[] = [];
    const out = daySessions(skel([runSlot]), ai([aRun, aLift]), issues, 1);
    expect(out.map((s) => s.kind)).toEqual(["run"]);
    expect(issues.some((i) => i.includes("dropped"))).toBe(true);
  });

  it("inserts a placeholder for a planned slot the AI omitted", () => {
    const issues: string[] = [];
    const out = daySessions(skel([runSlot, liftSlot]), ai([aRun]), issues, 1);
    expect(out.map((s) => s.kind)).toEqual(["run", "lift"]);
    expect(issues.some((i) => i.includes("omitted"))).toBe(true);
  });

  it("coerces a wrong-kind AI session (placeholder inserted, wrong one dropped)", () => {
    const issues: string[] = [];
    const out = daySessions(skel([runSlot]), ai([aLift]), issues, 1);
    expect(out.map((s) => s.kind)).toEqual(["run"]);
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it("returns [] for all-rest and the race marker for a race day", () => {
    expect(daySessions(skel([{ kind: "rest" }]), undefined, [], 1)).toEqual([]);
    expect(daySessions(skel([{ kind: "race", priority: "A" }]), undefined, [], 1)).toEqual([
      { kind: "race", priority: "A" },
    ]);
  });
});
