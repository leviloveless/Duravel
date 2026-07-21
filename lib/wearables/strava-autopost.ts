import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Session } from "@/lib/schemas";
import { getConnection, upsertConnection } from "./connections";
import { refreshAccessToken, createManualActivity } from "./strava-api";
import { isTokenExpired, expiresAtIso, hasWriteScope } from "./strava";

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

/** Session kind → human label for the activity name. */
const KIND_LABEL: Record<string, string> = {
  run: "Run",
  bike: "Ride",
  swim: "Swim",
  brick: "Brick",
  lift: "Strength",
  strength: "Strength",
  hybrid: "Hybrid",
  cardio: "Cardio",
  race: "Race",
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
    if (env.STRAVA_WRITE_ENABLED !== "true") return { posted: false };
    if (ctx.session.kind === "rest") return { posted: false };

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
    const label = KIND_LABEL[s.kind] ?? "Workout";
    const name = `Duravel ${label} — Week ${ctx.weekNumber}`;
    const description = [
      ctx.programName ?? "Duravel training program",
      `Week ${ctx.weekNumber}${ctx.sportLabel ? ` · ${ctx.sportLabel}` : ""}`,
      ctx.rpe ? `RPE ${ctx.rpe}/10` : null,
      ctx.status === "partial" ? "(partial)" : null,
      "",
      "Logged with Duravel — duravel.app",
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

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
