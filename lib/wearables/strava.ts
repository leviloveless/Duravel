import type { NormalizedActivity } from "./types";

/**
 * Strava — PURE helpers (no env, no I/O), so they're unit-testable in isolation.
 * The network calls live in `strava-api.ts`.
 */

export const STRAVA_OAUTH_BASE = "https://www.strava.com/oauth";
export const STRAVA_API_BASE = "https://www.strava.com/api/v3";
/**
 * Scopes we request: read profile + all activities (incl. private) + WRITE.
 * `activity:write` powers the opt-in branded activity-description write (see
 * `branding.ts`). Adding a scope requires the user to RE-AUTHORIZE — existing
 * connections keep their old (read-only) grant until they reconnect, and the
 * brand route degrades gracefully (403) if write isn't granted.
 */
export const STRAVA_SCOPE = "read,activity:read_all,activity:write";

/** Build the Strava authorize URL the user is redirected to. */
export function stravaAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    approval_prompt: "auto",
    scope: STRAVA_SCOPE,
    state,
  });
  return `${STRAVA_OAUTH_BASE}/authorize?${p.toString()}`;
}

/** True if the granted scope string includes activity write permission. */
export function hasWriteScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .includes("activity:write");
}

/** True if the token is absent or expires within the next 60 seconds. */
export function isTokenExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return true;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) return true;
  return ms - 60_000 <= now;
}

export type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch SECONDS
  athlete?: { id?: number | string };
};

/** Epoch-seconds → ISO string (Strava returns expiry as epoch seconds). */
export function expiresAtIso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/** Normalize a raw Strava activity into our provider-agnostic staging shape. */
export function normalizeStravaActivity(a: Record<string, unknown>): NormalizedActivity {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    externalId: a.id != null ? String(a.id) : "",
    type: str(a.sport_type) ?? str(a.type),
    startTime: str(a.start_date),
    durationS: num(a.moving_time) ?? num(a.elapsed_time),
    distanceM: num(a.distance),
    avgHr: num(a.average_heartrate),
    maxHr: num(a.max_heartrate),
    raw: a,
  };
}
