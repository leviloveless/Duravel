import type { SupabaseClient } from "@supabase/supabase-js";
import { env, envFlag } from "@/lib/env";
import type { Session } from "@/lib/schemas";
import { getConnection, upsertConnection } from "./connections";
import { refreshAccessToken, createManualActivity } from "./strava-api";
import type { ManualActivityInput } from "./strava-api";
import { isTokenExpired, expiresAtIso, hasWriteScope } from "./strava";
import { sessionSummary } from "@/lib/program/session-summary";
import { sessionTiming, sessionMiles } from "@/lib/session-volume";
import { localWallClockIso } from "@/lib/timezone";
import { markSelfPosted } from "./activity-ingest";

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

/**
 * The WHOLE session, not its main set.
 *
 * These used to read `s.durationMin` and `s.distanceMiles` straight off the
 * session. On a run those two fields are the WORK portion only — the warmup and
 * cooldown live in `RUN_WARMUP_COOLDOWN` / `overheadMiles`. So a 28-minute,
 * 2.5-mile threshold run auto-posted to Strava as `8 min / 1.00 mi` while the
 * description written by the SAME call said "Warm up: 12 min … Work: 1 x 1 mile
 * … Cooldown: 8 min". The activity contradicted its own text (seen live
 * 2026-08-06, week 1 Thursday).
 *
 * A lift was worse: it carries no `durationMin` at all, so it fell through to
 * the hardcoded `?? 45` when a strength session is a fixed 60.
 *
 * `sessionTiming` / `sessionMiles` are the same totals the program table and the
 * result card already show, so Strava now agrees with the app.
 */
function plannedDurationMin(s: Session): number | undefined {
  const total = sessionTiming(s).total;
  return total > 0 ? total : undefined;
}
function plannedDistanceMiles(s: Session): number | undefined {
  const miles = sessionMiles(s);
  return miles > 0 ? miles : undefined;
}

/**
 * The exact Strava payload for one logged session — pure, so it can be asserted
 * without a network or a Supabase client. `autoPostSessionToStrava` is the
 * gating + token half; this is the "what actually gets posted" half.
 */
export function buildAutoPostActivity(
  ctx: AutoPostContext,
  startLocalIso: string,
): ManualActivityInput {
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
  return {
    name: summary.stravaTitle,
    sportType: KIND_TO_SPORT[s.kind] ?? "Workout",
    startLocalIso,
    elapsedSeconds: Math.round(durMin * 60),
    description: summary.stravaDescription,
    distanceMeters: distMiles ? distMiles * 1609.34 : undefined,
  };
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

    // Opt-out preference (default ON when the row/column is absent). The same
    // read fetches the athlete's zone — `start_date_local` is a LOCAL wall clock
    // (see `localWallClockIso`), and sending UTC there stamped every activity
    // hours late. `timezone` is selected defensively: a deploy that lands before
    // migration 0039 is applied would 400 on the unknown column and kill the
    // whole auto-post, so it falls back to the narrow select.
    let prof: { strava_autopost?: boolean | null; timezone?: string | null } | null = null;
    const withTz = await supabase
      .from("profiles")
      .select("strava_autopost, timezone")
      .eq("id", userId)
      .maybeSingle();
    if (withTz.error) {
      const { data } = await supabase
        .from("profiles")
        .select("strava_autopost")
        .eq("id", userId)
        .maybeSingle();
      prof = data;
    } else {
      prof = withTz.data;
    }
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

    const created = await createManualActivity(
      accessToken,
      buildAutoPostActivity(ctx, localWallClockIso(new Date(), prof?.timezone)),
    );
    // Claim it BEFORE any sync can import it (migration 0040). Without this the
    // next sync pulls Duravel's own post back in and `suggest-data` offers to
    // link it to the session that produced it — the plan becoming its own
    // evidence for adherence and the weekly adaptation.
    //
    // A stub row, not an update: the activity does not exist locally yet. The
    // sync upsert later fills in type/duration/distance/raw on the same
    // (user, provider, external_id) key, and because `activityToRow` doesn't
    // list `self_posted`, ON CONFLICT DO UPDATE leaves the flag alone.
    if (created.id) {
      await markSelfPosted(userId, "strava", String(created.id));
    }
    return { posted: true };
  } catch {
    // Never surface a Strava failure to the logging flow.
    return { posted: false };
  }
}
