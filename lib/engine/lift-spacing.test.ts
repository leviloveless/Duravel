import { describe, it, expect } from "vitest";
import { assignDays, spreadLiftDays } from "./slots";
import type { DaySlot, TrainingDayName } from "./types";

/**
 * Reported: "the program has all three lifts in 3 days in a row" — Mon/Tue/Wed,
 * with Monday being the athlete's preferred REST day and the Thu/Fri they also
 * picked as lift days left empty. Two causes:
 *
 *  1. Rest days were appended to the round-robin, so the moment a week had one
 *     more session than non-rest days a session landed on the rest day — even
 *     though doubling up on a training day (the standing 2/day ceiling) was
 *     available. A 60-minute lift ended up on a rest day and was then frozen
 *     there, because rest days are protected from later moves.
 *  2. Lift pinning walked the preference list in order (Tue, Wed, Thu, …) and
 *     treated a day that already held a lift as "satisfied" — even when it held
 *     TWO — so lifts clustered early and a preferred day was stranded.
 */

const ALL: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const liftDaysOf = (days: DaySlot[]): TrainingDayName[] =>
  days.filter((d) => d.sessions.some((s) => s.kind === "lift")).map((d) => d.day);
const workouts = (days: DaySlot[], day: TrainingDayName) =>
  days.find((d) => d.day === day)!.sessions.filter((s) => s.kind !== "rest");

/** Longest run of consecutive lift days, in the week's own day order. */
const longestLiftStreak = (days: DaySlot[]): number => {
  let best = 0;
  let cur = 0;
  for (const d of days) {
    if (d.sessions.some((s) => s.kind === "lift")) cur += 1;
    else cur = 0;
    best = Math.max(best, cur);
  }
  return best;
};

describe("spreadLiftDays", () => {
  it("never picks three consecutive days", () => {
    const picked = spreadLiftDays(["tue", "wed", "thu", "fri"], 3, ALL);
    expect(picked).not.toEqual(["tue", "wed", "thu"]);
    expect(picked).not.toEqual(["wed", "thu", "fri"]);
    expect(picked).toHaveLength(3);
  });

  it("maximises the gap when the week allows it", () => {
    // Two lifts across Tue–Fri should sit as far apart as possible.
    expect(spreadLiftDays(["tue", "wed", "thu", "fri"], 2, ALL)).toEqual(["tue", "fri"]);
    // Three across a full week: the widest possible spacing is 3 clear days
    // between each (mon/thu/sun), not every-other-day.
    expect(spreadLiftDays(ALL, 3, ALL)).toEqual(["mon", "thu", "sun"]);
  });

  it("accepts a single back-to-back pair when nothing better exists", () => {
    // 3 lifts cannot be non-adjacent inside 4 consecutive days.
    const picked = spreadLiftDays(["tue", "wed", "thu", "fri"], 3, ALL);
    const idx = picked.map((d) => ALL.indexOf(d));
    const gaps = idx.slice(1).map((v, i) => v - idx[i]!);
    expect(gaps.filter((g) => g === 1)).toHaveLength(1); // exactly one adjacent pair
  });

  it("returns the preference unchanged when there is nothing to choose", () => {
    expect(spreadLiftDays(["tue", "wed", "thu"], 3, ALL)).toEqual(["tue", "wed", "thu"]);
    expect(spreadLiftDays(["tue", "wed"], 1, ALL)).toEqual(["tue", "wed"]);
  });
});

describe("the reported week: rest Mon, lifts Tue–Fri, long run Sat/Sun", () => {
  const prefs = {
    longRunDays: ["sat", "sun"] as TrainingDayName[],
    restDays: ["mon"] as TrainingDayName[],
    liftDays: ["tue", "wed", "thu", "fri"] as TrainingDayName[],
    hybridDays: ["tue", "wed", "thu", "fri", "sun"] as TrainingDayName[],
  };
  const build = (phase: "base" | "build" | "peak", micro: "rebound" | "increase" | "deload" = "increase") =>
    assignDays(ALL, phase, micro, "intermediate", "intermediate", undefined, prefs);

  it("never puts three lift days in a row", () => {
    for (const phase of ["base", "build", "peak"] as const) {
      for (const micro of ["rebound", "increase", "deload"] as const) {
        expect(longestLiftStreak(build(phase, micro))).toBeLessThanOrEqual(2);
      }
    }
  });

  it("leaves the rest day clear when the week fits on the training days", () => {
    for (const phase of ["base", "build", "peak"] as const) {
      expect(workouts(build(phase), "mon")).toHaveLength(0);
    }
  });

  it("never stacks two lifts on one day", () => {
    for (const phase of ["base", "build", "peak"] as const) {
      for (const d of build(phase)) {
        expect(d.sessions.filter((s) => s.kind === "lift").length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps every lift on a day the athlete actually chose", () => {
    for (const phase of ["base", "build", "peak"] as const) {
      for (const day of liftDaysOf(build(phase))) {
        expect(prefs.liftDays).toContain(day);
      }
    }
  });

  it("still honours the long-run and hybrid preferences", () => {
    const days = build("base", "rebound");
    expect(days.find((d) => d.sessions.some((s) => s.kind === "run" && s.isLong))?.day).toBe("sat");
    expect(liftDaysOf(days).length).toBeGreaterThan(0);
    expect(days.filter((d) => d.sessions.some((s) => s.kind === "hybrid")).map((d) => d.day)).toContain("sun");
  });

  it("preserves the session count (nothing dropped by the re-deal)", () => {
    const plain = assignDays(ALL, "build", "increase", "intermediate", "intermediate");
    const pref = build("build");
    const count = (a: DaySlot[]) => a.reduce((n, d) => n + d.sessions.filter((s) => s.kind !== "rest").length, 0);
    expect(count(pref)).toBe(count(plain));
  });
});
