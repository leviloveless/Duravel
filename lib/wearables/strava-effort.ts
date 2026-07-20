import { getConnection, upsertConnection } from "./connections";
import { refreshAccessToken, fetchActivityDetail } from "./strava-api";
import { isTokenExpired, expiresAtIso } from "./strava";
import { stravaEffortFromDetail, type Effort } from "./effort";

/**
 * Fetch the athlete's RPE + "how it felt" for one Strava activity (#12) by
 * pulling the activity DETAIL (where `perceived_exertion` / `private_note` live).
 * Refreshes the token if needed. Never throws — returns empty effort on any
 * failure so linking a workout is never blocked by this best-effort enrichment.
 */
export async function fetchStravaEffort(userId: string, externalId: string): Promise<Effort> {
  const empty: Effort = { rpe: null, feel: null };
  try {
    const conn = await getConnection(userId, "strava");
    if (!conn) return empty;

    let accessToken = conn.access_token;
    if (isTokenExpired(conn.expires_at) && conn.refresh_token) {
      const t = await refreshAccessToken(conn.refresh_token);
      accessToken = t.access_token;
      await upsertConnection({
        userId,
        provider: "strava",
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: expiresAtIso(t.expires_at),
        scope: conn.scope,
        providerAthleteId: conn.provider_athlete_id,
      });
    }

    const detail = await fetchActivityDetail(accessToken, externalId);
    return stravaEffortFromDetail(detail);
  } catch {
    return empty;
  }
}
