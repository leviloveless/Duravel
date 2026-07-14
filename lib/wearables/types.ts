/** Wearable integration shared types (Phase 1). */

export type WearableProvider = "strava" | "garmin";

export const WEARABLE_PROVIDERS: WearableProvider[] = ["strava", "garmin"];

/** Full connection row incl. OAuth tokens — SERVER ONLY (never sent to client). */
export type WearableConnection = {
  user_id: string;
  provider: WearableProvider;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  provider_athlete_id: string | null;
  last_sync_at: string | null;
};

/** Non-secret connection status for UI (no tokens). */
export type WearableConnectionStatus = {
  provider: WearableProvider;
  connected: boolean;
  last_sync_at: string | null;
  created_at: string | null;
};

/** Provider-agnostic normalized activity for the staging table. */
export type NormalizedActivity = {
  externalId: string;
  type: string | null;
  startTime: string | null; // ISO 8601
  durationS: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  raw: unknown;
};

/** Provider-agnostic daily recovery metric (feeds readiness). */
export type NormalizedDaily = {
  date: string; // YYYY-MM-DD
  restingHr: number | null;
  hrv: number | null;
  sleepScore: number | null;
  raw: unknown;
};
