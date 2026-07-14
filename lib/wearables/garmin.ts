import type { NormalizedDaily } from "./types";

/**
 * Garmin — PURE helpers (no env, no I/O), unit-testable.
 *
 * SCAFFOLD: Garmin's Health API requires an approved Developer Program account,
 * and the exact OAuth flow + daily-summary field names must be confirmed against
 * Garmin's docs once approved. The authorize-URL builder and the normalizer below
 * are written to the documented OAuth2 shape but should be re-checked at wiring
 * time. Network calls live in `garmin-api.ts` (also scaffold).
 */

// TODO(garmin): confirm these against the approved Developer Program docs.
export const GARMIN_OAUTH_BASE = "https://connect.garmin.com/oauth2Confirm";
export const GARMIN_API_BASE = "https://apis.garmin.com";
export const GARMIN_SCOPE = "read";

export function garminAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GARMIN_SCOPE,
    state,
  });
  return `${GARMIN_OAUTH_BASE}?${p.toString()}`;
}

/**
 * Normalize a Garmin daily summary into our provider-agnostic daily shape.
 * Tolerant of field-name variants across Garmin's summary/HRV/sleep endpoints.
 */
export function normalizeGarminDaily(raw: Record<string, unknown>): NormalizedDaily {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    date: str(raw.calendarDate) ?? str(raw.date) ?? "",
    restingHr: num(raw.restingHeartRateInBeatsPerMinute) ?? num(raw.restingHeartRate),
    hrv: num(raw.avgOvernightHrv) ?? num(raw.lastNightAvg) ?? num(raw.hrv),
    sleepScore: num(raw.overallSleepScore) ?? num(raw.sleepScore),
    raw,
  };
}
