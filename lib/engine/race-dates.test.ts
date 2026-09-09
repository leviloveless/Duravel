/**
 * THE YEAR 0226 (Levi, 2026-09-09).
 *
 * He built a program and reported three bugs: an A race on a day he never
 * picked, his authored week's days ignored, and a build he expected to run to
 * late November coming out four weeks long.
 *
 * One typo. The A race was stored as `0226-11-21` — year 226 — entered through a
 * native date field, which accepts a three-digit year without a word. Everything
 * after that was the engine behaving correctly on nonsense:
 *
 *   - the race is ~1,800 years before the start, so `weekNumber` floors at 1 and
 *     the A race lands in week 1, rendered on the start date;
 *   - `durationWeeks` is the furthest race's week, leaving only the B race — four
 *     weeks out;
 *   - and an A-race week belongs to the taper protocol, so the authored week is
 *     discarded BY DESIGN.
 *
 * None of the three symptoms points at a date. That is what makes this worth a
 * test file of its own rather than a line in a validator: the cost of accepting
 * a bad date is not a bad date, it is three plausible-looking bugs somewhere
 * else entirely.
 */
import { describe, it, expect } from "vitest";
import { checkRaceDates, parseIsoDate, weeksBetween, MAX_PROGRAM_WEEKS } from "./race-dates";

const A = (raceDate: string) => ({ raceDate, priority: "A" });

describe("the year 0226", () => {
  it("is refused, and says the year is the problem", () => {
    const issues = checkRaceDates([A("0226-11-21")], "2026-09-14");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("year");
  });

  it("does not merely read as 'before your start date'", () => {
    // It IS before the start date, and saying so would send the athlete to the
    // wrong control. The remedy is to fix four digits, so the message has to
    // name them.
    const issues = checkRaceDates([A("0226-11-21")], "2026-09-14");
    expect(issues[0]!.message).not.toContain("start date");
  });

  it("accepts the date he meant", () => {
    expect(checkRaceDates([A("2026-11-21")], "2026-09-14")).toEqual([]);
  });
});

describe("dates that are wrong in the ordinary ways", () => {
  it("refuses a race before the start, and names the two ways out", () => {
    const issues = checkRaceDates([A("2026-08-01")], "2026-09-14");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("before your start date");
    expect(issues[0]!.message).toContain("start the program earlier");
  });

  it("refuses a race further out than a program can run", () => {
    // The engine clamps duration to 24 weeks, so a race 40 weeks away silently
    // becomes a 24-week program aimed at nothing. Saying so beats guessing.
    const issues = checkRaceDates([A("2027-07-01")], "2026-09-14");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain(String(MAX_PROGRAM_WEEKS));
  });

  it("accepts a race exactly at the limit", () => {
    const start = new Date(Date.parse("2026-09-14T00:00:00Z"));
    const at24 = new Date(start.getTime() + MAX_PROGRAM_WEEKS * 7 * 24 * 3600 * 1000);
    expect(checkRaceDates([A(at24.toISOString().slice(0, 10))], "2026-09-14")).toEqual([]);
  });

  it("reports every bad race, not just the first", () => {
    const issues = checkRaceDates(
      [A("0226-11-21"), { raceDate: "2026-08-01", priority: "B" }],
      "2026-09-14",
    );
    expect(issues.map((i) => i.index)).toEqual([0, 1]);
  });
});

describe("parseIsoDate", () => {
  it("takes a plain calendar date", () => {
    expect(parseIsoDate("2026-11-21")?.toISOString().slice(0, 10)).toBe("2026-11-21");
  });

  it("refuses a day that does not exist", () => {
    // `Date.parse` rolls 2026-02-30 forward to March. A round-trip catches it.
    expect(parseIsoDate("2026-02-30")).toBeNull();
  });

  it("refuses anything that is not yyyy-mm-dd", () => {
    for (const v of ["", "21/11/2026", "2026-11", "not a date", undefined]) {
      expect(parseIsoDate(v)).toBeNull();
    }
  });

  it("reads as UTC, so the answer does not depend on who is asking", () => {
    // Parsed through `new Date(v)` this once differed by a day either side of
    // UTC, which moved a race a week in the skeleton.
    expect(parseIsoDate("2026-11-21")!.getUTCDate()).toBe(21);
  });
});

describe("weeksBetween", () => {
  it("rounds up, matching the engine's own week numbering", () => {
    const start = parseIsoDate("2026-09-14")!;
    expect(weeksBetween(start, parseIsoDate("2026-09-14")!)).toBe(0);
    expect(weeksBetween(start, parseIsoDate("2026-09-15")!)).toBe(1);
    expect(weeksBetween(start, parseIsoDate("2026-09-21")!)).toBe(1);
    expect(weeksBetween(start, parseIsoDate("2026-09-22")!)).toBe(2);
    expect(weeksBetween(start, parseIsoDate("2026-11-21")!)).toBe(10);
  });
});
