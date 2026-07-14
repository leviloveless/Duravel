import { describe, it, expect } from "vitest";
import {
  afterEpochFromLastSync,
  activityToRow,
  newActivityIds,
  readinessFromDaily,
  activityFamily,
  matchActivityToSession,
  type PlannedSessionRef,
} from "./ingest";
import type { NormalizedActivity } from "./types";

const now = Date.UTC(2026, 0, 31, 12, 0, 0);

describe("afterEpochFromLastSync", () => {
  it("looks back fallbackDays when never synced", () => {
    const epoch = afterEpochFromLastSync(null, 30, now);
    expect(epoch).toBe(Math.floor((now - 30 * 86400_000) / 1000));
  });
  it("backs up one day of overlap from the last sync", () => {
    const last = new Date(now).toISOString();
    expect(afterEpochFromLastSync(last, 30, now)).toBe(Math.floor((now - 86400_000) / 1000));
  });
  it("falls back on an unparseable timestamp", () => {
    expect(afterEpochFromLastSync("not-a-date", 30, now)).toBe(
      Math.floor((now - 30 * 86400_000) / 1000),
    );
  });
});

describe("activityToRow", () => {
  it("maps a normalized activity to DB columns", () => {
    const a: NormalizedActivity = {
      externalId: "5", type: "Run", startTime: "2026-01-30T10:00:00Z",
      durationS: 1800, distanceM: 5000, avgHr: 150, maxHr: 170, raw: { id: 5 },
    };
    const row = activityToRow("u1", "strava", a);
    expect(row).toMatchObject({
      user_id: "u1", provider: "strava", external_id: "5", type: "Run",
      duration_s: 1800, distance_m: 5000, avg_hr: 150, max_hr: 170,
    });
  });
});

describe("newActivityIds", () => {
  it("returns only ids not already present, skipping blanks", () => {
    const incoming = [
      { externalId: "a" }, { externalId: "b" }, { externalId: "" }, { externalId: "c" },
    ] as NormalizedActivity[];
    expect(newActivityIds(["b"], incoming)).toEqual(["a", "c"]);
  });
});

describe("readinessFromDaily", () => {
  it("returns null when nothing usable", () => {
    expect(readinessFromDaily([{ date: "2026-01-01", resting_hr: null, hrv: null }])).toBeNull();
  });
  it("picks the most recent row with a value", () => {
    const r = readinessFromDaily([
      { date: "2026-01-01", resting_hr: 50, hrv: 80 },
      { date: "2026-01-03", resting_hr: 48, hrv: null },
      { date: "2026-01-02", resting_hr: null, hrv: 90 },
    ]);
    expect(r).toEqual({ date: "2026-01-03", restingHr: 48, hrv: null });
  });
});

describe("activityFamily", () => {
  it("classifies common types", () => {
    expect(activityFamily("Run")).toBe("run");
    expect(activityFamily("TrailRun")).toBe("run");
    expect(activityFamily("Ride")).toBe("bike");
    expect(activityFamily("Rowing")).toBe("row_ski");
    expect(activityFamily("WeightTraining")).toBe("strength");
    expect(activityFamily("Workout")).toBe("hybrid");
    expect(activityFamily(null)).toBe("other");
  });
});

describe("matchActivityToSession (scaffold)", () => {
  const sessions: PlannedSessionRef[] = [
    { weekNumber: 1, day: "mon", sessionIndex: 0, kind: "run_easy", dateIso: "2026-01-30" },
    { weekNumber: 1, day: "mon", sessionIndex: 1, kind: "lift_full", dateIso: "2026-01-30" },
  ];
  it("matches a run to the run session on the same day", () => {
    const m = matchActivityToSession({ type: "Run", startTime: "2026-01-30T09:00:00Z" }, sessions);
    expect(m?.kind).toBe("run_easy");
  });
  it("matches strength to the lift session", () => {
    const m = matchActivityToSession({ type: "WeightTraining", startTime: "2026-01-30T18:00:00Z" }, sessions);
    expect(m?.kind).toBe("lift_full");
  });
  it("returns null when no session shares the date", () => {
    expect(matchActivityToSession({ type: "Run", startTime: "2026-02-05T09:00:00Z" }, sessions)).toBeNull();
  });
  it("returns null without a start time", () => {
    expect(matchActivityToSession({ type: "Run", startTime: null }, sessions)).toBeNull();
  });
});
