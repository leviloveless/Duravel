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
import type { WeeklyHoursBand } from "@/lib/schemas";

/** The engine never prescribes more than two workouts in one day. */
export const MAX_SESSIONS_PER_DAY = 2;

export interface TrainingCaps {
  /** Longest single session, in minutes (warmup + work + cooldown). */
  session: number;
  /** Longest total across every session on one day, in minutes. */
  day: number;
  /**
   * Longest single ZONE 1-2 cardio block, in minutes. Higher than `session`
   * (Levi, 2026-08-04): a low-intensity aerobic block is the one session type
   * whose length is limited by time, not by recovery cost. A five-hour Zone 2
   * ride is a normal week for a 30-hour athlete; a five-hour interval session is
   * not a thing. Runs, lifts and hybrids stay on `session`.
   */
  cardioSession: number;
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

/**
 * Longest single session, in MINUTES, for the high-volume weekly-hours bands
 * (Levi, 2026-08-04). Overrides the experience tier when it is the larger.
 *
 * The experience caps (90 / 105 / 120) were written for athletes training under
 * ~10 hours a week, and they silently became the ceiling on total weekly volume:
 * a week is at most `trainingDays x 2 sessions x sessionCap`, and with 7 days the
 * absolute maximum the caps allowed was 14 x 120 = 1680 min = 28 hours. An
 * athlete who selected 30-40 hours could not be given the program they asked for.
 *
 * A 30-hour-a-week athlete genuinely rides for four hours; capping their longest
 * session at two was the wrong constraint, not a safety one.
 *
 *   10-20 h -> 120 x 14 = 1680 min/week
 *   20-30 h -> 150 x 14 = 2100 min/week
 *   30-40 h -> 180 x 14 = 2520 min/week
 *
 * The lower bands are left on the experience tiers: they already fit with room to
 * spare, and a 5-hour-a-week athlete has no business being handed a 3-hour session.
 */
export const BAND_SESSION_MINUTES: Partial<Record<WeeklyHoursBand, number>> = {
  h10_20: 120,
  h20_30: 150,
  h30_40: 180,
};

/**
 * Longest single ZONE 1-2 CARDIO block, in minutes, by weekly-hours band
 * (Levi, 2026-08-04). Deliberately well above `BAND_SESSION_MINUTES`.
 *
 * Two sessions a day stays an absolute rule — the fix for a high-volume week is
 * LONGER easy aerobic work, not more sessions crammed into a day. Zone 1-2 is the
 * only session type that can absorb that: it is the long ride / long low-impact
 * block that high-volume endurance weeks are actually built from.
 *
 *   5-10 h  -> 2.5 h
 *   10-20 h -> 3 h
 *   20-30 h -> 4 h
 *   30-40 h -> 5 h
 *
 * Below 5 h a week there is nothing to absorb, so those athletes stay on the
 * experience-tier session cap.
 */
export const BAND_CARDIO_SESSION_MINUTES: Partial<Record<WeeklyHoursBand, number>> = {
  h5_10: 150,
  h10_20: 180,
  h20_30: 240,
  h30_40: 300,
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

/**
 * Session + day caps for this athlete on this sport.
 *
 * The DAY cap is always exactly twice the session cap: the engine never
 * prescribes more than two workouts in a day, so a day is two full sessions and
 * nothing more. `weeklyHours` raises the session cap on the high-volume bands
 * (see `BAND_SESSION_MINUTES`) and the day cap follows it.
 */
export function trainingCaps(
  family: SportFamily,
  exp: AthleteExperience,
  band?: WeeklyHoursBand,
): TrainingCaps {
  const level = capExperience(family, exp);
  const banded = (band && BAND_SESSION_MINUTES[band]) || 0;
  const session = Math.max(SESSION_CAP[level], banded);
  const cardioSession = Math.max(session, (band && BAND_CARDIO_SESSION_MINUTES[band]) || 0);
  // Two sessions a day, and the longest possible pair is one of each kind.
  return { session, day: session + cardioSession, cardioSession };
}

/** The caps used when none were supplied — the most conservative tier. */
export const DEFAULT_CAPS: TrainingCaps = {
  session: SESSION_CAP.beginner,
  day: DAY_CAP.beginner,
  cardioSession: SESSION_CAP.beginner,
};
