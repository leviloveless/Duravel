/**
 * Push an EXTRA (unplanned) workout to Strava as a manual activity
 * (Levi, 2026-08-19).
 *
 * Extras had no route out of the app at all: a logged session can auto-post, and
 * a linked activity can be branded, but a workout the program never planned —
 * the whole reason extras exist — could only be typed in and looked at.
 *
 * ## Duravel goes in the TITLE and at the TOP of the description
 *
 * That is the explicit ask, and it is a DELIBERATE departure from how the rest
 * of the app writes to Strava, so it is worth saying why the difference is
 * defensible rather than inconsistent:
 *
 *  - the athlete's OWN activities stay unbranded — the Copy button and the
 *    manual "To Strava" write put the workout on the page and nothing else
 *    (Levi, 2026-08-05: "a clean description");
 *  - an activity DURAVEL CREATED is Duravel's post, so it signs itself. The
 *    auto-post signs at the bottom (`AUTOPOST_FOOTER`) because its description
 *    opens with `Week 1 - Thursday - Threshold Run`, which already says what the
 *    session is.
 *
 * An extra has no prescription to lead with — often nothing but "45 min" and a
 * note — so the signature is the first thing worth reading, and it goes on top.
 *
 * ## What is shared with the auto-post, and why
 *
 * `syncAutoPost` — the one-workout-one-activity rule. It is already generic over
 * "an id I may or may not have stored", so extras get idempotency for free
 * rather than growing a second, subtly different copy of the same logic. The
 * three cases it encodes (no id → create; id → refresh the text; id but gone →
 * post afresh) are exactly as true here.
 *
 * The pure half of this module takes no Supabase client and no network, so the
 * text and the payload can be asserted directly — the repo mocks nothing.
 */

import { env, envFlag } from "@/lib/env";
import type { ExtraWorkout, ExtraWorkoutKindName } from "@/lib/schemas";
import { extraDetail, extraTitle } from "@/lib/extra-workouts";
import { stravaTitleLine } from "@/lib/program/session-summary";
import { dayDate, DAY_LABEL } from "@/components/program/format";
import { getConnection, upsertConnection } from "./connections";
import { createManualActivity, refreshAccessToken, updateActivityDescription } from "./strava-api";
import type { ManualActivityInput } from "./strava-api";
import { expiresAtIso, hasWriteScope, isTokenExpired } from "./strava";
import { localWallClockIso } from "@/lib/timezone";
import { markSelfPosted } from "./activity-ingest";
import { syncAutoPost } from "./strava-autopost";

const METERS_PER_MILE = 1609.344;

/**
 * The signature, and it leads (Levi, 2026-08-19).
 *
 * No em dash, unlike `AUTOPOST_FOOTER` — that one's leading dash reads as
 * "signed off by" at the foot of a description. At the top of one it would read
 * as a stray bullet.
 */
export const EXTRA_STRAVA_HEADER = "Duravel · duravel.app";

/**
 * Put the header on, once.
 *
 * Idempotent because the refresh path rewrites the description of an activity
 * that already carries it. Without this, pushing an edited extra three times
 * would stack three headers — the same shape of bug as the duplicate activities
 * migration 0041 fixed, just inside one description instead of across three.
 */
export function withDuravelHeader(description: string): string {
  const body = description.replace(/^\s+/, "").replace(/\s+$/, "");
  if (body === EXTRA_STRAVA_HEADER) return EXTRA_STRAVA_HEADER;
  if (body.startsWith(`${EXTRA_STRAVA_HEADER}\n`)) return body;
  return body.length ? `${EXTRA_STRAVA_HEADER}\n\n${body}` : EXTRA_STRAVA_HEADER;
}

/**
 * Extra kind → Strava `sport_type`.
 *
 * Deliberately its own table rather than reusing the auto-post's `KIND_TO_SPORT`:
 * that one is keyed on SESSION kinds, and the two enums only happen to overlap.
 * Sharing it would mean a new session kind silently changing what an extra posts
 * as. `other` is the athlete saying "something else", and Strava's `Workout` is
 * exactly that.
 */
export const EXTRA_KIND_TO_SPORT: Record<ExtraWorkoutKindName, string> = {
  run: "Run",
  lift: "WeightTraining",
  hybrid: "Crossfit",
  cardio: "Workout",
  other: "Workout",
};

export interface ExtraStravaContext {
  /** `programs.start_date`, used to place the activity on the day it happened. */
  programStartDate?: string | null;
  /** The athlete's IANA zone (`profiles.timezone`). */
  timezone?: string | null;
}

/**
 * Title and description.
 *
 * `Duravel - Week 3 - Wednesday - Morning Ride`
 *
 * ```
 * Duravel · duravel.app
 *
 * Extra workout - Week 3 - Wednesday
 * 45 min · 4.2 mi · 148 bpm · RPE 6
 * Legs felt good, kept it easy.
 * ```
 *
 * The week/day line repeats what the title says, and that is on purpose: Strava
 * truncates activity names in most feed views, so the description cannot assume
 * the title was read. The stats line is `extraDetail` — the same string the
 * program page shows under the workout — so the app and Strava cannot drift.
 */
export function buildExtraStravaText(extra: ExtraWorkout): {
  name: string;
  description: string;
} {
  const name = `Duravel - ${stravaTitleLine(extra.day, extra.weekNumber, extraTitle(extra))}`;

  const dayLabel = DAY_LABEL[extra.day];
  const lines = [
    `Extra workout - Week ${extra.weekNumber}${dayLabel ? ` - ${dayLabel}` : ""}`,
    extraDetail(extra),
    extra.note?.trim() ?? "",
  ].filter((l) => l.length > 0);

  return { name, description: withDuravelHeader(lines.join("\n")) };
}

/**
 * When the activity claims to have happened.
 *
 * An extra carries a week and a weekday, not a timestamp, so the exact time is
 * genuinely unknown — but the DAY is not, and Strava freezes `start_date` at
 * creation with no way to correct it later. Putting the activity on the right
 * day at a made-up hour beats putting it at the right hour on the day the button
 * happened to be pressed.
 *
 * The one case where the time IS known is the common one: an extra pushed the
 * same day it was done. Then the current wall clock is used, and the guess is
 * only ever applied to a workout from an earlier day.
 *
 * `nowLocalIso` is passed in rather than read here so this stays pure.
 */
export function extraStartLocalIso(
  extra: ExtraWorkout,
  programStartDate: string | null | undefined,
  nowLocalIso: string,
): string {
  if (!programStartDate) return nowLocalIso;
  const d = dayDate(programStartDate, extra.weekNumber, extra.day);
  if (Number.isNaN(d.getTime())) return nowLocalIso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Same day → keep the real clock time.
  if (nowLocalIso.startsWith(date)) return nowLocalIso;
  return `${date}T12:00:00Z`;
}

/** Raised when the extra has no duration — see `buildExtraStravaActivity`. */
export const EXTRA_NEEDS_DURATION = "extra_needs_duration";

/**
 * The exact Strava payload for one extra.
 *
 * **A missing duration is refused, not defaulted.** The auto-post falls back to
 * `?? 45` for a session, which is defensible there because a planned session has
 * an engine-estimated length behind it. An extra with no duration is the athlete
 * saying "I don't know" — and `elapsed_time` is one of the fields Strava freezes
 * forever, so a guess here is a wrong number that can never be corrected. Better
 * to ask for the minutes.
 */
export function buildExtraStravaActivity(
  extra: ExtraWorkout,
  startLocalIso: string,
): ManualActivityInput {
  if (!extra.durationMin || extra.durationMin <= 0) throw new Error(EXTRA_NEEDS_DURATION);
  const { name, description } = buildExtraStravaText(extra);
  // Only on-foot / measured distance is worth sending; a lift has none, and a
  // `distance` of 0 makes Strava render an empty pace field.
  const miles = extra.distanceMiles && extra.distanceMiles > 0 ? extra.distanceMiles : undefined;
  return {
    name,
    sportType: EXTRA_KIND_TO_SPORT[extra.kind] ?? "Workout",
    startLocalIso,
    elapsedSeconds: Math.round(extra.durationMin * 60),
    description,
    distanceMeters: miles ? miles * METERS_PER_MILE : undefined,
  };
}

export type PushExtraResult =
  | { ok: true; activityId: string; created: boolean }
  | {
      ok: false;
      reason: "disabled" | "not_connected" | "reconnect_required" | "needs_duration" | "error";
    };

/**
 * Push one extra to Strava.
 *
 * **Unlike `autoPostSessionToStrava`, this REPORTS its failures.** That one is a
 * side effect of saving a log and must never take the log down with it, so it
 * swallows everything and returns `{ posted: false }`. This one is a button the
 * athlete pressed: a silent no-op would leave them staring at a control that
 * appears to do nothing, which is the failure mode this codebase keeps having to
 * fix. Each reason maps to something the UI can actually say.
 *
 * The auto-post opt-out (`profiles.strava_autopost`) is deliberately NOT checked.
 * It means "don't post my sessions automatically" — it is not a revocation of
 * consent for a push the athlete just asked for by name.
 */
export async function pushExtraToStrava(
  userId: string,
  extra: ExtraWorkout,
  ctx: ExtraStravaContext = {},
): Promise<PushExtraResult> {
  if (!extra.durationMin || extra.durationMin <= 0) return { ok: false, reason: "needs_duration" };
  if (!envFlag(env.STRAVA_WRITE_ENABLED)) return { ok: false, reason: "disabled" };

  const conn = await getConnection(userId, "strava");
  if (!conn) return { ok: false, reason: "not_connected" };
  // A connection made before the write grant cannot post. Say "reconnect"
  // rather than "error": the athlete has something to DO about this one.
  if (!hasWriteScope(conn.scope)) return { ok: false, reason: "reconnect_required" };

  try {
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

    const token = accessToken;
    const startLocalIso = extraStartLocalIso(
      extra,
      ctx.programStartDate,
      localWallClockIso(new Date(), ctx.timezone),
    );

    const { activityId, created } = await syncAutoPost(extra.stravaActivityId, {
      create: async () => {
        const a = await createManualActivity(token, buildExtraStravaActivity(extra, startLocalIso));
        return a.id ? String(a.id) : "";
      },
      // Text only — Strava freezes distance, elapsed_time and start_date at
      // creation, so an edited duration cannot reach an activity that already
      // exists. Refreshing the name and description is the whole of what a
      // second push can do.
      refresh: async (id) => {
        const { name, description } = buildExtraStravaText(extra);
        await updateActivityDescription(token, id, description, name);
      },
    });

    if (!activityId) return { ok: false, reason: "error" };

    // Claim it BEFORE the next sync can import it (migration 0040). Otherwise
    // the activity Duravel just posted comes back as a link candidate — and for
    // an extra it is worse than for a session, because `addExtraFromActivity`
    // would offer to add this workout to the program a second time.
    if (created) await markSelfPosted(userId, "strava", activityId);

    return { ok: true, activityId, created };
  } catch (e) {
    const message = (e as Error)?.message;
    if (message === EXTRA_NEEDS_DURATION) return { ok: false, reason: "needs_duration" };
    if (message === "strava_write_forbidden") return { ok: false, reason: "reconnect_required" };
    return { ok: false, reason: "error" };
  }
}
