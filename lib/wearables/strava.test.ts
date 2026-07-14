import { describe, it, expect } from "vitest";
import {
  stravaAuthorizeUrl,
  isTokenExpired,
  normalizeStravaActivity,
  expiresAtIso,
  STRAVA_SCOPE,
} from "./strava";

describe("stravaAuthorizeUrl", () => {
  it("includes client id, redirect, scope, and state", () => {
    const url = stravaAuthorizeUrl("123", "https://x.app/cb", "abc");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("123");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x.app/cb");
    expect(u.searchParams.get("scope")).toBe(STRAVA_SCOPE);
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
});

describe("isTokenExpired", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  it("treats a null expiry as expired", () => {
    expect(isTokenExpired(null, now)).toBe(true);
  });
  it("is expired within the 60s safety window", () => {
    expect(isTokenExpired(new Date(now + 30_000).toISOString(), now)).toBe(true);
  });
  it("is valid when comfortably in the future", () => {
    expect(isTokenExpired(new Date(now + 3_600_000).toISOString(), now)).toBe(false);
  });
  it("is expired when in the past", () => {
    expect(isTokenExpired(new Date(now - 1_000).toISOString(), now)).toBe(true);
  });
});

describe("expiresAtIso", () => {
  it("converts epoch seconds to ISO", () => {
    expect(expiresAtIso(1_767_268_800)).toBe(new Date(1_767_268_800_000).toISOString());
  });
});

describe("normalizeStravaActivity", () => {
  it("maps fields and prefers sport_type + moving_time", () => {
    const n = normalizeStravaActivity({
      id: 987,
      sport_type: "Run",
      type: "Workout",
      start_date: "2026-01-01T10:00:00Z",
      moving_time: 1800,
      elapsed_time: 2000,
      distance: 5000,
      average_heartrate: 152,
      max_heartrate: 175,
    });
    expect(n.externalId).toBe("987");
    expect(n.type).toBe("Run");
    expect(n.durationS).toBe(1800);
    expect(n.distanceM).toBe(5000);
    expect(n.avgHr).toBe(152);
    expect(n.maxHr).toBe(175);
  });

  it("falls back to elapsed_time and tolerates missing HR", () => {
    const n = normalizeStravaActivity({ id: 1, type: "Ride", elapsed_time: 600, distance: 0 });
    expect(n.type).toBe("Ride");
    expect(n.durationS).toBe(600);
    expect(n.avgHr).toBeNull();
    expect(n.maxHr).toBeNull();
  });

  it("coerces a numeric id to string and handles missing id", () => {
    expect(normalizeStravaActivity({ id: 42 }).externalId).toBe("42");
    expect(normalizeStravaActivity({}).externalId).toBe("");
  });
});
