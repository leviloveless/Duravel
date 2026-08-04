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

/** 1 km expressed in miles. Local so this module stays dependency-free. */
const KM_IN_MILES = 0.621371;

/**
 * WORK distance of a single rep, in miles: interval reps are 1 km, threshold reps
 * 1 mile. Undefined for run types that aren't rep-based.
 */
export const REP_DISTANCE_MILES: Partial<Record<RunType, number>> = {
  interval: KM_IN_MILES,
  threshold: 1,
};

/**
 * The rep count a quality run ACTUALLY carries, derived from its work distance.
 *
 * BUG FIX (Levi 2026-08-04): `INTERVAL_REPS` / `THRESHOLD_REPS` are fixed per
 * experience level, but `reconcile.ts` resizes every run's `distanceMiles` up or
 * down to make the week hit its mileage target. Nothing reconciled the two, so
 * the workout TEXT kept prescribing "3 × 1 mile" while the stored work distance
 * was 1.8 — and the headline, the description and the weekly total all disagreed.
 * Across 87 audited interval/threshold runs, 100% mismatched, the worst by 3.7
 * miles (a headline reading 0 mi against a text prescribing 6 × 1 km).
 *
 * Distance is the thing the athlete's week is actually constrained by, so
 * distance wins and the rep count follows it. The experience tables survive as
 * the STARTING structure the skeleton is built from, and as the fallback when a
 * run has no distance yet.
 *
 * Returns null for run types that aren't rep-based.
 */
export function repsForWorkMiles(
  runType: RunType,
  workMiles: number,
  exp: ExperienceLevel,
): number | null {
  const repMiles = REP_DISTANCE_MILES[runType];
  if (repMiles === undefined) return null;
  if (!(workMiles > 0)) return repCount(runType, exp); // no distance yet — keep the default
  return Math.max(1, Math.round(workMiles / repMiles));
}

/**
 * Work miles snapped to a WHOLE number of reps, so the prescription text and the
 * stored distance describe the same workout. Non-rep run types pass through.
 */
export function snapWorkMiles(runType: RunType, workMiles: number, exp: ExperienceLevel): number {
  const repMiles = REP_DISTANCE_MILES[runType];
  if (repMiles === undefined || !(workMiles > 0)) return workMiles;
  const reps = repsForWorkMiles(runType, workMiles, exp) ?? 1;
  return Math.round(reps * repMiles * 10) / 10;
}

/**
 * Recovery minutes as a fraction of the session's total REP time.
 *
 * The subtlety: N reps have N−1 gaps, not N. At 1:1 with 4 reps the recovery is
 * three rep-lengths against four of work — 0.75 of the work time, not 1.0. Getting
 * this wrong overstates an interval session by a full rep.
 */
export function recoveryFactor(runType: RunType, exp: ExperienceLevel): number {
  return recoveryFactorForReps(runType, repCount(runType, exp) ?? 0);
}

/** The same factor for a rep count already derived from the run's real distance. */
export function recoveryFactorForReps(runType: RunType, reps: number): number {
  const ratio = REST_RATIO[runType];
  if (ratio === undefined || reps < 2) return 0;
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

/**
 * Between-rep recovery for a session whose ACTUAL rep count is known (derived
 * from its work distance rather than assumed from experience). This is what the
 * reconciler uses once a run has been resized, so the recovery jog the athlete is
 * told to run is the recovery jog counted in the week's mileage.
 */
export function recoveryMinutesForReps(
  runType: RunType,
  reps: number,
  workMinutes: number,
): number {
  if (workMinutes <= 0) return 0;
  return Math.floor(workMinutes * recoveryFactorForReps(runType, reps));
}
