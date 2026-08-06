/**
 * REGRESSION — `start_date_local` must carry LOCAL wall-clock numbers.
 *
 * Seen live 2026-08-06: a workout logged at 8:12am CDT appeared on Strava at
 * 1:12 PM (activity 19626903555). `createManualActivity` was handed
 * `new Date().toISOString()` — the right SHAPE for `start_date_local` but with
 * UTC numbers, and Strava reads that field as the athlete's local clock.
 */
import { describe, it, expect } from "vitest";
import { localWallClockIso, resolveTimeZone, isValidTimeZone, UTC } from "./timezone";

/** The instant Levi logged the threshold run: 2026-08-06 13:12:34 UTC = 8:12:34 CDT. */
const LOGGED_AT = new Date("2026-08-06T13:12:34.000Z");

describe("isValidTimeZone", () => {
  it("accepts real IANA names", () => {
    for (const tz of ["America/Chicago", "UTC", "Europe/London", "Australia/Eucla"]) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
  });

  it("rejects junk, empty and missing values", () => {
    for (const tz of ["", "  ", "Mars/Olympus_Mons", "CDT", null, undefined]) {
      expect(isValidTimeZone(tz as string | null | undefined), String(tz)).toBe(false);
    }
  });
});

describe("resolveTimeZone", () => {
  it("falls back to UTC rather than throwing", () => {
    expect(resolveTimeZone(null)).toBe(UTC);
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(UTC);
    expect(resolveTimeZone("America/Chicago")).toBe("America/Chicago");
  });
});

describe("localWallClockIso", () => {
  it("stamps the athlete's wall clock, not UTC", () => {
    // The bug: this used to be 13:12:34.
    expect(localWallClockIso(LOGGED_AT, "America/Chicago")).toBe("2026-08-06T08:12:34Z");
  });

  it("is unchanged for an athlete actually in UTC", () => {
    expect(localWallClockIso(LOGGED_AT, "UTC")).toBe("2026-08-06T13:12:34Z");
  });

  it("falls back to UTC when the zone is missing or unusable", () => {
    const utc = LOGGED_AT.toISOString().replace(/\.\d{3}Z$/, "Z");
    expect(localWallClockIso(LOGGED_AT, null)).toBe(utc);
    expect(localWallClockIso(LOGGED_AT, "Not/AZone")).toBe(utc);
  });

  it("crosses the date line the right way", () => {
    // 13:12 UTC on the 6th is already the 6th at 22:12 in Tokyo...
    expect(localWallClockIso(LOGGED_AT, "Asia/Tokyo")).toBe("2026-08-06T22:12:34Z");
    // ...and still the 6th at 06:12 in Honolulu.
    expect(localWallClockIso(LOGGED_AT, "Pacific/Honolulu")).toBe("2026-08-06T03:12:34Z");
    // An instant that IS a different calendar day locally.
    const lateUtc = new Date("2026-08-06T02:30:00.000Z");
    expect(localWallClockIso(lateUtc, "America/Chicago")).toBe("2026-08-05T21:30:00Z");
  });

  it("handles DST on both sides of the change", () => {
    // Chicago is UTC-5 in August (CDT) and UTC-6 in January (CST).
    expect(localWallClockIso(new Date("2026-01-15T13:12:34.000Z"), "America/Chicago")).toBe(
      "2026-01-15T07:12:34Z",
    );
  });

  it("renders local midnight as 00, never 24", () => {
    const t = new Date("2026-08-06T05:00:00.000Z"); // exactly midnight CDT
    expect(localWallClockIso(t, "America/Chicago")).toBe("2026-08-06T00:00:00Z");
  });

  it("always emits a shape Strava accepts", () => {
    for (const tz of ["America/Chicago", "UTC", "Asia/Kolkata", "Not/AZone", null]) {
      expect(localWallClockIso(LOGGED_AT, tz), String(tz)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      );
    }
  });

  it("does not throw on an invalid Date", () => {
    expect(() => localWallClockIso(new Date("nonsense"), "America/Chicago")).not.toThrow();
  });
});
