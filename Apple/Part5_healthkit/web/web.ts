// Duravel iOS — Part 5 (HealthKit & wearables)
// web.ts
//
// No-op web implementation of the DuravelHealth plugin. Duravel is a web app
// first and runs in browsers where HealthKit does not exist; this stub lets the
// same code build and run everywhere. On web, `isAvailable()` returns false and
// all reads return empty, so the service layer degrades gracefully.
//
// Place in the web app under: src/native/health/web.ts

import { WebPlugin } from '@capacitor/core';
import type {
  DuravelHealthPlugin,
  AvailabilityResult,
  AuthorizationResult,
  WorkoutsResult,
  QuantityResult,
  BackgroundSyncResult,
  StopResult,
  ResetResult,
} from './definitions';

export class DuravelHealthWeb extends WebPlugin implements DuravelHealthPlugin {
  async isAvailable(): Promise<AvailabilityResult> {
    return { available: false };
  }
  async requestAuthorization(): Promise<AuthorizationResult> {
    return { granted: false };
  }
  async queryWorkouts(): Promise<WorkoutsResult> {
    return { workouts: [] };
  }
  async queryQuantity(): Promise<QuantityResult> {
    return { samples: [] };
  }
  async startBackgroundSync(): Promise<BackgroundSyncResult> {
    return { backgroundDeliveryEnabled: false };
  }
  async stopBackgroundSync(): Promise<StopResult> {
    return { stopped: true };
  }
  async resetSyncAnchor(): Promise<ResetResult> {
    return { reset: true };
  }
}
