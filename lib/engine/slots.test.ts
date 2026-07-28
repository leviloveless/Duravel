import { describe, it, expect } from "vitest";
import { assignDays, raceDayIndex } from "./slots";
import type { DaySlot, TrainingDayName } from "./types";

const ALL_DAYS: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const slotsFor = (keys: TrainingDayName[]): DaySlot[] => keys.map((day) => ({ day, sessions: [] }));

const raceDayKey = (days: DaySlot[]): TrainingDayName | undefined =>
  days.find((d) => d.sessions.some((s) => s.kind === "race"))?.day;

describe("raceDayIndex — place a race on its real weekday", () => {
  it("maps an ISO date to the matching training day (Sat 2026-09-19 → sat)", () => {
    // 2026-09-19 is a Saturday.
    expect(raceDayIndex(slotsFor(ALL_DAYS), "2026-09-19")).toBe(ALL_DAYS.indexOf("sat"));
  });

  it("falls back to the LAST training day when no date is supplied", () => {
    const days = slotsFor(ALL_DAYS);
    expect(raceDayIndex(days, undefined)).toBe(days.length - 1); // sun
  });

  it("falls back to the last training day when the race weekday isn't trained", () => {
    // Athlete doesn't train Saturday; a Saturday race falls back to the last day.
    const days = slotsFor(["mon", "wed", "fri", "sun"]);
    expect(raceDayIndex(days, "2026-09-19")).toBe(days.length - 1); // sun
  });

  it("parses the date locally (no timezone shift off-by-one)", () => {
    // 2026-09-20 is a Sunday — must not bleed into Saturday/Monday.
    expect(raceDayIndex(slotsFor(ALL_DAYS), "2026-09-20")).toBe(ALL_DAYS.indexOf("sun"));
  });
});

describe("assignDays — C race lands on the correct calendar weekday", () => {
  it("puts a Saturday C race on Saturday, not the last training day (Sunday)", () => {
    const days = assignDays(
      ALL_DAYS,
      "base",
      "rebound",
      "intermediate",
      "intermediate",
      { priority: "C", date: "2026-09-19" }, // Saturday
    );
    expect(raceDayKey(days)).toBe("sat");
    // Exactly one race session, and it's the only thing on that day.
    const raceDay = days.find((d) => d.day === "sat")!;
    expect(raceDay.sessions).toEqual([{ kind: "race", priority: "C" }]);
    expect(days.flatMap((d) => d.sessions).filter((s) => s.kind === "race")).toHaveLength(1);
  });

  it("without a date, keeps the legacy last-training-day placement", () => {
    const days = assignDays(
      ALL_DAYS,
      "base",
      "rebound",
      "intermediate",
      "intermediate",
      { priority: "C" },
    );
    expect(raceDayKey(days)).toBe("sun");
  });
});
