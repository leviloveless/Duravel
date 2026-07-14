import { createAdminClient } from "@/lib/supabase/admin";
import { getConnection, upsertConnection, setLastSync } from "./connections";
import { refreshAccessToken, fetchRecentActivities } from "./strava-api";
import { isTokenExpired, expiresAtIso } from "./strava";
import { afterEpochFromLastSync, activityToRow } from "./ingest";

/**
 * Sync recent Strava activities into `wearable_activities` (service role).
 * Refreshes the access token first if it's expired, upserts by (user, provider,
 * external_id) so re-syncs are idempotent, and stamps last_sync_at.
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

  if (activities.length > 0) {
    const admin = createAdminClient();
    const rows = activities
      .filter((a) => a.externalId.length > 0)
      .map((a) => activityToRow(userId, "strava", a));
    const { error } = await admin
      .from("wearable_activities")
      .upsert(rows, { onConflict: "user_id,provider,external_id" });
    if (error) throw new Error(`Failed to store activities: ${error.message}`);
  }

  await setLastSync(userId, "strava", new Date().toISOString());
  return { imported: activities.length };
}
