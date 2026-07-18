// Duravel iOS — Part 5 (HealthKit & wearables)
// definitions.ts
//
// TypeScript interface for the native DuravelHealth plugin + the registerPlugin
// binding. Import the plugin from here; but prefer the higher-level
// `healthkit.service.ts` as the single app-facing surface.
//
// Place in the web app under: src/native/health/definitions.ts

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** JS-friendly identifiers accepted by queryQuantity(). */
export type DuravelQuantityIdentifier =
  | 'heartRate'
  | 'restingHeartRate'
  | 'hrvSDNN'
  | 'vo2Max'
  | 'activeEnergy'
  | 'distanceWalkingRunning'
  | 'distanceCycling';

/** A single HealthKit workout, enriched with per-workout metric summaries. */
export interface DuravelHKWorkout {
  /** HealthKit sample UUID — stable, used as the external dedupe key. */
  uuid: string;
  /** Normalized Duravel activity slug (e.g. "run", "strength", "hiit"). */
  activityType: string;
  /** Raw HKWorkoutActivityType rawValue (for debugging / future mapping). */
  activityTypeRaw: number;
  startDate: string; // ISO8601 with fractional seconds
  endDate: string;
  startMillis: number;
  endMillis: number;
  durationSeconds: number;
  /** Source app that wrote the workout (e.g. "Apple Watch", "Strava"). */
  sourceName: string;
  /** Bundle id of the writing source — used to skip re-ingesting our own writes / Strava-origin workouts. */
  sourceBundleId: string | null;
  deviceName: string | null;
  wasUserEntered: boolean;
  activeEnergyKcal: number | null;
  distanceMeters: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
}

/** A single quantity sample (resting HR, HRV, VO2max, etc.). */
export interface DuravelHKQuantitySample {
  uuid: string;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  startMillis: number;
  sourceName: string;
}

export interface AvailabilityResult { available: boolean; }
export interface AuthorizationResult { granted: boolean; }
export interface WorkoutsResult { workouts: DuravelHKWorkout[]; }
export interface QuantityResult { samples: DuravelHKQuantitySample[]; }
export interface BackgroundSyncResult { backgroundDeliveryEnabled: boolean; }
export interface StopResult { stopped: boolean; }
export interface ResetResult { reset: boolean; }

/** Event payload emitted when background delivery finds new workouts. */
export interface WorkoutsUpdatedEvent { workouts: DuravelHKWorkout[]; }

export interface DuravelHealthPlugin {
  /** True only on iPhone with Health data available (false on Simulator/iPad-only). */
  isAvailable(): Promise<AvailabilityResult>;

  /** Present the HealthKit read authorization sheet. Read grants are NOT introspectable by iOS. */
  requestAuthorization(): Promise<AuthorizationResult>;

  /**
   * Pull workouts via the persisted anchor (incremental). Pass `sinceMillis`
   * as a safety-net floor if you want to force a time-bounded re-read.
   */
  queryWorkouts(options?: { sinceMillis?: number }): Promise<WorkoutsResult>;

  /** Read quantity samples of one type over a window (default: last 30 days). */
  queryQuantity(options: {
    identifier: DuravelQuantityIdentifier;
    sinceMillis?: number;
    limit?: number;
  }): Promise<QuantityResult>;

  /** Register observer + background delivery for new workouts. Call once after auth. */
  startBackgroundSync(): Promise<BackgroundSyncResult>;

  /** Tear down observers + disable background delivery (e.g. on logout). */
  stopBackgroundSync(): Promise<StopResult>;

  /** Clear the persisted anchor so the next sync re-reads all workouts. */
  resetSyncAnchor(): Promise<ResetResult>;

  /** Fired from a background-delivery wake when new workouts are found. */
  addListener(
    eventName: 'workoutsUpdated',
    listenerFunc: (event: WorkoutsUpdatedEvent) => void,
  ): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}

// The web-target implementation is a no-op stub so the app still builds/runs
// in the browser (Duravel is a web app first). See healthkit.service.ts, which
// also guards on Capacitor.getPlatform() === 'ios'.
export const DuravelHealth = registerPlugin<DuravelHealthPlugin>('DuravelHealth', {
  web: () => import('./web').then((m) => new m.DuravelHealthWeb()),
});
