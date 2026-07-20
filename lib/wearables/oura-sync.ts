import { createAdminClient } from "@/lib/supabase/admin";
import { getConnection, upsertConnection, setLastSync } from "./connections";
import { refreshAccessToken, fetchWorkouts, fetchSleep, fetchDailySleep } from "./oura-api";
import { isTokenExpired, expiresAtFromNow, ouraDateWindow, buildOuraDailies } from "./oura";
import { activityToRow } from "./ingest";

/**
 * Sync recent Oura data into `wearable_activities` (workouts) and `wearable_daily`
 * (recovery: HRV, resting-HR proxy, sleep score) via the service role. Refreshes
 * the access token first if it's expired — persisting Oura's ROTATED refresh
 * token — then upserts idempotently by the tables' unique keys.
 */
export async function syncOura(userId: string): Promise<{ imported: number }> {
  const conn = await getConnection(userId, "oura");
  if (!conn) throw new Error("Oura is not connected.");

  let accessToken = conn.access_token;
  if (isTokenExpired(conn.expires_at) && conn.refresh_token) {
    const t = await refreshAccessToken(conn.refresh_token);
    accessToken = t.access_token;
    await upsertConnection({
      userId,
      provider: "oura",
      accessToken: t.access_token,
      // Oura refresh tokens are single-use → store the NEW one.
      refreshToken: t.refresh_token,
      expiresAt: expiresAtFromNow(t.expires_in),
      scope: conn.scope,
      providerAthleteId: conn.provider_athlete_id,
    });
  }

  const { startDate, endDate } = ouraDateWindow(conn.last_sync_at);
  const [activities, sleep, dailySleep] = await Promise.all([
    fetchWorkouts(accessToken, startDate, endDate),
    fetchSleep(accessToken, startDate, endDate),
    fetchDailySleep(accessToken, startDate, endDate),
  ]);

  const admin = createAdminClient();

  if (activities.length > 0) {
    const rows = activities
      .filter((a) => a.externalId.length > 0)
      .map((a) => activityToRow(userId, "oura", a));
    if (rows.length > 0) {
      const { error } = await admin
        .from("wearable_activities")
        .upsert(rows, { onConflict: "user_id,provider,external_id" });
      if (error) throw new Error(`Failed to store activities: ${error.message}`);
    }
  }

  const dailies = buildOuraDailies(sleep, dailySleep);
  if (dailies.length > 0) {
    const rows = dailies.map((d) => ({
      user_id: userId,
      provider: "oura" as const,
      date: d.date,
      resting_hr: d.restingHr,
      hrv: d.hrv,
      sleep_score: d.sleepScore,
      raw: d.raw,
    }));
    const { error } = await admin
      .from("wearable_daily")
      .upsert(rows, { onConflict: "user_id,provider,date" });
    if (error) throw new Error(`Failed to store daily metrics: ${error.message}`);
  }

  await setLastSync(userId, "oura", new Date().toISOString());
  return { imported: activities.length };
}
