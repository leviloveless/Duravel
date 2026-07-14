import { createClient } from "@/lib/supabase/server";
import type { WearableProvider } from "./types";

/**
 * A synced activity plus its link status (which planned session, if any, it's
 * linked to). Powers the Activity dashboard. Reads are RLS-scoped to the caller.
 */
export type ActivityRow = {
  id: string;
  provider: WearableProvider;
  type: string | null;
  start_time: string | null;
  duration_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  linked: boolean;
  link: { program_id: string; week_number: number; day: string; session_index: number } | null;
};

export async function getUserActivities(limit = 200): Promise<ActivityRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: acts } = await supabase
    .from("wearable_activities")
    .select("id, provider, type, start_time, duration_s, distance_m, avg_hr")
    .eq("user_id", user.id)
    .order("start_time", { ascending: false })
    .limit(limit);
  const activities =
    (acts as Omit<ActivityRow, "linked" | "link">[] | null) ?? [];
  if (activities.length === 0) return [];

  // Which activities are already linked (workout_logs that point back at them).
  const { data: logs } = await supabase
    .from("workout_logs")
    .select("wearable_activity_id, program_id, week_number, day, session_index")
    .not("wearable_activity_id", "is", null);

  const linkByActivity = new Map<string, ActivityRow["link"]>();
  for (const l of (logs as
    | { wearable_activity_id: string; program_id: string; week_number: number; day: string; session_index: number }[]
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
