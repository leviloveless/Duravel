import { describe, it, expect } from "vitest";
import { garminAuthorizeUrl, normalizeGarminDaily, GARMIN_SCOPE } from "./garmin";

describe("garminAuthorizeUrl", () => {
  it("includes client id, redirect, scope, and state", () => {
    const u = new URL(garminAuthorizeUrl("cid", "https://x.app/cb", "st"));
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x.app/cb");
    expect(u.searchParams.get("scope")).toBe(GARMIN_SCOPE);
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
});

describe("normalizeGarminDaily", () => {
  it("maps documented field names", () => {
    const d = normalizeGarminDaily({
      calendarDate: "2026-01-30",
      restingHeartRateInBeatsPerMinute: 47,
      avgOvernightHrv: 92,
      overallSleepScore: 85,
    });
    expect(d).toMatchObject({ date: "2026-01-30", restingHr: 47, hrv: 92, sleepScore: 85 });
  });

  it("tolerates variant field names and missing values", () => {
    const d = normalizeGarminDaily({ date: "2026-01-31", restingHeartRate: 50, hrv: 80 });
    expect(d.date).toBe("2026-01-31");
    expect(d.restingHr).toBe(50);
    expect(d.hrv).toBe(80);
    expect(d.sleepScore).toBeNull();
  });

  it("defaults date to empty string when absent", () => {
    expect(normalizeGarminDaily({}).date).toBe("");
  });
});
