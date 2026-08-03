import { describe, it, expect } from "vitest";
import { assignDays, weekendFirst, slotPriority } from "./slots";
import { spaceHardRunAfterLongRun } from "./sequencing";
import type { DaySlot, TrainingDayName } from "./types";

const ALL: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const dayOf = (days: DaySlot[], kind: string): TrainingDayName[] =>
  days.filter((d) => d.sessions.some((s) => s.kind === kind)).map((d) => d.day);
const longDay = (days: DaySlot[]) =>
  days.find((d) => d.sessions.some((s) => s.kind === "run" && s.isLong))?.day;
const sessionsOn = (days: DaySlot[], day: TrainingDayName) =>
  days.find((d) => d.day === day)!.sessions.filter((s) => s.kind !== "rest");

describe("weekendFirst — weekend days win when several are acceptable", () => {
  it("moves sat/sun to the front, keeping the athlete's order otherwise", () => {
    expect(weekendFirst(["tue", "wed", "thu", "fri", "sun"])).toEqual(["sun", "tue", "wed", "thu", "fri"]);
    expect(weekendFirst(["tue", "sat", "sun"])).toEqual(["sat", "sun", "tue"]);
  });

  it("is a no-op with no weekend day listed", () => {
    expect(weekendFirst(["tue", "wed", "thu"])).toEqual(["tue", "wed", "thu"]);
  });
});

describe("the single weekly hybrid takes the weekend day", () => {
  it("picks sun over the earlier weekdays in the preference list", () => {
    // Reproduces the reported setup: long run sat+sun, hybrid tue..fri+sun.
    // Before this fix the one hybrid always resolved to tue (first listed) and
    // sunday was left with whatever the round-robin had — often an interval.
    const days = assignDays(ALL, "base", "rebound", "intermediate", "intermediate", undefined, {
      longRunDays: ["sat", "sun"],
      restDays: ["mon"],
      liftDays: ["tue", "wed", "thu", "fri"],
      hybridDays: ["tue", "wed", "thu", "fri", "sun"],
    });
    expect(longDay(days)).toBe("sat");
    expect(dayOf(days, "hybrid")).toContain("sun");
  });
});

describe("a preferred rest day never becomes the heaviest day", () => {
  const prefs = {
    longRunDays: ["sat"] as TrainingDayName[],
    restDays: ["mon"] as TrainingDayName[],
    liftDays: ["tue", "wed", "thu", "fri"] as TrainingDayName[],
  };

  it("keeps quality work off the rest day when the week overflows", () => {
    for (const phase of ["base", "build", "peak"] as const) {
      const days = assignDays(ALL, phase, "increase", "advanced", "advanced", undefined, prefs);
      const mon = sessionsOn(days, "mon");
      // Anything that spills onto the rest day must be the week's lightest work —
      // never a hybrid or a quality run.
      for (const s of mon) {
        expect(s.kind).not.toBe("hybrid");
        if (s.kind === "run") expect(["easy", "fartlek"]).toContain(s.runType);
      }
    }
  });

  it("fills every non-rest day before touching the rest day", () => {
    const days = assignDays(ALL, "base", "rebound", "intermediate", "intermediate", undefined, prefs);
    const mon = sessionsOn(days, "mon");
    if (mon.length > 0) {
      for (const d of days) {
        if (d.day === "mon") continue;
        expect(d.sessions.filter((s) => s.kind !== "rest").length).toBeGreaterThan(0);
      }
    }
  });

  it("the rest day is never the highest-priority day of the week", () => {
    const days = assignDays(ALL, "peak", "increase", "advanced", "advanced", undefined, prefs);
    const top = (d: DaySlot) => Math.max(0, ...d.sessions.map(slotPriority));
    const mon = days.find((d) => d.day === "mon")!;
    const others = days.filter((d) => d.day !== "mon");
    expect(top(mon)).toBeLessThanOrEqual(Math.max(...others.map(top)));
  });
});

describe("spaceHardRunAfterLongRun — no hard run the day after the long run", () => {
  const mk = (spec: Record<string, DaySlot["sessions"]>): DaySlot[] =>
    (Object.keys(spec) as TrainingDayName[]).map((day) => ({ day, sessions: spec[day]! }));

  it("moves an interval off the day after the long run", () => {
    const days = mk({
      mon: [{ kind: "run", runType: "easy", goalZone: 2 }],
      tue: [{ kind: "lift", liftType: "upper" }],
      fri: [{ kind: "lift", liftType: "full" }],
      sat: [{ kind: "run", runType: "long", goalZone: 2, isLong: true }],
      sun: [{ kind: "run", runType: "interval", goalZone: 5 }],
    });
    spaceHardRunAfterLongRun(days, new Set());
    const sun = days.find((d) => d.day === "sun")!;
    expect(sun.sessions.some((s) => s.kind === "run" && s.runType === "interval")).toBe(false);
    // the interval swapped onto the free easy day, it wasn't dropped
    expect(days.find((d) => d.day === "mon")!.sessions.some((s) => s.kind === "run" && s.runType === "interval")).toBe(true);
    expect(days.flatMap((d) => d.sessions)).toHaveLength(5);
    expect(days.flatMap((d) => d.sessions).filter((s) => s.kind === "run" && s.runType === "interval")).toHaveLength(1);
  });

  it("leaves an easy run the day after the long run alone", () => {
    const days = mk({
      sat: [{ kind: "run", runType: "long", goalZone: 2, isLong: true }],
      sun: [{ kind: "run", runType: "easy", goalZone: 2 }],
    });
    const before = JSON.stringify(days);
    spaceHardRunAfterLongRun(days, new Set());
    expect(JSON.stringify(days)).toBe(before);
  });

  it("does nothing when the long run is the last training day", () => {
    const days = mk({
      fri: [{ kind: "run", runType: "interval", goalZone: 5 }],
      sat: [{ kind: "run", runType: "long", goalZone: 2, isLong: true }],
    });
    const before = JSON.stringify(days);
    spaceHardRunAfterLongRun(days, new Set());
    expect(JSON.stringify(days)).toBe(before);
  });

  it("respects protected days", () => {
    const days = mk({
      mon: [{ kind: "run", runType: "easy", goalZone: 2 }],
      sat: [{ kind: "run", runType: "long", goalZone: 2, isLong: true }],
      sun: [{ kind: "run", runType: "interval", goalZone: 5 }],
    });
    const before = JSON.stringify(days);
    spaceHardRunAfterLongRun(days, new Set<TrainingDayName>(["sun"]));
    expect(JSON.stringify(days)).toBe(before);
  });

  it("end-to-end: no quality run sits the day after the long run", () => {
    for (const phase of ["base", "build", "peak"] as const) {
      const days = assignDays(ALL, phase, "increase", "advanced", "advanced", undefined, {
        longRunDays: ["sat"],
      });
      const li = days.findIndex((d) => d.sessions.some((s) => s.kind === "run" && s.isLong));
      if (li === -1 || li + 1 >= days.length) continue;
      const after = days[li + 1]!;
      for (const s of after.sessions) {
        if (s.kind === "run") expect(["easy", "fartlek", "long"]).toContain(s.runType);
      }
    }
  });
});
