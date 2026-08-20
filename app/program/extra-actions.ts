"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ExtraWorkoutInputSchema, ExtraWorkoutUpdateSchema } from "@/lib/schemas";
import { extrasFromRows } from "@/lib/extra-workouts";
import { pushExtraToStrava, type PushExtraResult } from "@/lib/wearables/extra-strava";

const METERS_PER_MILE = 1609.344;

export type ExtraResult = { ok: true } | { ok: false; error: string };

/**
 * Record a workout the program did NOT plan — on a rest day, or as an extra
 * session on a day that already has one.
 *
 * Deliberately separate from `workout_logs`: those are keyed on a planned
 * session's position and the logs API rejects a position with no session behind
 * it, which is exactly why unplanned work had nowhere to go. Extras also stay
 * out of the program blob so the weekly summary keeps equalling the engine's
 * prescribed volume, and so Recalculate — which replaces program_data.weeks —
 * doesn't wipe them.
 */
export async function addExtraWorkout(input: unknown): Promise<ExtraResult> {
  const parsed = ExtraWorkoutInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid workout" };
  }
  const v = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Ownership: RLS would block a foreign program anyway, but fail clearly here.
  const { data: program } = await supabase
    .from("programs")
    .select("id, user_id")
    .eq("id", v.programId)
    .maybeSingle();
  if (!program || program.user_id !== user.id) return { ok: false, error: "Program not found" };

  const { error } = await supabase.from("extra_workouts").insert({
    user_id: user.id,
    program_id: v.programId,
    week_number: v.weekNumber,
    day: v.day,
    kind: v.kind,
    title: v.title ?? null,
    duration_min: v.durationMin ?? null,
    distance_miles: v.distanceMiles ?? null,
    avg_hr: v.avgHr ?? null,
    goal_zone: v.goalZone ?? null,
    rpe: v.rpe ?? null,
    note: v.note ?? null,
    activity_id: v.activityId ?? null,
  });
  if (error) {
    // The (program_id, activity_id) unique index — same synced activity twice.
    if (error.code === "23505") return { ok: false, error: "That synced workout is already added." };
    return { ok: false, error: error.message };
  }

  revalidatePath(`/program/${v.programId}`);
  return { ok: true };
}

/**
 * Add an already-synced wearable activity as an extra workout, carrying its
 * duration / distance / HR across so the athlete doesn't retype them.
 */
export async function addExtraFromActivity(
  programId: string,
  weekNumber: number,
  day: string,
  activityId: string,
): Promise<ExtraResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: activity } = await supabase
    .from("wearable_activities")
    .select("id, user_id, type, duration_s, distance_m, avg_hr")
    .eq("id", activityId)
    .maybeSingle();
  if (!activity || activity.user_id !== user.id) return { ok: false, error: "Workout not found" };

  const distanceM = Number(activity.distance_m ?? 0);
  const durationS = Number(activity.duration_s ?? 0);

  return addExtraWorkout({
    programId,
    weekNumber,
    day,
    kind: kindFromActivityType(activity.type),
    title: activity.type ? String(activity.type) : undefined,
    durationMin: durationS > 0 ? Math.max(1, Math.round(durationS / 60)) : undefined,
    distanceMiles: distanceM > 0 ? Math.round((distanceM / METERS_PER_MILE) * 10) / 10 : undefined,
    avgHr: activity.avg_hr ? Math.round(Number(activity.avg_hr)) : undefined,
    activityId,
  });
}

/** Remove an extra workout. RLS scopes the delete to the owner. */
export async function deleteExtraWorkout(programId: string, id: string): Promise<ExtraResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("extra_workouts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/program/${programId}`);
  return { ok: true };
}

/** Map a provider's activity type onto one of our extra-workout kinds. */
function kindFromActivityType(type: unknown): "run" | "lift" | "hybrid" | "cardio" | "other" {
  const t = String(type ?? "").toLowerCase();
  if (t.includes("run")) return "run";
  if (t.includes("weight") || t.includes("strength")) return "lift";
  if (t.includes("crossfit") || t.includes("hiit") || t.includes("workout")) return "hybrid";
  if (t.includes("ride") || t.includes("bike") || t.includes("row") || t.includes("swim") || t.includes("elliptical"))
    return "cardio";
  return "other";
}

/**
 * Edit an extra workout in place.
 *
 * Extras could only ever be added and deleted, so correcting a typo meant
 * retyping the whole thing (Levi, 2026-08-13). Every field the add form writes
 * is editable here, including week/day — a workout logged on the wrong day
 * should be a fix, not a delete-and-retype.
 *
 * ## Frozen weeks
 *
 * Blocked once the week's review has been APPLIED, matching
 * `linkActivityToSession`. An applied review has already fed those numbers into
 * the next week's prescription; letting the inputs move afterwards would make
 * the adaptation unexplainable. **Both** the week it is leaving and the week it
 * is moving to are checked — otherwise an extra could be dragged out of a frozen
 * week, which changes that week's reported totals just as surely.
 *
 * ⚠️ `deleteExtraWorkout` has NO such guard today, so a determined athlete can
 * still delete-and-re-add around this. Flagged rather than changed: tightening
 * delete is a behaviour change nobody asked for.
 */
export async function updateExtraWorkout(input: unknown): Promise<ExtraResult> {
  const parsed = ExtraWorkoutUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid workout" };
  }
  const v = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // The row must exist and be the caller's. RLS would block a foreign row, but
  // we need its CURRENT week to decide whether it is leaving a frozen one.
  const { data: existing } = await supabase
    .from("extra_workouts")
    .select("id, user_id, program_id, week_number")
    .eq("id", v.id)
    .maybeSingle();
  if (!existing || existing.user_id !== user.id) return { ok: false, error: "Workout not found" };
  if (existing.program_id !== v.programId) return { ok: false, error: "Workout not found" };

  // Frozen check across BOTH the old and new week.
  const weeks = [...new Set([existing.week_number as number, v.weekNumber])];
  const { data: applied } = await supabase
    .from("adaptations")
    .select("week_number")
    .eq("program_id", v.programId)
    .eq("decision", "applied")
    .in("week_number", weeks);
  if (applied && applied.length > 0) {
    return { ok: false, error: "That week has already been reviewed — its logs are locked." };
  }

  const { error } = await supabase
    .from("extra_workouts")
    .update({
      week_number: v.weekNumber,
      day: v.day,
      kind: v.kind,
      title: v.title ?? null,
      duration_min: v.durationMin ?? null,
      distance_miles: v.distanceMiles ?? null,
      avg_hr: v.avgHr ?? null,
      goal_zone: v.goalZone ?? null,
      rpe: v.rpe ?? null,
      note: v.note ?? null,
    })
    .eq("id", v.id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/program/${v.programId}`);
  return { ok: true };
}

/** What the "To Strava" control on an extra needs back. */
export type PushExtraActionResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string; reason: Extract<PushExtraResult, { ok: false }>["reason"] };

const PUSH_MESSAGE: Record<Extract<PushExtraResult, { ok: false }>["reason"], string> = {
  disabled: "Posting to Strava isn't switched on yet.",
  not_connected: "Connect Strava in Settings first.",
  reconnect_required: "Reconnect Strava to allow posting.",
  needs_duration: "Add a duration first — Strava can't take a workout with no time on it.",
  error: "Strava didn't accept that. Try again in a moment.",
};

/**
 * Push one extra workout to Strava as a manual activity, titled and signed
 * Duravel (Levi, 2026-08-19).
 *
 * Pushing twice does NOT create a second activity: the id of the one this extra
 * already posted is stored on the row, and a second push refreshes that
 * activity's text instead (see migration 0044). The id is re-written whenever it
 * changes, which covers the case where the athlete deleted the activity on
 * Strava and `syncAutoPost` had to post a fresh one.
 *
 * Not blocked on a frozen week, unlike `updateExtraWorkout`. Freezing exists so
 * the numbers behind an applied adaptation cannot move afterwards; posting a
 * copy of a workout to Strava changes no number the engine ever reads.
 */
export async function pushExtraWorkoutToStrava(
  programId: string,
  id: string,
): Promise<PushExtraActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in", reason: "error" };

  const { data: row } = await supabase
    .from("extra_workouts")
    .select(
      "id, user_id, program_id, week_number, day, kind, title, duration_min, distance_miles, avg_hr, goal_zone, rpe, note, activity_id, strava_activity_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!row || row.user_id !== user.id || row.program_id !== programId) {
    return { ok: false, error: "Workout not found", reason: "error" };
  }

  const extra = extrasFromRows([row])[0];
  // `extrasFromRows` drops a row that no longer validates rather than rendering
  // half a workout; here that would mean posting half a workout.
  if (!extra) return { ok: false, error: "That workout can't be read", reason: "error" };

  const { data: program } = await supabase
    .from("programs")
    .select("start_date")
    .eq("id", programId)
    .maybeSingle();

  // `timezone` arrived in migration 0039; fall back rather than let an
  // unapplied migration turn into "Strava didn't accept that".
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();

  const result = await pushExtraToStrava(user.id, extra, {
    programStartDate: program?.start_date ?? null,
    timezone: profile?.timezone ?? null,
  });
  if (!result.ok) return { ok: false, error: PUSH_MESSAGE[result.reason], reason: result.reason };

  if (result.activityId !== extra.stravaActivityId) {
    await supabase
      .from("extra_workouts")
      .update({ strava_activity_id: result.activityId })
      .eq("id", id)
      .eq("user_id", user.id);
  }

  revalidatePath(`/program/${programId}`);
  return { ok: true, created: result.created };
}
