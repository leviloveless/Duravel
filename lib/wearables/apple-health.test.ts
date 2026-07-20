import { describe, it, expect } from "vitest";
import {
  shouldIngestHealthKit,
  healthKitSlug,
  normalizeHealthKitWorkout,
  normalizeHealthKitBatch,
  type IngestionWorkout,
} from "./apple-health";

const wk = (o: Partial<IngestionWorkout>): IngestionWorkout => ({
  source: "healthkit",
  externalId: o.externalId ?? "uuid-1",
  activityType: o.activityType ?? "run",
  startTime: o.startTime ?? "2026-07-01T10:00:00.000Z",
  endTime: o.endTime ?? "2026-07-01T10:30:00.000Z",
  durationSeconds: o.durationSeconds ?? 1800,
  distanceMeters: o.distanceMeters === undefined ? 5000 : o.distanceMeters,
  activeEnergyKcal: o.activeEnergyKcal ?? 320,
  avgHeartRate: o.avgHeartRate ?? 150,
  maxHeartRate: o.maxHeartRate ?? 172,
  originAppName: o.originAppName ?? "Apple Watch",
  originBundleId: o.originBundleId ?? "com.apple.health",
  deviceName: o.deviceName ?? "Apple Watch",
  wasManualEntry: o.wasManualEntry ?? false,
});

describe("shouldIngestHealthKit", () => {
  it("skips Strava-origin and own-app writes (belt-and-suspenders vs client filter)", () => {
    expect(shouldIngestHealthKit({ originBundleId: "com.strava.stravaride" })).toBe(false);
    expect(shouldIngestHealthKit({ originBundleId: "app.duravel" })).toBe(false);
    expect(shouldIngestHealthKit({ originBundleId: "com.apple.health" })).toBe(true);
    expect(shouldIngestHealthKit({ originBundleId: null })).toBe(true);
  });
});

describe("normalizeHealthKitWorkout", () => {
  it("maps the DTO into a NormalizedActivity and re-normalizes the slug", () => {
    const a = normalizeHealthKitWorkout(wk({ activityType: "functionalStrengthTraining", distanceMeters: null }));
    expect(a.externalId).toBe("uuid-1");
    expect(a.type).toBe("strength");
    expect(a.distanceM).toBeNull();
    expect(a.durationS).toBe(1800);
    expect(a.manualEntry).toBe(false);
  });
  it("preserves the DTO in raw and carries manualEntry", () => {
    const a = normalizeHealthKitWorkout(wk({ wasManualEntry: true }));
    expect(a.manualEntry).toBe(true);
    expect((a.raw as IngestionWorkout).wasManualEntry).toBe(true);
  });
  it("keeps the canonical slug for a healthkit slug input", () => {
    expect(healthKitSlug(wk({ activityType: "run" }))).toBe("run");
  });
});

describe("normalizeHealthKitBatch", () => {
  it("drops skipped origins + blank ids, normalizes the rest", () => {
    const batch = normalizeHealthKitBatch([
      wk({ externalId: "keep", originBundleId: "com.apple.health" }),
      wk({ externalId: "strava", originBundleId: "com.strava.stravaride" }),
      wk({ externalId: "", originBundleId: "com.apple.health" }),
    ]);
    expect(batch.map((b) => b.externalId)).toEqual(["keep"]);
  });
});
