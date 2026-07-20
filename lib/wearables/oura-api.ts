import { env } from "@/lib/env";
import type { NormalizedActivity } from "./types";
import {
  OURA_TOKEN_URL,
  OURA_API_BASE,
  normalizeOuraWorkout,
  type OuraTokenResponse,
  type OuraSleepRecord,
  type OuraDailySleepRecord,
} from "./oura";

/**
 * Oura — network I/O (token exchange/refresh, workout + sleep fetch). Kept
 * separate from the pure helpers in `oura.ts` so those stay unit-testable
 * without env. Confidential-client OAuth (server-side secret), which fits our
 * Next.js/Supabase backend.
 */

function credentials(): { clientId: string; clientSecret: string } {
  if (!env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET) {
    throw new Error("Oura is not configured (set OURA_CLIENT_ID and OURA_CLIENT_SECRET).");
  }
  return { clientId: env.OURA_CLIENT_ID, clientSecret: env.OURA_CLIENT_SECRET };
}

/** Exchange an authorization code for tokens (OAuth callback). */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<OuraTokenResponse> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Oura token exchange failed (${res.status})`);
  return (await res.json()) as OuraTokenResponse;
}

/**
 * Refresh an expired access token. Oura rotates refresh tokens (single-use), so
 * the caller MUST persist the returned refresh_token, not the old one.
 */
export async function refreshAccessToken(refreshToken: string): Promise<OuraTokenResponse> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Oura token refresh failed (${res.status})`);
  return (await res.json()) as OuraTokenResponse;
}

/** GET a v2 usercollection endpoint over a date window, returning the `data` array. */
async function fetchCollection(
  accessToken: string,
  path: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, unknown>[]> {
  const p = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const res = await fetch(`${OURA_API_BASE}/${path}?${p.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Oura ${path} fetch failed (${res.status})`);
  const body = (await res.json()) as { data?: unknown };
  return Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
}

/** Recent workouts → normalized activities. */
export async function fetchWorkouts(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<NormalizedActivity[]> {
  const data = await fetchCollection(accessToken, "workout", startDate, endDate);
  return data.map((w) => normalizeOuraWorkout(w));
}

/** Detailed sleep records (carry raw HRV + lowest-HR). */
export async function fetchSleep(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<OuraSleepRecord[]> {
  return fetchCollection(accessToken, "sleep", startDate, endDate);
}

/** daily_sleep records (carry the sleep score). */
export async function fetchDailySleep(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<OuraDailySleepRecord[]> {
  return fetchCollection(accessToken, "daily_sleep", startDate, endDate);
}
