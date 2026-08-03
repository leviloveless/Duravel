/**
 * Rep and recovery structure for quality runs — the single source of truth for
 * how an interval or threshold session is actually laid out.
 *
 * This exists because the structure was implicit in three places at once: the
 * description text knew the rep count, the timing model knew the warmup/cooldown,
 * and nothing at all knew about the between-rep recovery. That last gap meant a
 * "45 minute" interval session really took 60, and roughly a mile and a half of
 * recovery jogging was counted in no total anywhere.
 *
 * Kept dependency-free so `session-volume`, `run-descriptions` and the reconciler
 * can all import it without a cycle.
 */

import type { ExperienceLevel, RunType } from "./types";

/** Reps per session by running experience. */
export const INTERVAL_REPS: Record<ExperienceLevel, number> = {
  beginner: 4,
  intermediate: 5,
  advanced: 6,
};

export const THRESHOLD_REPS: Record<ExperienceLevel, number> = {
  beginner: 2,
  intermediate: 3,
  advanced: 4,
};

/**
 * Recovery as a multiple of one rep's duration — the work:rest ratio.
 * Interval is 1:1 (rest equals the rep), threshold 2:1 (rest is half). These are
 * set by the workout's intent and are not a tuning knob.
 */
const REST_RATIO: Partial<Record<RunType, number>> = {
  interval: 1,
  threshold: 0.5,
};

/** How many reps this run type has for this athlete, or null if it isn't rep-based. */
export function repCount(runType: RunType, exp: ExperienceLevel): number | null {
  if (runType === "interval") return INTERVAL_REPS[exp];
  if (runType === "threshold") return THRESHOLD_REPS[exp];
  return null;
}

/**
 * Recovery minutes as a fraction of the session's total REP time.
 *
 * The subtlety: N reps have N−1 gaps, not N. At 1:1 with 4 reps the recovery is
 * three rep-lengths against four of work — 0.75 of the work time, not 1.0. Getting
 * this wrong overstates an interval session by a full rep.
 */
export function recoveryFactor(runType: RunType, exp: ExperienceLevel): number {
  const ratio = REST_RATIO[runType];
  const reps = repCount(runType, exp);
  if (ratio === undefined || reps === null || reps < 2) return 0;
  return (ratio * (reps - 1)) / reps;
}

/**
 * Between-rep recovery minutes for a session whose reps total `workMinutes`.
 * This is easy running, so it is aerobic time and aerobic distance — it belongs in
 * the athlete's cardio minutes and mileage, just never in the WORK target.
 */
export function recoveryMinutes(runType: RunType, exp: ExperienceLevel, workMinutes: number): number {
  if (workMinutes <= 0) return 0;
  // Floor, not round. Work minutes are already rounded up to a whole minute; letting
  // the recovery round up too let a 90-minute session cap ship 91- and 92-minute
  // sessions off nothing but double rounding.
  return Math.floor(workMinutes * recoveryFactor(runType, exp));
}
