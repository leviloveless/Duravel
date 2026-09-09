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
import {
  START_DATE_PAST_GRACE_DAYS,
  checkRaceDates,
  checkStartDate,
  parseIsoDate,
  weeksBetween,
  MAX_PROGRAM_WEEKS,
} from "./race-dates";
import { toEngineInput, buildSkeleton } from "./skeleton";
import type { GenerationInput } from "@/lib/schemas";

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

/**
 * THE FIELD ONE CONTROL ABOVE.
 *
 * The race-date fix closed the input that was reported. It did not close the
 * class: `startDate` sits directly above the race rows on the same step, in the
 * same kind of native date field, wearing the same `min` attribute that this
 * form's blocked native submit renders decorative — and `checkRaceDates` opens
 * the door to it explicitly, bailing out with "no usable start date; the caller
 * reports that separately" when it cannot parse one. Until `checkStartDate`
 * existed, no caller did.
 *
 * The measurements below are from a HYROX goal-event build with a single A race
 * eleven weeks out. They are asserted, not just described, because the numbers
 * are the argument.
 */
const HYROX_11_WEEKS = {
  profile: {
    firstName: "Test",
    age: 35,
    bodyWeight: 175,
    weightUnit: "lbs",
    runningExp: "intermediate",
    hybridExp: "intermediate",
    liftingExp: "intermediate",
    trainingClass: "non_highly_trained",
    trainingDays: ["mon", "tue", "wed", "thu", "fri"],
  },
  programType: "goal_event",
  sport: "hyrox",
  races: [{ raceDate: "2026-11-21", priority: "A" }],
} as unknown as GenerationInput;

describe("what a bad start date actually does", () => {
  it("builds the program it was asked for from a good one", () => {
    const ei = toEngineInput(HYROX_11_WEEKS, "2026-09-09");
    expect(ei.durationWeeks).toBe(11);
    expect(ei.races[0]!.weekNumber).toBe(11);
  });

  it("turns an eleven-week build into a 24-week one on a three-digit year", () => {
    // The same keystroke as the incident, in the field above it. Nothing on
    // screen says "date": the athlete sees a program more than twice as long as
    // they asked for, aimed at a week that is not their race week.
    const ei = toEngineInput(HYROX_11_WEEKS, "0226-09-09");
    expect(ei.durationWeeks).toBe(24);
    expect(ei.races[0]!.weekNumber).toBe(24);
  });

  it("does the same from a date merely long past", () => {
    const ei = toEngineInput(HYROX_11_WEEKS, "1990-01-01");
    expect(ei.durationWeeks).toBe(24);
    expect(ei.races[0]!.weekNumber).toBe(24);
  });

  it("throws outright on a start date that is not a date", () => {
    // `new Date("banana").getTime()` is NaN, `Math.max(1, NaN)` is NaN, and
    // `clamp` propagates it — so `durationWeeks` leaves `toEngineInput` as NaN
    // and every race is silently dropped on the way. `buildSkeleton` then sizes
    // its week array from it: an unhandled RangeError, i.e. a 500, not a
    // message. Not reachable from a date picker, but the edit path and any
    // non-browser caller reach it fine.
    const ei = toEngineInput(HYROX_11_WEEKS, "banana");
    expect(Number.isNaN(ei.durationWeeks)).toBe(true);
    expect(ei.races).toEqual([]);
    expect(() => buildSkeleton(ei)).toThrow(/Invalid array length/);
  });
});

describe("checkStartDate", () => {
  const TODAY = "2026-09-09";

  it("refuses the three-digit year, and says the year is the problem", () => {
    const msg = checkStartDate("0226-09-09", TODAY);
    expect(msg).toContain("year");
    // Same reasoning as the race message: the remedy is four digits. Telling an
    // athlete their start date is "in the past" sends them to the calendar
    // rather than to the keystroke that has to change.
    expect(msg).not.toContain("in the past");
  });

  it("refuses a start date that is not a calendar date at all", () => {
    for (const v of ["banana", "2026-13-45", "09/09/2026", "2026-02-30"]) {
      expect(checkStartDate(v, TODAY)).toContain("real calendar date");
    }
  });

  it("accepts a blank start date — both callers default it to today", () => {
    expect(checkStartDate(undefined, TODAY)).toBeNull();
    expect(checkStartDate("", TODAY)).toBeNull();
  });

  it("accepts today and the future", () => {
    expect(checkStartDate(TODAY, TODAY)).toBeNull();
    expect(checkStartDate("2026-12-25", TODAY)).toBeNull();
  });

  it("refuses a new program dated well before today, and names the way out", () => {
    const msg = checkStartDate("1990-01-01", TODAY);
    expect(msg).toContain("year"); // year 1990 is caught by the year rule first
    const recent = checkStartDate("2026-06-01", TODAY);
    expect(recent).toContain("pick a start date from today on");
  });

  it("leaves a day's timezone slack, because the form's 'today' is UTC", () => {
    // The form defaults `startDate` from `new Date().toISOString()` — a UTC
    // date — while the athlete picks from a calendar drawn in their own zone. In
    // UTC-8 at 5pm those disagree by a day, and rejecting the date the picker
    // calls "today" would be a bug of our own making.
    expect(checkStartDate("2026-09-08", TODAY)).toBeNull();
    expect(checkStartDate("2026-09-06", TODAY)).toBeNull();
    const beyond = new Date(
      Date.parse(`${TODAY}T00:00:00Z`) - (START_DATE_PAST_GRACE_DAYS + 1) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    expect(checkStartDate(beyond, TODAY)).toContain("days ago");
  });

  it("lets an EDIT keep a start date in the past, but not a broken one", () => {
    // A program mid-flight started weeks ago; refusing that would make
    // recalculating one impossible. The year rule still applies, because that is
    // the half that produces a wrong program rather than an old one.
    expect(checkStartDate("2026-06-01", TODAY, { allowPast: true })).toBeNull();
    expect(checkStartDate("0226-09-09", TODAY, { allowPast: true })).toContain("year");
    expect(checkStartDate("banana", TODAY, { allowPast: true })).toContain("real calendar date");
  });
});
