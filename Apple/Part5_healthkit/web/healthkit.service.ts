// Duravel iOS — Part 5 (HealthKit & wearables)
// healthkit.service.ts
//
// SINGLE IMPORT SURFACE for the web app. Everything the app needs to talk to
// HealthKit goes through `duravelHealth`. It:
//   * guards on platform (safe no-ops off iOS),
//   * normalizes native payloads into the ingestion DTO (see Ingestion_Mapping.md),
//   * POSTs new workouts to the existing shared ingestion endpoint,
//   * wires the background "workoutsUpdated" event to auto-ingest.
//
// It calls the native plugin via the Part 2 native bridge convention. If Part 2
// exposes a bridge helper, swap the direct `DuravelHealth` import for that; the
// public API of this service does not change.
//
// Place in the web app under: src/native/health/healthkit.service.ts
//
// Usage:
//   import { duravelHealth } from '@/native/health/healthkit.service';
//   if ((await duravelHealth.isAvailable())) { ...show priming... }
//   await duravelHealth.requestAuthorization();
//   await duravelHealth.enableAutoSync();   // registers background delivery + listener
//   await duravelHealth.syncNow();          // pull + ingest anything new

import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  DuravelHealth,
  type DuravelHKWorkout,
  type DuravelQuantityIdentifier,
  type DuravelHKQuantitySample,
} from './definitions';

/** Source bundle ids whose workouts we must NOT re-ingest (already covered by
 *  a first-party integration, so HealthKit would double-count). Extend as we
 *  add integrations. Duravel's own future writes are also skipped here. */
const SKIP_SOURCE_BUNDLE_IDS = new Set<string>([
  'com.strava.stravaride', // Strava iOS — already ingested via Strava OAuth
  'app.duravel',           // our own writes, if we ever enable HK write
]);

/** Ingestion DTO — the shape Duravel's shared ingestion endpoint accepts.
 *  Mirrors what the Strava/Garmin importers post. See Ingestion_Mapping.md. */
export interface IngestionWorkout {
  source: 'healthkit';
  externalId: string;            // HK uuid — stable idempotency key for this source
  activityType: string;          // normalized slug
  startTime: string;             // ISO8601 UTC
  endTime: string;               // ISO8601 UTC
  durationSeconds: number;
  distanceMeters: number | null;
  activeEnergyKcal: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  // Provenance so the backend dedupe layer can reason across sources.
  originAppName: string;         // e.g. "Apple Watch", "Strava"
  originBundleId: string | null;
  deviceName: string | null;
  wasManualEntry: boolean;
}

export interface RecoveryContext {
  restingHeartRate: DuravelHKQuantitySample[];
  hrvSDNN: DuravelHKQuantitySample[];
  vo2Max: DuravelHKQuantitySample[];
}

/** Options for wiring ingestion. `ingest` receives fully-normalized workouts;
 *  default implementation POSTs to /api/ingest/healthkit. Override in tests. */
export interface HealthServiceConfig {
  ingest?: (workouts: IngestionWorkout[]) => Promise<void>;
  onError?: (context: string, err: unknown) => void;
}

class DuravelHealthService {
  private listener: PluginListenerHandle | null = null;
  private config: HealthServiceConfig = {};

  configure(config: HealthServiceConfig): void {
    this.config = { ...this.config, ...config };
  }

  private get isIOS(): boolean {
    return Capacitor.getPlatform() === 'ios';
  }

  /** True only when running on iOS with Health data available. */
  async isAvailable(): Promise<boolean> {
    if (!this.isIOS) return false;
    try {
      const { available } = await DuravelHealth.isAvailable();
      return available;
    } catch (err) {
      this.config.onError?.('isAvailable', err);
      return false;
    }
  }

  /** Present the HealthKit authorization sheet. Call AFTER the priming screen. */
  async requestAuthorization(): Promise<boolean> {
    if (!this.isIOS) return false;
    try {
      const { granted } = await DuravelHealth.requestAuthorization();
      return granted;
    } catch (err) {
      this.config.onError?.('requestAuthorization', err);
      return false;
    }
  }

  /**
   * Register background delivery + attach the listener that auto-ingests new
   * workouts when the watch records one. Call once after authorization; safe to
   * call again on app resume (listener is de-duplicated).
   */
  async enableAutoSync(): Promise<void> {
    if (!this.isIOS) return;
    try {
      await DuravelHealth.startBackgroundSync();
      if (!this.listener) {
        this.listener = await DuravelHealth.addListener('workoutsUpdated', (event) => {
          void this.ingestWorkouts(event.workouts);
        });
      }
    } catch (err) {
      this.config.onError?.('enableAutoSync', err);
    }
  }

  /** Disable background delivery + detach listeners (call on logout). */
  async disableAutoSync(): Promise<void> {
    if (!this.isIOS) return;
    try {
      await DuravelHealth.stopBackgroundSync();
      await DuravelHealth.removeAllListeners();
      this.listener = null;
    } catch (err) {
      this.config.onError?.('disableAutoSync', err);
    }
  }

  /**
   * Foreground pull: fetch any workouts newer than the persisted anchor and
   * ingest them. Call on app cold start / when the user opens the training tab
   * so nothing is missed if a background wake didn't fire.
   */
  async syncNow(options?: { sinceMillis?: number }): Promise<number> {
    if (!this.isIOS) return 0;
    try {
      const { workouts } = await DuravelHealth.queryWorkouts(options ?? {});
      return await this.ingestWorkouts(workouts);
    } catch (err) {
      this.config.onError?.('syncNow', err);
      return 0;
    }
  }

  /** Read daily recovery context (resting HR, HRV, VO2max) for the dashboard. */
  async getRecoveryContext(sinceMillis?: number): Promise<RecoveryContext> {
    const empty: RecoveryContext = { restingHeartRate: [], hrvSDNN: [], vo2Max: [] };
    if (!this.isIOS) return empty;
    try {
      const [restingHeartRate, hrvSDNN, vo2Max] = await Promise.all([
        this.readQuantity('restingHeartRate', sinceMillis),
        this.readQuantity('hrvSDNN', sinceMillis),
        this.readQuantity('vo2Max', sinceMillis),
      ]);
      return { restingHeartRate, hrvSDNN, vo2Max };
    } catch (err) {
      this.config.onError?.('getRecoveryContext', err);
      return empty;
    }
  }

  private async readQuantity(
    identifier: DuravelQuantityIdentifier,
    sinceMillis?: number,
  ): Promise<DuravelHKQuantitySample[]> {
    const { samples } = await DuravelHealth.queryQuantity({ identifier, sinceMillis });
    return samples;
  }

  /** Force a full re-sync next time (debug / "re-sync from scratch" button). */
  async resetSync(): Promise<void> {
    if (!this.isIOS) return;
    await DuravelHealth.resetSyncAnchor();
  }

  // --- internal: normalize + hand off to ingestion ------------------------

  private async ingestWorkouts(raw: DuravelHKWorkout[]): Promise<number> {
    // Client-side pre-filter: drop workouts written by sources we already
    // ingest elsewhere (Strava) or our own writes. The BACKEND still runs the
    // authoritative time+duration+distance dedupe (see Ingestion_Mapping.md);
    // this just avoids obvious double-posts.
    const filtered = raw.filter(
      (w) => !(w.sourceBundleId && SKIP_SOURCE_BUNDLE_IDS.has(w.sourceBundleId)),
    );
    if (filtered.length === 0) return 0;

    const dtos = filtered.map(toIngestionWorkout);
    const ingest = this.config.ingest ?? defaultIngest;
    await ingest(dtos);
    return dtos.length;
  }
}

/** Map a native HealthKit workout to the shared ingestion DTO. */
export function toIngestionWorkout(w: DuravelHKWorkout): IngestionWorkout {
  return {
    source: 'healthkit',
    externalId: w.uuid,
    activityType: w.activityType,
    startTime: w.startDate,
    endTime: w.endDate,
    durationSeconds: w.durationSeconds,
    distanceMeters: w.distanceMeters,
    activeEnergyKcal: w.activeEnergyKcal,
    avgHeartRate: w.avgHeartRate,
    maxHeartRate: w.maxHeartRate,
    originAppName: w.sourceName,
    originBundleId: w.sourceBundleId,
    deviceName: w.deviceName,
    wasManualEntry: w.wasUserEntered,
  };
}

/** Default ingestion transport: POST to the existing shared endpoint. Uses the
 *  app's normal fetch (cookies/session assumed). Adjust path to match backend. */
async function defaultIngest(workouts: IngestionWorkout[]): Promise<void> {
  const res = await fetch('/api/ingest/healthkit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ workouts }),
  });
  if (!res.ok) {
    throw new Error(`HealthKit ingestion failed: ${res.status} ${res.statusText}`);
  }
}

/** The one exported instance the app imports. */
export const duravelHealth = new DuravelHealthService();
