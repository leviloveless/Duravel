/**
 * Per-session and per-day training caps, by experience.
 *
 * A single session is capped at 90 / 105 / 120 minutes and a whole day at
 * 3 / 3.5 / 4 hours for beginner / intermediate / advanced. Note the day cap is
 * exactly twice the session cap in every tier: with the engine's 2-workouts-a-day
 * limit it can only bind if a third session ever reaches a day, so it is a guard
 * against that rather than a constraint that fires today.
 *
 * Runs and Zone 1–2 cardio are separate sessions for this purpose. An athlete may
 * choose to run them back to back as one outing, but they are prescribed — and
 * capped — independently.
 *
 * WHICH experience level applies depends on the sport family:
 *   - `station_hybrid` (HYROX, DEKA) → RUNNING experience. Session length here is
 *     a running-durability question; the stations are short by comparison.
 *   - `triathlon` and `general_fitness` → the LOWEST of running / hybrid / lifting.
 *     These spread load across modalities, so the least-trained quality is what
 *     actually limits how long a session can safely run.
 */

import type { ExperienceLevel } from "./types";
import type { SportFamily } from "./sports/types";

export interface TrainingCaps {
  /** Longest single session, in minutes (warmup + work + cooldown). */
  session: number;
  /** Longest total across every session on one day, in minutes. */
  day: number;
}

const SESSION_CAP: Record<ExperienceLevel, number> = {
  beginner: 90,
  intermediate: 105,
  advanced: 120,
};

const DAY_CAP: Record<ExperienceLevel, number> = {
  beginner: 180,
  intermediate: 210,
  advanced: 240,
};

const RANK: Record<ExperienceLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const BY_RANK: readonly ExperienceLevel[] = ["beginner", "intermediate", "advanced"];

export interface AthleteExperience {
  runningExp: ExperienceLevel;
  hybridExp?: ExperienceLevel;
  liftingExp?: ExperienceLevel;
}

/** The experience level the caps key off, per the sport-family rule above. */
export function capExperience(family: SportFamily, exp: AthleteExperience): ExperienceLevel {
  if (family === "station_hybrid") return exp.runningExp;
  const levels = [exp.runningExp, exp.hybridExp, exp.liftingExp].filter(
    (x): x is ExperienceLevel => x !== undefined,
  );
  if (levels.length === 0) return "beginner";
  const lowest = Math.min(...levels.map((l) => RANK[l]));
  return BY_RANK[lowest]!; // safe: lowest is 0..2, BY_RANK has 3 entries
}

/** Session + day caps for this athlete on this sport. */
export function trainingCaps(family: SportFamily, exp: AthleteExperience): TrainingCaps {
  const level = capExperience(family, exp);
  return { session: SESSION_CAP[level], day: DAY_CAP[level] };
}

/** The caps used when none were supplied — the most conservative tier. */
export const DEFAULT_CAPS: TrainingCaps = { session: SESSION_CAP.beginner, day: DAY_CAP.beginner };
