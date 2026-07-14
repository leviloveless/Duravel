import { env } from "@/lib/env";
import type { NormalizedDaily } from "./types";

/**
 * Garmin — network I/O. SCAFFOLD, pending Garmin Health API approval.
 *
 * The endpoints/params are placeholders written to the documented OAuth2 +
 * Health-API shape; confirm them against the approved Developer Program docs
 * before enabling. Every function throws clearly until GARMIN_CLIENT_ID/SECRET are
 * configured, so nothing here runs by accident. When wiring `fetchDailies`, map
 * each raw row through `normalizeGarminDaily` from "./garmin".
 */

function credentials(): { clientId: string; clientSecret: string } {
  if (!env.GARMIN_CLIENT_ID || !env.GARMIN_CLIENT_SECRET) {
    throw new Error("Garmin is not configured / not yet approved.");
  }
  return { clientId: env.GARMIN_CLIENT_ID, clientSecret: env.GARMIN_CLIENT_SECRET };
}

export type GarminTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
};

// TODO(garmin): confirm token + daily endpoints post-approval.
export async function exchangeCodeForToken(_code: string, _redirectUri: string): Promise<GarminTokenResponse> {
  credentials();
  throw new Error("Garmin token exchange not wired — pending Developer Program approval.");
}

export async function refreshAccessToken(_refreshToken: string): Promise<GarminTokenResponse> {
  credentials();
  throw new Error("Garmin token refresh not wired — pending Developer Program approval.");
}

/**
 * Fetch daily summaries (resting HR, HRV, sleep) → normalized dailies.
 * When wired: GET the daily-summary / HRV / sleep endpoints, then
 *   `return rows.map((r) => normalizeGarminDaily(r as Record<string, unknown>));`
 */
export async function fetchDailies(_accessToken: string, _fromIso: string, _toIso: string): Promise<NormalizedDaily[]> {
  credentials();
  throw new Error("Garmin daily fetch not wired — pending Developer Program approval.");
}
