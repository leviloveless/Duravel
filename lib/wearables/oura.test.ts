import { describe, it, expect } from "vitest";
import {
  ouraAuthorizeUrl,
  isTokenExpired,
  expiresAtFromNow,
  durationSeconds,
  normalizeOuraWorkout,
  pickMainSleep,
  buildOuraDailies,
  ouraDateWindow,
  ymd,
  OURA_SCOPE,
  OURA_AUTHORIZE_URL,
} from "./oura";

describe("ouraAuthorizeUrl", () => {
  it("includes client id, redirect, scope, state, response_type", () => {
    const url = ouraAuthorizeUrl("cid", "https://app.duravel.app/cb", "st8");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(OURA_AUTHORIZE_URL);
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.duravel.app/cb");
    expect(u.searchParams.get("scope")).toBe(OURA_SCOPE);
    expect(u.searchParams.get("state")).toBe("st8");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
});

describe("isTokenExpired", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  it("treats null as expired", () => expect(isTokenExpired(null, now)).toBe(true));
  it("expired within 60s window", () =>
    expect(isTokenExpired(new Date(now + 30_000).toISOString(), now)).toBe(true));
  it("valid when comfortably future", () =>
    expect(isTokenExpired(new Date(now + 3_600_000).toISOString(), now)).toBe(false));
  it("expired in the past", () =>
    expect(isTokenExpired(new Date(now - 1000).toISOString(), now)).toBe(true));
});

describe("expiresAtFromNow", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  it("adds expires_in seconds to now", () => {
    expect(expiresAtFromNow(86400, now)).toBe(new Date(now + 86400_000).toISOString());
  });
  it("falls back to 1h on a bad value", () => {
    expect(expiresAtFromNow(0, now)).toBe(new Date(now + 3_600_000).toISOString());
    expect(expiresAtFromNow(NaN, now)).toBe(new Date(now + 3_600_000).toISOString());
  });
});

describe("durationSeconds", () => {
  it("computes positive spans", () => {
    expect(durationSeconds("2026-01-01T10:00:00Z", "2026-01-01T10:30:00Z")).toBe(1800);
  });
  it("returns null on missing / inverted / bad input", () => {
    expect(durationSeconds(null, "2026-01-01T10:30:00Z")).toBeNull();
    expect(durationSeconds("2026-01-01T10:30:00Z", "2026-01-01T10:00:00Z")).toBeNull();
    expect(durationSeconds("nope", "also-nope")).toBeNull();
  });
});

describe("normalizeOuraWorkout", () => {
  it("maps activity/type, times, distance; HR stays null", () => {
    const n = normalizeOuraWorkout({
      id: "abc-123",
      activity: "running",
      start_datetime: "2026-01-01T07:00:00+00:00",
      end_datetime: "2026-01-01T07:45:00+00:00",
      distance: 8200,
    });
    expect(n.externalId).toBe("abc-123");
    expect(n.type).toBe("running");
    expect(n.durationS).toBe(2700);
    expect(n.distanceM).toBe(8200);
    expect(n.avgHr).toBeNull();
    expect(n.maxHr).toBeNull();
  });
  it("tolerates missing id and fields", () => {
    const n = normalizeOuraWorkout({});
    expect(n.externalId).toBe("");
    expect(n.type).toBeNull();
    expect(n.durationS).toBeNull();
  });
});

describe("pickMainSleep", () => {
  it("chooses the longest total_sleep_duration", () => {
    const main = pickMainSleep([
      { id: "nap", total_sleep_duration: 1800 },
      { id: "night", total_sleep_duration: 27000 },
    ]);
    expect(main?.id).toBe("night");
  });
  it("returns null for empty", () => expect(pickMainSleep([])).toBeNull());
});

describe("buildOuraDailies", () => {
  it("merges HRV/resting-HR from main sleep with daily_sleep score by day", () => {
    const rows = buildOuraDailies(
      [
        { day: "2026-01-01", total_sleep_duration: 1200, average_hrv: 20, lowest_heart_rate: 60 },
        { day: "2026-01-01", total_sleep_duration: 27000, average_hrv: 48, lowest_heart_rate: 52 },
        { day: "2026-01-02", total_sleep_duration: 25000, average_hrv: 41, lowest_heart_rate: 55 },
      ],
      [
        { day: "2026-01-01", score: 84 },
        { day: "2026-01-02", score: 77 },
      ],
    );
    // newest-first
    expect(rows.map((r) => r.date)).toEqual(["2026-01-02", "2026-01-01"]);
    const jan1 = rows.find((r) => r.date === "2026-01-01")!;
    expect(jan1.hrv).toBe(48); // from the longer main sleep, not the nap
    expect(jan1.restingHr).toBe(52);
    expect(jan1.sleepScore).toBe(84);
  });

  it("keeps a day that has only a score", () => {
    const rows = buildOuraDailies([], [{ day: "2026-02-01", score: 90 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-02-01", sleepScore: 90, hrv: null, restingHr: null });
  });

  it("drops a day with no usable signal", () => {
    const rows = buildOuraDailies([{ day: "2026-03-01", total_sleep_duration: 100 }], []);
    expect(rows).toHaveLength(0);
  });
});

describe("ouraDateWindow / ymd", () => {
  const now = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15
  it("uses fallbackDays with no prior sync and end_date = tomorrow", () => {
    const w = ouraDateWindow(null, 30, now);
    expect(w.startDate).toBe("2026-05-16");
    expect(w.endDate).toBe("2026-06-16");
  });
  it("backs up one day of overlap from last sync", () => {
    const w = ouraDateWindow("2026-06-10T09:00:00Z", 30, now);
    expect(w.startDate).toBe("2026-06-09");
  });
  it("ymd formats UTC date", () => expect(ymd(now)).toBe("2026-06-15"));
});
