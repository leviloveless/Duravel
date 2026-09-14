import type { ProgramWeek, WorkoutLog } from "@/lib/schemas";

/**
 * Pure trigger-detection for push workout reminders. No side effects, no
 * server-only imports, no date/timezone math — unit-tested. The orchestrator
 * (lib/push/reminders.ts, server-only) computes the current week + today's
 * weekday using the app's exact helpers and passes them in, so these functions
 * only decide "given this week + these logs, is a reminder warranted?".
 */

/** getDay() index → training-day key. Matches components/dashboard/week-strip. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * How many sessions scheduled on `dayKey` in `week` have NOT been logged yet.
 * A session counts as logged when a workout_logs row exists for its planned
 * (weekNumber, day, sessionIndex) with any status — logs keep their planned
 * coordinates even when the session was actually done on another day. Returns 0
 * for a rest day (no sessions) or when everything is already logged.
 */
export function unloggedSessionsToday(
  week: ProgramWeek,
  dayKey: string,
  logs: WorkoutLog[],
): number {
  const day = week.days.find((d) => d.day === dayKey);
  if (!day || day.sessions.length === 0) return 0;
  let unlogged = 0;
  for (let i = 0; i < day.sessions.length; i++) {
    const logged = logs.some(
      (l) => l.weekNumber === week.weekNumber && l.day === dayKey && l.sessionIndex === i,
    );
    if (!logged) unlogged += 1;
  }
  return unlogged;
}

/**
 * Did `weekNumber` have at least one logged session? Used to decide whether a
 * just-completed week is worth a "review ready" nudge (an untouched week has
 * nothing to review).
 */
export function weekHasActivity(weekNumber: number, logs: WorkoutLog[]): boolean {
  return logs.some((l) => l.weekNumber === weekNumber);
}
