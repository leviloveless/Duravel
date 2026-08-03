import { describe, it, expect } from "vitest";
import { assignDays, resolveLongRunDay, normalizeLongRunDays } from "./slots";
import type { DaySlot, TrainingDayName } from "./types";

const ALL: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAYS: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri"];

const longRunDayOf = (days: DaySlot[]): TrainingDayName | undefined =>
  days.find((d) => d.sessions.some((s) => s.kind === "run" && s.isLong))?.day;
const dayWith = (days: DaySlot[], kind: string): TrainingDayName[] =>
  days.filter((d) => d.sessions.some((s) => s.kind === kind)).map((d) => d.day);
const sessionCount = (days: DaySlot[]): number =>
  days.reduce((n, d) => n + d.sessions.filter((s) => s.kind !== "rest").length, 0);

const build = (trainingDays: TrainingDayName[], prefs?: Parameters<typeof assignDays>[6], race?: Parameters<typeof assignDays>[5]) =>
  assignDays(trainingDays, "build", "increase", "intermediate", "intermediate", race, prefs);

describe("normalizeLongRunDays — accepts both stored shapes", () => {
  it("prefers the multi-day list", () => {
    expect(normalizeLongRunDays({ longRunDays: ["sat", "sun"] })).toEqual(["sat", "sun"]);
  });

  it("falls back to the legacy single day (profiles saved before multi-select)", () => {
    expect(normalizeLongRunDays({ longRunDay: "wed" })).toEqual(["wed"]);
  });

  it("multi-day wins when both are present", () => {
    expect(normalizeLongRunDays({ longRunDay: "wed", longRunDays: ["sun"] })).toEqual(["sun"]);
  });

  it("returns undefined when nothing is set", () => {
    expect(normalizeLongRunDays(undefined)).toBeUndefined();
    expect(normalizeLongRunDays({ longRunDays: [] })).toBeUndefined();
  });
});

describe("resolveLongRunDay", () => {
  it("uses the FIRST selected day, so the long run is the same day every week", () => {
    expect(resolveLongRunDay(ALL, { longRunDays: ["wed", "sat"] })).toBe("wed");
    expect(resolveLongRunDay(ALL, { longRunDays: ["sat", "wed"] })).toBe("sat");
  });

  it("skips a selected day the athlete doesn't actually train", () => {
    expect(resolveLongRunDay(WEEKDAYS, { longRunDays: ["sat", "thu"] })).toBe("thu");
  });

  it("defaults to Saturday when no preference is set", () => {
    expect(resolveLongRunDay(ALL)).toBe("sat");
  });

  it("defaults to Sunday when Saturday isn't trained", () => {
    expect(resolveLongRunDay(["mon", "wed", "fri", "sun"])).toBe("sun");
  });

  it("leaves placement alone for a weekday-only athlete (no weekend to default to)", () => {
    expect(resolveLongRunDay(WEEKDAYS)).toBeUndefined();
  });

  it("never resolves to the race day (the race would overwrite the long run)", () => {
    expect(resolveLongRunDay(ALL, { longRunDays: ["sat"] }, "sat")).toBe("sun");
    expect(resolveLongRunDay(ALL, undefined, "sat")).toBe("sun");
  });

  it("honors the legacy singular preference", () => {
    expect(resolveLongRunDay(ALL, { longRunDay: "tue" })).toBe("tue");
  });
});

describe("assignDays — long run lands on the preferred day", () => {
  it("places the long run on the single selected day", () => {
    expect(longRunDayOf(build(ALL, { longRunDays: ["wed"] }))).toBe("wed");
  });

  it("places it on the first of several selected days, consistently", () => {
    for (const phase of ["base", "build", "peak"] as const) {
      const days = assignDays(ALL, phase, "increase", "intermediate", "intermediate", undefined, {
        longRunDays: ["sun", "sat"],
      });
      expect(longRunDayOf(days)).toBe("sun");
    }
  });

  it("defaults to Saturday when the athlete expressed no preference", () => {
    expect(longRunDayOf(build(ALL))).toBe("sat");
  });

  it("keeps the long run off the race day in a train-through (C) race week", () => {
    const days = build(ALL, undefined, { priority: "C", date: "2026-09-19" }); // Saturday
    expect(dayWith(days, "race")).toEqual(["sat"]);
    expect(longRunDayOf(days)).not.toBe("sat");
    expect(longRunDayOf(days)).toBeDefined(); // the week still HAS its long run
  });

  it("never drops or invents sessions while honoring the preference", () => {
    const plain = assignDays(ALL, "peak", "increase", "advanced", "advanced");
    const pref = build(ALL, { longRunDays: ["tue"] });
    expect(sessionCount(pref)).toBe(sessionCount(plain));
  });

  it("survives the research-lift load guards (long run is not relocated)", () => {
    const days = assignDays(
      ALL, "peak", "increase", "advanced", "advanced", undefined,
      { longRunDays: ["tue"] },
      { index: 0, length: 3 },
      undefined,
      // researchLifts enables separateLifts / spreadRuns / capSessionsPerDay
      { run: { base: [3,4,5], build: [4,5,6], peak: [3,4,4], taper: [2,3,3] },
        hybrid: { base: 1, build: 2, peak: 3, taper: 1 },
        lift: { base: 3, build: 3, peak: 3, taper: 2 },
        researchLifts: true },
    );
    expect(longRunDayOf(days)).toBe("tue");
  });
});

describe("assignDays — weekend carries the biggest default volume", () => {
  it("anchors the long run and the hybrid to Sat + Sun by default", () => {
    const days = build(ALL);
    expect(longRunDayOf(days)).toBe("sat");
    expect(dayWith(days, "hybrid")).toContain("sun");
  });

  it("puts the hybrid on the free weekend day when the long run is pinned midweek", () => {
    const days = build(ALL, { longRunDays: ["wed"] });
    expect(longRunDayOf(days)).toBe("wed");
    expect(dayWith(days, "hybrid")).toContain("sat");
  });

  it("an explicit hybrid-day preference still wins over the weekend anchor", () => {
    const days = build(ALL, { longRunDays: ["sat"], hybridDays: ["tue"] });
    expect(dayWith(days, "hybrid")).toContain("tue");
    expect(longRunDayOf(days)).toBe("sat");
  });
});
