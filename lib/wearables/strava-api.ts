import { env } from "@/lib/env";
import type { NormalizedActivity } from "./types";
import {
  STRAVA_OAUTH_BASE,
  STRAVA_API_BASE,
  normalizeStravaActivity,
  type StravaTokenResponse,
} from "./strava";

/**
 * Strava — network I/O (token exchange/refresh, activity fetch). Kept separate
 * from the pure helpers in `strava.ts` so those stay unit-testable without env.
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
