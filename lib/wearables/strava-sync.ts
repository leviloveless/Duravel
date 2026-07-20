import { getConnection, upsertConnection, setLastSync } from "./connections";
import { refreshAccessToken, fetchRecentActivities } from "./strava-api";
import { isTokenExpired, expiresAtIso } from "./strava";
import { afterEpochFromLastSync } from "./ingest";
import { ingestActivities } from "./activity-ingest";

/**
 * Sync recent Strava activities into the SHARED ingestion pipeline. Refreshes
 * the access token first if it's expired, then hands the normalized activities
 * to `ingestActivities`, which upserts idempotently by (user, provider,
 * external_id) AND runs cross-source dedupe against Oura / Apple Health rows in
 * the same time window (spec §1.4). Stamps last_sync_at.
 */
export async function syncStrava(userId: string): Promise<{ imported: number }> {
  const conn = await getConnection(userId, "strava");
  if (!conn) throw new Error("Strava is not connected.");

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

  const after = afterEpochFromLastSync(conn.last_sync_at);
  const activities = await fetchRecentActivities(accessToken, after);

  const result = await ingestActivities(userId, "strava", activities);

  await setLastSync(userId, "strava", new Date().toISOString());
  return result;
}
