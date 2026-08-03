import { describe, it, expect } from "vitest";
import { assignDays } from "./slots";
import { fillEmptyDays } from "./sequencing";
import type { DaySlot, TrainingDayName } from "./types";

/**
 * Reported setup: all seven days selected as available training days, no rest day
 * preference. The week came back with Monday empty while Friday, Saturday and
 * Sunday each carried two sessions, and with the lift days holding no aerobic
 * work at all — three consecutive days with no cardio.
 *
 * Two structural rules cover it: a selected day is never left empty next to a
 * doubled day, and the daily-load guards apply to every program rather than only
 * to research-lift ones (they used to be gated on `counts.researchLifts`, which
 * is set only for a band-table sport with an hours budget).
 */

const ALL: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const work = (d: DaySlot) => d.sessions.filter((s) => s.kind !== "rest");
const loads = (days: DaySlot[]) => days.map(work).map((s) => s.length);

const PHASES = ["base", "build", "peak", "taper"] as const;
const MICROS = ["increase", "rebound", "deload"] as const;

describe("no selected training day is left empty while another doubles up", () => {
  it("holds across phases and micro-weeks with all seven days selected", () => {
    for (const phase of PHASES) {
      for (const micro of MICROS) {
        for (const exp of ["beginner", "intermediate", "advanced"] as const) {
          const days = assignDays(ALL, phase, micro, exp, exp, undefined, {
            longRunDays: ["sat", "sun"],
          });
          const l = loads(days);
          const detail = `${phase}/${micro}/${exp} → ${JSON.stringify(l)}`;
          // An empty day is only acceptable if nothing else is doubled — i.e. the
          // week genuinely has fewer sessions than days.
          if (l.some((n) => n === 0)) expect(l.every((n) => n <= 1), detail).toBe(true);
        }
      }
    }
  });

  it("still honours a preferred rest day — that day stays empty by design", () => {
    const days = assignDays(ALL, "build", "increase", "advanced", "advanced", undefined, {
      longRunDays: ["sat"],
      restDays: ["mon"],
    });
    expect(work(days.find((d) => d.day === "mon")!).length).toBe(0);
  });

  it("keeps the long run on its chosen day even when a day needs filling", () => {
    const days = assignDays(ALL, "base", "increase", "intermediate", "intermediate", undefined, {
      longRunDays: ["sat"],
    });
    const longDay = days.find((d) => d.sessions.some((s) => s.kind === "run" && s.isLong))?.day;
    expect(longDay).toBe("sat");
  });
});

describe("fillEmptyDays", () => {
  const day = (d: TrainingDayName, sessions: DaySlot["sessions"]): DaySlot => ({ day: d, sessions });

  it("moves the most-movable session off the fullest day onto the empty one", () => {
    const days: DaySlot[] = [
      day("mon", []),
      day("tue", [
        { kind: "lift", liftType: "upper" },
        { kind: "run", runType: "easy", goalZone: 2, isLong: false },
      ]),
    ];
    fillEmptyDays(days, new Set());
    expect(loads(days)).toEqual([1, 1]);
    // The easy run is the movable one; the lift stays put.
    expect(days[1]!.sessions[0]!.kind).toBe("lift");
    expect(days[0]!.sessions[0]!.kind).toBe("run");
  });

  it("never moves the long run to fill a day", () => {
    const days: DaySlot[] = [
      day("mon", []),
      day("sat", [
        { kind: "run", runType: "long", goalZone: 2, isLong: true },
        { kind: "hybrid", goalZone: 4 },
      ]),
    ];
    fillEmptyDays(days, new Set());
    expect(days[1]!.sessions.some((s) => s.kind === "run" && s.isLong)).toBe(true);
    expect(days[0]!.sessions[0]!.kind).toBe("hybrid");
  });

  it("never creates a second lift on the destination day", () => {
    const days: DaySlot[] = [
      day("mon", [{ kind: "lift", liftType: "lower" }]),
      day("tue", [
        { kind: "lift", liftType: "upper" },
        { kind: "lift", liftType: "full" },
      ]),
      day("wed", []),
    ];
    fillEmptyDays(days, new Set());
    for (const d of days) expect(d.sessions.filter((s) => s.kind === "lift").length).toBeLessThanOrEqual(1);
  });

  it("leaves a protected (preferred rest) day alone", () => {
    const days: DaySlot[] = [
      day("mon", []),
      day("tue", [
        { kind: "lift", liftType: "upper" },
        { kind: "run", runType: "easy", goalZone: 2, isLong: false },
      ]),
    ];
    fillEmptyDays(days, new Set<TrainingDayName>(["mon"]));
    expect(loads(days)).toEqual([0, 2]);
  });

  it("does nothing when no day is doubled — an empty day is then genuine slack", () => {
    const days: DaySlot[] = [
      day("mon", []),
      day("tue", [{ kind: "lift", liftType: "upper" }]),
    ];
    fillEmptyDays(days, new Set());
    expect(loads(days)).toEqual([0, 1]);
  });
});
