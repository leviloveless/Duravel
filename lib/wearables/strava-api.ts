import { env } from "@/lib/env";
import type { NormalizedActivity } from "./types";
import {
  STRAVA_OAUTH_BASE,
  STRAVA_API_BASE,
  normalizeStravaActivity,
  type StravaTokenResponse,
} from "./strava";

/**
 * Strava — network I/O (token exchange/refresh, activity fetch, description
 * write). Kept separate from the pure helpers in `strava.ts` so those stay
 * unit-testable without env.
 */

function credentials(): { clientId: string; clientSecret: string } {
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
    throw new Error("Strava is not configured (set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET).");
  }
  return { clientId: env.STRAVA_CLIENT_ID, clientSecret: env.STRAVA_CLIENT_SECRET };
}

/** Exchange an authorization code for tokens (OAuth callback). */
export async function exchangeCodeForToken(code: string): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(`${STRAVA_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed (${res.status})`);
  return (await res.json()) as StravaTokenResponse;
}

/** Refresh an expired access token using the stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<StravaTokenResponse> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(`${STRAVA_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed (${res.status})`);
  return (await res.json()) as StravaTokenResponse;
}

/** Fetch recent activities (optionally only those after an epoch-seconds cutoff). */
export async function fetchRecentActivities(
  accessToken: string,
  afterEpochS?: number,
  perPage = 30,
): Promise<NormalizedActivity[]> {
  const p = new URLSearchParams({ per_page: String(perPage) });
  if (afterEpochS) p.set("after", String(afterEpochS));
  const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${p.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activities fetch failed (${res.status})`);
  const arr = (await res.json()) as unknown;
  return Array.isArray(arr) ? arr.map((a) => normalizeStravaActivity(a as Record<string, unknown>)) : [];
}

/** Fetch a single activity's current name + description (to brand it without
 *  clobbering the athlete's own text). */
export async function fetchActivityDetail(
  accessToken: string,
  activityId: string,
): Promise<{ id: string; name: string | null; description: string | null }> {
  const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activity fetch failed (${res.status})`);
  const a = (await res.json()) as { id?: number | string; name?: string; description?: string };
  return {
    id: a.id != null ? String(a.id) : activityId,
    name: typeof a.name === "string" ? a.name : null,
    description: typeof a.description === "string" ? a.description : null,
  };
}

/**
 * Write a new description onto a Strava activity (`PUT /activities/{id}`).
 * Requires the `activity:write` scope; a 403 means the connection was authorized
 * before we added write (the caller should surface a "reconnect Strava" prompt).
 */
export async function updateActivityDescription(
  accessToken: string,
  activityId: string,
  description: string,
): Promise<void> {
  const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ description }),
  });
  if (res.status === 403) throw new Error("strava_write_forbidden");
  if (!res.ok) throw new Error(`Strava activity update failed (${res.status})`);
}
