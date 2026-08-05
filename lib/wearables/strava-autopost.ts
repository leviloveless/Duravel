import type { SupabaseClient } from "@supabase/supabase-js";
import { env, envFlag } from "@/lib/env";
import type { Session } from "@/lib/schemas";
import { getConnection, upsertConnection } from "./connections";
import { refreshAccessToken, createManualActivity } from "./strava-api";
import { isTokenExpired, expiresAtIso, hasWriteScope } from "./strava";
import { sessionSummary } from "@/lib/program/session-summary";

/**
 * Auto-post a just-logged session to Strava as a NEW manual activity (opt-out;
 * default ON). Best-effort: silently no-ops when the feature flag is off, Strava
 * isn't connected, the write scope is missing, or the athlete opted out — and it
 * NEVER throws to the caller, so a Strava hiccup can't fail a workout log.
 */

/** Session kind → Strava sport_type. */
const KIND_TO_SPORT: Record<string, string> = {
  run: "Run",
  bike: "Ride",
  swim: "Swim",
  brick: "Workout",
  lift: "WeightTraining",
  strength: "WeightTraining",
  hybrid: "Crossfit",
  cardio: "Workout",
  race: "Workout",
};

export interface AutoPostContext {
  session: Session;
  status: "completed" | "partial";
  rpe?: number | null;
  actualDurationMin?: number;
  actualDistanceMiles?: number;
  programName?: string | null;
  weekNumber: number;
  sportLabel?: string;
  /** Calendar day key ("mon"…"sun") — the middle field of the Strava title. */
  dayKey?: string | null;
}

function plannedDurationMin(s: Session): number | undefined {
  return "durationMin" in s && typeof s.durationMin === "number" ? s.durationMin : undefined;
}
function plannedDistanceMiles(s: Session): number | undefined {
  return s.kind === "run" ? s.distanceMiles : undefined;
}

export async function autoPostSessionToStrava(
  supabase: SupabaseClient,
  userId: string,
  ctx: AutoPostContext,
): Promise<{ posted: boolean }> {
  try {
    if (!envFlag(env.STRAVA_WRITE_ENABLED)) return { posted: false };

    // Cheapest checks first: skip the profile read entirely when not connected.
    const conn = await getConnection(userId, "strava");
    if (!conn || !hasWriteScope(conn.scope)) return { posted: false };

    // Opt-out preference (default ON when the row/column is absent).
    const { data: prof } = await supabase
      .from("profiles")
      .select("strava_autopost")
      .eq("id", userId)
      .maybeSingle();
    if (prof && prof.strava_autopost === false) return { posted: false };

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

    const s = ctx.session;
    const durMin = ctx.actualDurationMin ?? plannedDurationMin(s) ?? 45;
    const distMiles = ctx.actualDistanceMiles ?? plannedDistanceMiles(s);
    // Title + description come from the SAME place the "To Strava" button uses
    // (Levi, 2026-08-05 — "the autoupload ... should look like this"). This path
    // used to build its own: `Duravel Run — Week 1` over a four-line program
    // blurb, which is what actually appeared on Strava while the manual button
    // wrote the real workout. One source, one format, both paths.
    const summary = sessionSummary(s, {
      programName: ctx.programName,
      weekNumber: ctx.weekNumber,
      dayKey: ctx.dayKey,
    });
    const name = summary.stravaTitle;
    const description = summary.stravaDescription;

    await createManualActivity(accessToken, {
      name,
      sportType: KIND_TO_SPORT[s.kind] ?? "Workout",
      startLocalIso: new Date().toISOString(),
      elapsedSeconds: Math.round(durMin * 60),
      description,
      distanceMeters: distMiles ? distMiles * 1609.34 : undefined,
    });
    return { posted: true };
  } catch {
    // Never surface a Strava failure to the logging flow.
    return { posted: false };
  }
}
