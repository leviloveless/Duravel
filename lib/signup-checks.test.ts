import { describe, it, expect } from "vitest";
import { parseDob, ageOn, splitName, MIN_AGE_YEARS } from "@/lib/signup-checks";

/**
 * Fixed "today" so these never go stale or flake across a birthday.
 *
 * ⚠️ BUILT WITH THE LOCAL CONSTRUCTOR, NEVER `Date.UTC`. `ageOn` compares
 * CALENDAR components and reads them with local getters, because an athlete's
 * age gate should turn over on their own midnight, not on UTC's. So
 * `Date.UTC(2026, 8, 13)` is not "13 September" anywhere west of Greenwich — in
 * New York it is 12 September at 20:00, and every birthday-boundary assertion
 * below then reads one year young.
 *
 * These three tests passed in a UTC container and failed on Levi's machine.
 * A fixture that only means what it says in one time zone is a broken fixture.
 */
const NOW = new Date(2026, 8, 13); // 13 Sep 2026, local

describe("ageOn", () => {
  it("counts whole years", () => {
    expect(ageOn("1999-04-14", NOW)).toBe(27);
  });

  it("does not credit a birthday that has not happened yet this year", () => {
    expect(ageOn("1999-12-31", NOW)).toBe(26);
  });

  it("credits the birthday on the day itself", () => {
    expect(ageOn("2000-09-13", NOW)).toBe(26);
  });

  it("ages a 29 February birthday on 1 March in a common year", () => {
    // The month/day comparison puts them past 29 Feb once March starts.
    // Local constructor, for the reason given on NOW above.
    expect(ageOn("2004-02-29", new Date(2026, 2, 1))).toBe(22);
    expect(ageOn("2004-02-29", new Date(2026, 1, 28))).toBe(21);
  });
});

describe("parseDob", () => {
  it("accepts a real date and returns ISO plus age", () => {
    const r = parseDob({ month: "04", day: "14", year: "1999" }, NOW);
    expect(r).toEqual({ ok: true, iso: "1999-04-14", age: 27 });
  });

  it("accepts unpadded input", () => {
    const r = parseDob({ month: "4", day: "7", year: "1999" }, NOW);
    expect(r.ok && r.iso).toBe("1999-04-07");
  });

  it("rejects a blank box", () => {
    expect(parseDob({ month: "04", day: "", year: "1999" }, NOW).ok).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(parseDob({ month: "Apr", day: "14", year: "1999" }, NOW).ok).toBe(false);
  });

  /**
   * The year-0226 class of bug, which in onboarding produced three unrelated-
   * looking bug reports. Here a two-digit year would read as year 99 and make a
   * 1,927-year-old; the year range is checked FIRST so the message names the
   * actual mistake.
   */
  it("rejects a two-digit year and says so", () => {
    const r = parseDob({ month: "04", day: "14", year: "99" }, NOW);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/four digits/i);
  });

  it("rejects a four-digit year typo far in the past", () => {
    expect(parseDob({ month: "11", day: "21", year: "0226" }, NOW).ok).toBe(false);
  });

  it("rejects an impossible calendar date rather than rolling it forward", () => {
    // Date(2001, 1, 31) silently becomes 3 March; the round-trip catches it.
    const r = parseDob({ month: "02", day: "31", year: "2001" }, NOW);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/does not exist/i);
  });

  it("accepts 29 February in a leap year", () => {
    expect(parseDob({ month: "02", day: "29", year: "2004" }, NOW).ok).toBe(true);
  });

  it("rejects 29 February in a common year", () => {
    expect(parseDob({ month: "02", day: "29", year: "2003" }, NOW).ok).toBe(false);
  });

  it("rejects a future date of birth", () => {
    expect(parseDob({ month: "12", day: "01", year: "2026" }, NOW).ok).toBe(false);
  });

  it("rejects a month outside 1-12", () => {
    expect(parseDob({ month: "13", day: "01", year: "1999" }, NOW).ok).toBe(false);
  });

  describe("the age gate", () => {
    it("rejects someone under 13", () => {
      const r = parseDob({ month: "09", day: "14", year: "2013" }, NOW); // 12y 364d
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toMatch(new RegExp(`${MIN_AGE_YEARS}`));
    });

    it("accepts someone on their 13th birthday", () => {
      const r = parseDob({ month: "09", day: "13", year: "2013" }, NOW);
      expect(r).toEqual({ ok: true, iso: "2013-09-13", age: 13 });
    });
  });
});

describe("splitName", () => {
  it("splits first and last", () => {
    expect(splitName("Levi Loveless")).toEqual({ firstName: "Levi", lastName: "Loveless" });
  });

  it("keeps every token after the first as the last name", () => {
    expect(splitName("Levi Barton Loveless")).toEqual({
      firstName: "Levi",
      lastName: "Barton Loveless",
    });
  });

  it("handles a single name", () => {
    expect(splitName("Levi")).toEqual({ firstName: "Levi", lastName: null });
  });

  it("collapses stray whitespace", () => {
    expect(splitName("  Levi   Loveless  ")).toEqual({
      firstName: "Levi",
      lastName: "Loveless",
    });
  });
});
