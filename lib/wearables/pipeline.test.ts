import { describe, it, expect } from "vitest";
import {
  normalizeActivityType,
  dedupeFamily,
  sameSession,
  dedupeActivities,
  activityToCanonicalRow,
  type DedupeActivity,
} from "./pipeline";
import type { NormalizedActivity } from "./types";

describe("normalizeActivityType", () => {
  it("maps Strava/Oura/HK types to canonical slugs", () => {
    expect(normalizeActivityType("Run")).toBe("run");
    expect(normalizeActivityType("TrailRun")).toBe("run");
    expect(normalizeActivityType("running")).toBe("run");
    expect(normalizeActivityType("VirtualRide")).toBe("ride");
    expect(normalizeActivityType("cycling")).toBe("ride");
    expect(normalizeActivityType("WeightTraining")).toBe("strength");
    expect(normalizeActivityType("traditionalStrengthTraining")).toBe("strength");
    expect(normalizeActivityType("Swim")).toBe("swim");
    expect(normalizeActivityType("highIntensityIntervalTraining")).toBe("hiit");
    expect(normalizeActivityType("Rowing")).toBe("row");
    expect(normalizeActivityType(null)).toBe("other");
    expect(normalizeActivityType("Kitesurf")).toBe("other");
  });
});

describe("dedupeFamily", () => {
  it("collapses foot-cardio and strength families", () => {
    expect(dedupeFamily("run")).toBe("foot");
    expect(dedupeFamily("walk")).toBe("foot");
    expect(dedupeFamily("hike")).toBe("foot");
    expect(dedupeFamily("strength")).toBe("strength");
    expect(dedupeFamily("core")).toBe("strength");
    expect(dedupeFamily("ride")).toBe("ride");
    expect(dedupeFamily("swim")).toBe("swim");
  });
});

const base = (o: Partial<DedupeActivity>): DedupeActivity => ({
  externalId: o.externalId ?? "x",
  provider: o.provider ?? "strava",
  slug: o.slug ?? "run",
  startTime: o.startTime ?? "2026-07-01T10:00:00Z",
  durationS: o.durationS ?? 1800,
  distanceM: o.distanceM ?? 5000,
  manualEntry: o.manualEntry,
});

describe("sameSession", () => {
  it("matches the same run from Strava + Apple Health within tolerances", () => {
    const a = base({ provider: "strava", externalId: "s1" });
    const b = base({ provider: "apple_health", externalId: "h1", startTime: "2026-07-01T10:00:45Z", durationS: 1815, distanceM: 5040 });
    expect(sameSession(a, b)).toBe(true);
  });
  it("never matches two activities from the SAME provider", () => {
    const a = base({ provider: "strava", externalId: "s1" });
    const b = base({ provider: "strava", externalId: "s2" });
    expect(sameSession(a, b)).toBe(false);
  });
  it("rejects when start times differ beyond 90s", () => {
    const a = base({ provider: "strava" });
    const b = base({ provider: "oura", startTime: "2026-07-01T10:02:00Z" });
    expect(sameSession(a, b)).toBe(false);
  });
  it("rejects a run vs a ride even at the same time", () => {
    const a = base({ provider: "strava", slug: "run" });
    const b = base({ provider: "apple_health", slug: "ride" });
    expect(sameSession(a, b)).toBe(false);
  });
  it("ignores distance when one side has none (strength)", () => {
    const a = base({ provider: "strava", slug: "strength", distanceM: null });
    const b = base({ provider: "apple_health", slug: "strength", distanceM: null, startTime: "2026-07-01T10:00:30Z" });
    expect(sameSession(a, b)).toBe(true);
  });
  it("rejects when distances diverge beyond tolerance", () => {
    const a = base({ provider: "strava", distanceM: 5000 });
    const b = base({ provider: "oura", distanceM: 8000 });
    expect(sameSession(a, b)).toBe(false);
  });
});

describe("dedupeActivities", () => {
  it("clusters a cross-source duplicate and picks Strava as primary over Oura", () => {
    const acts: DedupeActivity[] = [
      base({ provider: "oura", externalId: "o1", distanceM: null }),
      base({ provider: "strava", externalId: "s1", startTime: "2026-07-01T10:00:20Z" }),
    ];
    const res = dedupeActivities(acts);
    // Both in one group
    expect(new Set(res.map((r) => r.group)).size).toBe(1);
    const primary = res.find((r) => r.isPrimary)!;
    expect(primary.activity.provider).toBe("strava");
    expect(res.filter((r) => r.isPrimary)).toHaveLength(1);
  });
  it("keeps genuinely different sessions separate", () => {
    const acts: DedupeActivity[] = [
      base({ provider: "strava", externalId: "s1", startTime: "2026-07-01T06:00:00Z" }),
      base({ provider: "apple_health", externalId: "h1", startTime: "2026-07-01T18:00:00Z" }),
    ];
    const res = dedupeActivities(acts);
    expect(new Set(res.map((r) => r.group)).size).toBe(2);
    expect(res.every((r) => r.isPrimary)).toBe(true);
  });
  it("demotes a manual entry below a device-recorded one", () => {
    const acts: DedupeActivity[] = [
      base({ provider: "apple_health", externalId: "manual", manualEntry: true }),
      base({ provider: "oura", externalId: "o1", startTime: "2026-07-01T10:00:15Z", distanceM: null }),
    ];
    const res = dedupeActivities(acts);
    const primary = res.find((r) => r.isPrimary)!;
    expect(primary.activity.provider).toBe("oura"); // oura(2) beats apple_health manual(3-3.5=-0.5)
  });
  it("is deterministic / stable across input order", () => {
    const a = base({ provider: "oura", externalId: "o1", distanceM: null });
    const b = base({ provider: "strava", externalId: "s1", startTime: "2026-07-01T10:00:20Z" });
    const r1 = dedupeActivities([a, b]);
    const r2 = dedupeActivities([b, a]);
    const g1 = r1.map((r) => r.group).sort();
    const g2 = r2.map((r) => r.group).sort();
    expect(g1).toEqual(g2);
  });
});

describe("activityToCanonicalRow", () => {
  it("stamps the canonical activity_type slug alongside raw type", () => {
    const a: NormalizedActivity = {
      externalId: "5", type: "VirtualRide", startTime: "2026-07-01T10:00:00Z",
      durationS: 3600, distanceM: 30000, avgHr: 140, maxHr: 165, raw: {},
    };
    const row = activityToCanonicalRow("u1", "strava", a);
    expect(row).toMatchObject({ provider: "strava", type: "VirtualRide", activity_type: "ride", external_id: "5" });
  });
});
