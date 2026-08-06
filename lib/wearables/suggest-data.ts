import { createClient } from "@/lib/supabase/server";
import type { ProgramData } from "@/lib/schemas";
import { getUserActivities, type ActivityRow } from "./activities";
import { programDayForDate, sessionLabel, type LinkableSession } from "./link";
import { formatDurationS, formatDistanceMiles, formatActivityType } from "./format";

/**
 * A same-day link suggestion (Sync-Linking Increment 3, rules #2.1 / #2.2): an
 * unlinked synced activity whose calendar date lands on a program day that has
 * at least one planned (non-race) session. `candidates` are the planned sessions
 * on that day — one for a straight confirm, several for the multi-session picker.
 */
export type SyncSuggestion = {
  activityId: string;
  title: string;
  detail: string;
  weekNumber: number;
  day: string;
  candidates: LinkableSession[];
};

/** Compact synced-activity descriptor for the in-program-view link control. */
export type SyncActivitySummary = {
  /** Duravel's row id — used for linking/unlinking within Duravel. */
  activityId: string;
  /** Which service the activity came from. */
  provider?: string;
  /**
   * The PROVIDER's own activity id. Strava's API keys off this, NOT `activityId`
   * — sending the Duravel UUID made the branded-write fail 400 in production
   * (a 36-char UUID against a 32-char field, and Strava would have 404'd anyway).
   */
  externalId?: string | null;
  title: string;
  detail: string;
};

/**
 * Everything the program view needs for sync-linking, computed from a single
 * activities load:
 *  - `suggestions`: same-day match cards (top-of-view banner);
 *  - `linkableActivities`: unlinked synced workouts the athlete can attach to
 *    any planned session directly from the week table;
 *  - `linkedBySession`: which synced activity is already linked to each session,
 *    keyed `${weekNumber}:${day}:${sessionIndex}` (for the "Synced" state + unlink).
 */
export type ProgramSyncData = {
  suggestions: SyncSuggestion[];
  linkableActivities: SyncActivitySummary[];
  linkedBySession: Record<string, SyncActivitySummary>;
};

const EMPTY: ProgramSyncData = { suggestions: [], linkableActivities: [], linkedBySession: {} };

/**
 * May this synced activity be attached to a planned session as its ACTUAL?
 *
 * Two disqualifiers, and the second is the one that matters (migration 0040):
 *
 *  - `linked` — already attached somewhere.
 *  - `self_posted` — **Duravel wrote it.** The Strava auto-post copies the PLAN
 *    to Strava; sync then imports it back, and it looked exactly like a workout
 *    the athlete had recorded. `suggest-data` matched it to the very session that
 *    produced it and offered "Confirm match". Accepting that makes the plan its
 *    own evidence: the actuals become the planned numbers, so adherence,
 *    readiness and the weekly adaptation all read a perfectly-executed week
 *    regardless of what happened. Seen live 2026-08-06 — and the suggestion still
 *    carried the pre-patch-21 `1.00 mi`, so it would have written a wrong actual
 *    on top of a circular one.
 *
 * Pure so it can be asserted directly: the callers need Supabase, and this repo
 * mocks nothing.
 */
export function isLinkCandidate(a: { linked: boolean; self_posted?: boolean }): boolean {
  return !a.linked && a.self_posted !== true;
}

function detailLine(startTime: string, durationS: number | null, distanceM: number | null): string {
  const parts: string[] = [];
  const d = new Date(startTime);
  if (!Number.isNaN(d.getTime())) {
    parts.push(
      d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    );
  }
  if (distanceM) {
    const dist = formatDistanceMiles(distanceM);
    if (dist !== "—") parts.push(dist);
  }
  const dur = formatDurationS(durationS);
  if (dur !== "—") parts.push(dur);
  return parts.join(" · ");
}

function toSummary(a: ActivityRow): SyncActivitySummary {
  return {
    activityId: a.id,
    provider: a.provider,
    externalId: a.external_id,
    title: formatActivityType(a.type),
    detail: detailLine(a.start_time ?? "", a.duration_s, a.distance_m),
  };
}

export function sessionKey(weekNumber: number, day: string, sessionIndex: number): string {
  return `${weekNumber}:${day}:${sessionIndex}`;
}

/**
 * All sync-linking data for a program (suggestions + in-view link maps).
 * Returns empty data for non-ready programs. Reads programs + activities via RLS.
 */
export async function getProgramSyncData(programId: string): Promise<ProgramSyncData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  const { data: program } = await supabase
    .from("programs")
    .select("id, status, start_date, duration_weeks, program_data")
    .eq("id", programId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!program || program.status !== "ready") return EMPTY;
  const pdata = program.program_data as ProgramData | null;
  if (!pdata) return EMPTY;

  const activities = await getUserActivities();

  // Which synced activity (if any) is linked to each session of THIS program.
  const linkedBySession: Record<string, SyncActivitySummary> = {};
  for (const a of activities) {
    if (a.linked && a.link && a.link.program_id === programId) {
      linkedBySession[sessionKey(a.link.week_number, a.link.day, a.link.session_index)] =
        toSummary(a);
    }
  }

  // Unlinked synced workouts — attachable to any planned session, newest first.
  //
  // `self_posted` is excluded from BOTH lists (migration 0040). An activity
  // Duravel auto-posted is a copy of the PLAN, not a record of the training — it
  // only came back through sync because it was written to Strava in the first
  // place. Offering it as a link candidate let the plan become its own evidence:
  // confirm the match and the "actuals" ARE the planned numbers, so adherence,
  // readiness and the weekly adaptation all read a perfectly-executed week
  // whatever the athlete actually did. Seen live 2026-08-06 — and the suggestion
  // carried a stale pre-patch-21 distance, so it would have written a wrong
  // actual too. Not hand-linkable either: it is never the right answer.
  const linkableActivities = activities.filter(isLinkCandidate).map(toSummary);

  // Same-day suggestions (rules #2.1 / #2.2) from the unlinked, dated activities.
  const suggestions: SyncSuggestion[] = [];
  for (const a of activities) {
    if (!isLinkCandidate(a) || !a.start_time) continue;
    const match = programDayForDate(
      program.start_date,
      program.duration_weeks,
      new Date(a.start_time),
    );
    if (!match) continue;
    const week = pdata.weeks.find((w) => w.weekNumber === match.weekNumber);
    const dayObj = week?.days.find((d) => d.day === match.day);
    if (!dayObj) continue;

    const candidates: LinkableSession[] = [];
    dayObj.sessions.forEach((s, i) => {
      if (s.kind === "race") return;
      candidates.push({
        weekNumber: match.weekNumber,
        day: match.day,
        sessionIndex: i,
        label: sessionLabel(s),
      });
    });
    if (candidates.length === 0) continue;

    suggestions.push({
      activityId: a.id,
      title: formatActivityType(a.type),
      detail: detailLine(a.start_time, a.duration_s, a.distance_m),
      weekNumber: match.weekNumber,
      day: match.day,
      candidates,
    });
  }

  return { suggestions, linkableActivities, linkedBySession };
}
