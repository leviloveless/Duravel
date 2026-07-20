import { getConnection, upsertConnection } from "./connections";
import { refreshAccessToken, fetchActivityDetail, updateActivityDescription } from "./strava-api";
import { isTokenExpired, expiresAtIso, hasWriteScope } from "./strava";
import { buildBrandedDescription, type BrandContext } from "./branding";

/**
 * Opt-in: write a branded Duravel tag onto a Strava activity's description
 * (growth loop). Refreshes the token if needed, reads the current description so
 * the athlete's own text is preserved, appends an idempotent tag, and PUTs it
 * back. Throws "strava_not_connected" / "strava_write_scope" / "strava_write_forbidden"
 * so the caller can prompt a reconnect when the write grant is missing.
 */
export async function brandStravaActivity(
  userId: string,
  activityId: string,
  ctx: BrandContext,
): Promise<{ branded: true }> {
  const conn = await getConnection(userId, "strava");
  if (!conn) throw new Error("strava_not_connected");
  if (!hasWriteScope(conn.scope)) throw new Error("strava_write_scope");

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

  const detail = await fetchActivityDetail(accessToken, activityId);
  const description = buildBrandedDescription(detail.description, ctx);
  await updateActivityDescription(accessToken, activityId, description);
  return { branded: true };
}
