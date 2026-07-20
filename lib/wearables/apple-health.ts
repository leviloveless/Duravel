import type { NormalizedActivity } from "./types";
import { normalizeActivityType, type ActivitySlug } from "./pipeline";

/**
 * Apple Health (HealthKit) backend adapter — PURE, unit-testable.
 *
 * HealthKit has no cloud API: the native iOS plugin
 * (`Apple/Part5_healthkit/ios/DuravelHealthPlugin.swift`) reads on-device and
 * POSTs `IngestionWorkout[]` to `/api/ingest/healthkit`. This module is the thin
 * backend adapter that maps that DTO into the shared `NormalizedActivity` shape
 * so Apple Health flows through the SAME dedupe/canonicalization pipeline as
 * Strava and Oura (Ingestion_Mapping §1–§5). No native code runs here — this is
 * the piece that's buildable and testable without Xcode / an Apple Developer
 * account.
 */

/** The DTO the native client posts (mirrors `healthkit.service.ts`). */
export interface IngestionWorkout {
  source: "healthkit";
  externalId: string; // HK uuid
  activityType: string; // normalized slug from the Swift layer
  startTime: string; // ISO8601 UTC
  endTime: string; // ISO8601 UTC
  durationSeconds: number;
  distanceMeters: number | null;
  activeEnergyKcal: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  originAppName: string;
  originBundleId: string | null;
  deviceName: string | null;
  wasManualEntry: boolean;
}

/**
 * Origin bundle ids we must NOT re-ingest from HealthKit — they're already
 * covered by a first-party integration (Strava OAuth) or are our own writes, so
 * ingesting the HK mirror would double-count. The client pre-filters these too;
 * the backend re-checks (belt-and-suspenders — never rely on the client alone).
 */
export const HEALTHKIT_SKIP_BUNDLE_IDS = new Set<string>([
  "com.strava.stravaride", // Strava iOS — already ingested via Strava OAuth
  "app.duravel", // our own writes, if HK write is ever enabled
]);

/** Should this HealthKit workout be ingested (vs skipped as a known duplicate)? */
export function shouldIngestHealthKit(w: Pick<IngestionWorkout, "originBundleId">): boolean {
  return !(w.originBundleId != null && HEALTHKIT_SKIP_BUNDLE_IDS.has(w.originBundleId));
}

/** Canonical slug for a HealthKit workout (the Swift layer already sends a slug,
 *  but we re-normalize defensively so backend is the source of truth). */
export function healthKitSlug(w: IngestionWorkout): ActivitySlug {
  return normalizeActivityType(w.activityType);
}

/** Map a posted HealthKit workout to the shared `NormalizedActivity`. */
export function normalizeHealthKitWorkout(w: IngestionWorkout): NormalizedActivity {
  return {
    externalId: w.externalId,
    // Store the canonical slug as `type`; `activity_type` is re-derived identically.
    type: healthKitSlug(w),
    startTime: w.startTime,
    durationS: Number.isFinite(w.durationSeconds) ? Math.round(w.durationSeconds) : null,
    distanceM: typeof w.distanceMeters === "number" ? w.distanceMeters : null,
    avgHr: typeof w.avgHeartRate === "number" ? w.avgHeartRate : null,
    maxHr: typeof w.maxHeartRate === "number" ? w.maxHeartRate : null,
    // Keep the full DTO as raw so provenance + wasManualEntry survive for dedupe.
    raw: w,
    manualEntry: !!w.wasManualEntry,
  };
}

/**
 * Filter + normalize a posted batch: drop known-duplicate origins, then map the
 * rest to `NormalizedActivity[]` ready for `ingestActivities(userId,
 * "apple_health", …)`.
 */
export function normalizeHealthKitBatch(workouts: IngestionWorkout[]): NormalizedActivity[] {
  return workouts
    .filter(shouldIngestHealthKit)
    .filter((w) => typeof w.externalId === "string" && w.externalId.length > 0)
    .map(normalizeHealthKitWorkout);
}
