/**
 * WHICH WEEK THE PROGRAM VIEW OPENS ON (Levi, 2026-08-25).
 *
 * The program page shows one week at a time now, so "which week" stopped being
 * cosmetic — get it wrong and every visit starts with a click. It opens on the
 * week the athlete is actually training.
 *
 * The edges are the whole test: a program that hasn't started yet, one that
 * finished months ago, and the Monday boundary. Program weeks are MONDAY-
 * anchored (`weekStartDate`), so a program starting on a Thursday has a week 1
 * that began the Monday BEFORE its start date — which means the week number can
 * legitimately advance only three days in.
 */
import { describe, it, expect } from "vitest";
import { currentWeekNumber, weekStartDate } from "@/components/program/format";

/** Thursday. Week 1 is therefore the Monday-anchored week containing it. */
const START = "2026-09-03";
const WEEKS = 16;
const at = (iso: string) => currentWeekNumber(START, WEEKS, new Date(iso));

describe("the week the program opens on", () => {
  it("is week 1 before the program has started", () => {
    expect(at("2026-08-01T12:00:00")).toBe(1);
    expect(at("2026-08-30T12:00:00")).toBe(1);
  });

  it("is week 1 on the start date itself", () => {
    expect(at("2026-09-03T06:00:00")).toBe(1);
  });

  it("advances on the Monday, not on the start date's weekday", () => {
    // Week 1 runs from Mon Aug 31 (the Monday of the start week).
    expect(weekStartDate(START, 1).getDay()).toBe(1);
    expect(at("2026-09-06T23:00:00")).toBe(1); // Sunday — still week 1
    expect(at("2026-09-07T00:30:00")).toBe(2); // Monday — week 2
  });

  it("tracks the middle of the program", () => {
    expect(at("2026-10-05T12:00:00")).toBe(6);
    expect(at("2026-11-16T12:00:00")).toBe(12);
  });

  it("is the LAST week once the program is over, never past the end", () => {
    expect(at("2026-12-21T12:00:00")).toBe(WEEKS);
    expect(at("2027-06-01T12:00:00")).toBe(WEEKS);
  });

  it("never returns a week the program does not have", () => {
    for (const weeks of [1, 4, 8, 12, 16, 24]) {
      for (const day of ["2026-01-01", "2026-09-03", "2026-10-15", "2030-01-01"]) {
        const n = currentWeekNumber(START, weeks, new Date(`${day}T12:00:00`));
        expect(n, `${weeks}w @ ${day}`).toBeGreaterThanOrEqual(1);
        expect(n, `${weeks}w @ ${day}`).toBeLessThanOrEqual(weeks);
      }
    }
  });

  it("survives a zero-week program rather than returning 0", () => {
    expect(currentWeekNumber(START, 0, new Date("2026-10-01T12:00:00"))).toBe(1);
  });
});
