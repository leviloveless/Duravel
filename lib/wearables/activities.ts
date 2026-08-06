import { createClient } from "@/lib/supabase/server";
import type { WearableProvider } from "./types";

/**
 * A synced activity plus its link status (which planned session, if any, it's
 * linked to). Powers the Activity dashboard. Reads are RLS-scoped to the caller.
 *
 * Only CANONICAL rows are returned (`is_primary`) so a session that arrived from
 * multiple sources (e.g. Strava + Apple Health) shows once — the cross-source
 * dedupe writer (lib/wearables/pipeline) picks the primary per cluster.
 */
export type ActivityRow = {
  /** Duravel's own row id (a UUID). NOT the provider's id. */
  id: string;
  /** The PROVIDER's activity id — what Strava's API expects. */
  external_id: string | null;
  provider: WearableProvider;
  type: string | null;
  start_time: string | null;
  duration_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  /** True when DURAVEL created this activity (Strava auto-post, migration 0040).
   *  It is the PLAN, not a record of training — never a link candidate. */
  self_posted: boolean;
  linked: boolean;
  link: { program_id: string; week_number: number; day: string; session_index: number } | null;
};

export async function getUserActivities(limit = 200): Promise<ActivityRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const BASE = "id, external_id, provider, type, start_time, duration_s, distance_m, avg_hr";
  const select = (cols: string) =>
    supabase
      .from("wearable_activities")
      .select(cols)
      .eq("user_id", user.id)
      .eq("is_primary", true)
      .order("start_time", { ascending: false })
      .limit(limit);

  // `self_posted` is selected defensively: a deploy that lands before migration
  // 0040 is applied would 400 on the unknown column and blank the whole Activity
  // page. Falling back just loses the flag until the migration runs.
  let acts = null as unknown;
  const withFlag = await select(`${BASE}, self_posted`);
  if (withFlag.error) {
    const { data } = await select(BASE);
    acts = data;
  } else {
    acts = withFlag.data;
  }
  const activities = (
    (acts as Omit<ActivityRow, "linked" | "link" | "self_posted">[] | null) ?? []
  ).map((a) => ({ ...a, self_posted: (a as { self_posted?: boolean }).self_posted === true }));
  if (activities.length === 0) return [];

  // Which activities are already linked (workout_logs that point back at them).
  const { data: logs } = await supabase
    .from("workout_logs")
    .select("wearable_activity_id, program_id, week_number, day, session_index")
    .not("wearable_activity_id", "is", null);

  const linkByActivity = new Map<string, ActivityRow["link"]>();
  for (const l of (logs as
    | {
        wearable_activity_id: string;
        program_id: string;
        week_number: number;
        day: string;
        session_index: number;
      }[]
    | null) ?? []) {
    if (l.wearable_activity_id) {
      linkByActivity.set(l.wearable_activity_id, {
        program_id: l.program_id,
        week_number: l.week_number,
        day: l.day,
        session_index: l.session_index,
      });
    }
  }

  return activities.map((a) => {
    const link = linkByActivity.get(a.id) ?? null;
    return { ...a, linked: !!link, link };
  });
}
