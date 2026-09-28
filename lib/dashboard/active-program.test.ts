import { describe, expect, it } from "vitest";
import { firstLoadDate, mergeDailyLoads, pickActiveProgram, programWindow } from "./active-program";

// Local-time noon, so the Monday arithmetic in weekStartDate is zone-proof.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

// Mondays: 2026-09-07, 09-14, 09-21, 09-28, 10-05 …
const current = { id: "cur", start_date: "2026-09-14", duration_weeks: 8, program_data: {} };
const upcomingSoon = { id: "soon", start_date: "2026-10-05", duration_weeks: 12, program_data: {} };
const upcomingLater = {
  id: "later",
  start_date: "2026-11-02",
  duration_weeks: 12,
  program_data: {},
};
const finished = { id: "old", start_date: "2026-06-01", duration_weeks: 8, program_data: {} };
const empty = { id: "empty", start_date: "2026-09-14", duration_weeks: 8, program_data: null };
const NOW = at(2026, 9, 28);

describe("programWindow", () => {
  it("counts weeks from the Monday of the start week", () => {
    expect(programWindow("2026-09-14", 8, NOW)).toMatchObject({ state: "current", currentWeek: 3 });
    expect(programWindow("2026-09-16", 8, NOW)).toMatchObject({ state: "current", currentWeek: 3 });
  });
  it("reports days to go before the start", () => {
    const w = programWindow("2026-10-05", 12, NOW);
    expect(w.state).toBe("upcoming");
    expect(w.daysToStart).toBe(7);
  });
  it("clamps to the last week once finished", () => {
    expect(programWindow("2026-06-01", 8, NOW)).toMatchObject({
      state: "finished",
      currentWeek: 8,
    });
  });
});

describe("pickActiveProgram", () => {
  it("the athlete's pick wins, even over a program running today", () => {
    const pick = pickActiveProgram([current, upcomingSoon], "soon", NOW);
    expect(pick).toEqual({ program: upcomingSoon, how: "chosen" });
  });
  it("a pick that no longer exists falls back to the rule", () => {
    expect(pickActiveProgram([current], "deleted-id", NOW)?.how).toBe("current");
  });
  it("a pick with no plan data is not usable", () => {
    expect(pickActiveProgram([empty, current], "empty", NOW)?.program.id).toBe("cur");
  });
  it("with no pick, the program running today", () => {
    expect(pickActiveProgram([upcomingSoon, current, finished], null, NOW)?.program.id).toBe("cur");
  });
  it("then the SOONEST upcoming block, not the newest-created one", () => {
    const pick = pickActiveProgram([upcomingLater, upcomingSoon, finished], null, NOW);
    expect(pick).toEqual({ program: upcomingSoon, how: "upcoming" });
  });
  it("then the newest finished one — the dashboard is never blank for an athlete with a program", () => {
    expect(pickActiveProgram([finished], null, NOW)).toEqual({ program: finished, how: "latest" });
  });
  it("nothing usable → null", () => {
    expect(pickActiveProgram([empty], null, NOW)).toBeNull();
    expect(pickActiveProgram([], "x", NOW)).toBeNull();
  });
});

describe("history across programs", () => {
  it("sums the same day from two programs", () => {
    const a = new Map([
      ["2026-09-01", 50],
      ["2026-09-02", 20],
    ]);
    const b = new Map([
      ["2026-09-02", 30],
      ["2026-09-10", 40],
    ]);
    expect([...mergeDailyLoads([a, b])].sort()).toEqual([
      ["2026-09-01", 50],
      ["2026-09-02", 50],
      ["2026-09-10", 40],
    ]);
  });
  it("finds where the history starts", () => {
    expect(
      firstLoadDate(
        new Map([
          ["2026-09-10", 1],
          ["2026-08-30", 2],
        ]),
      ),
    ).toBe("2026-08-30");
    expect(firstLoadDate(new Map())).toBeNull();
  });
});
