import { describe, it, expect } from "vitest";
import { applySequencingGuards } from "./sequencing";
import type { DaySlot, TrainingDayName } from "./types";

const day = (d: TrainingDayName, sessions: DaySlot["sessions"]): DaySlot => ({ day: d, sessions });
const lower = { kind: "lift", liftType: "lower" } as const;
const upper = { kind: "lift", liftType: "upper" } as const;
const full = { kind: "lift", liftType: "full" } as const;
const easy = { kind: "run", runType: "easy", goalZone: 2 } as const;
const interval = { kind: "run", runType: "interval", goalZone: 5, isLong: false } as const;
const longRun = { kind: "run", runType: "long", goalZone: 2, isLong: true } as const;

function liftDays(days: DaySlot[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of days) out[d.day] = d.sessions.map((s) => (s.kind === "lift" ? `lift:${s.liftType}` : s.kind === "run" ? `run:${s.runType}` : s.kind));
  return out;
}

describe("applySequencingGuards", () => {
  it("moves a heavy-leg lift off the day before a key run", () => {
    // mon lower-lift, tue interval → conflict; wed empty is a safe target
    const days = [day("mon", [lower]), day("tue", [interval]), day("wed", [])];
    applySequencingGuards(days, new Set());
    expect(days[0]!.sessions.some((s) => s.kind === "lift")).toBe(false); // moved off mon
    expect(days[2]!.sessions.some((s) => s.kind === "lift" && s.liftType === "lower")).toBe(true);
  });

  it("leaves an UPPER lift before a key run alone (no leg fatigue)", () => {
    const days = [day("mon", [upper]), day("tue", [interval]), day("wed", [])];
    const before = liftDays(days);
    applySequencingGuards(days, new Set());
    expect(liftDays(days)).toEqual(before);
  });

  it("count-preserving swap when the target isn't empty", () => {
    // mon full-lift before tue long; wed has an easy run to swap back
    const days = [day("mon", [full]), day("tue", [longRun]), day("wed", [easy])];
    const total = days.reduce((n, d) => n + d.sessions.length, 0);
    applySequencingGuards(days, new Set());
    expect(days.reduce((n, d) => n + d.sessions.length, 0)).toBe(total);
    expect(days[0]!.sessions.some((s) => s.kind === "lift")).toBe(false);
    expect(days[0]!.sessions.some((s) => s.kind === "run" && s.runType === "easy")).toBe(true); // easy swapped in
    expect(days[2]!.sessions.some((s) => s.kind === "lift" && s.liftType === "full")).toBe(true);
  });

  it("respects protected days (won't disturb a pinned lift day)", () => {
    const days = [day("mon", [lower]), day("tue", [interval]), day("wed", [])];
    applySequencingGuards(days, new Set(["mon"]));
    expect(days[0]!.sessions.some((s) => s.kind === "lift")).toBe(true); // untouched
  });

  it("does not relocate onto, or the day before, another key run", () => {
    // mon lower before tue interval; wed is also a key run (threshold) → wed and
    // the day before it (tue) are off-limits; only viable target is... none → unchanged
    const days = [
      day("mon", [lower]),
      day("tue", [interval]),
      day("wed", [{ kind: "run", runType: "threshold", goalZone: 4 }]),
    ];
    applySequencingGuards(days, new Set());
    // no safe target (every non-conflict day is a key-run day or its predecessor)
    expect(days[0]!.sessions.some((s) => s.kind === "lift")).toBe(true);
  });
});
