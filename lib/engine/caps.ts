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
  /**
   * Longest LONG RUN, in minutes (Levi, 2026-08-23).
   *
   * Its own ceiling because the long run is the one session whose right length
   * is a question about the RACE, not about the athlete's weekly hours. A HYROX
   * is eight 1 km legs — nothing in it is served by a two-hour Sunday, and the
   * cost of one is paid in the sessions that do rehearse the race. A triathlon
   * long run is the opposite: the marathon off the bike is won on exactly that
   * durability, and the tri engine's own phase-gated caps (135–150 min for
   * 140.6) are left alone here.
   */
  longRun: number;
}

const SESSION_CAP: Record<ExperienceLevel, number> = {
  beginner: 90,
  intermediate: 105,
  advanced: 120,
};

/**
 * The long run's ceiling for the STATION sports and general fitness
 * (Levi, 2026-08-23: "for hyrox, limit long runs to 90 minutes").
 *
 * Measured before the change, across 1,080 generated weeks: 88 long runs ran
 * past 90 minutes and the longest reached 145 — an athlete training for a
 * ~1-hour race being sent out for two and a half.
 */
export const HYBRID_LONG_RUN_MINUTES = 90;

/**
 * The floor under a TRIATHLON long run's ceiling (Levi, 2026-08-23: "for
 * triathlon programs the long run can extend longer than 2 hours").
 *
 * A floor rather than a cap: the band session cap wins when it is higher. The
 * deterministic triathlon engine sizes its own long runs (`LONG_RUN_CAP` in
 * `lib/engine/ironman`), so this exists to make sure nothing in the shared
 * reconciler ever quietly imposes the 90-minute hybrid ceiling on a triathlete.
 */
export const TRI_LONG_RUN_MINUTES = 150;

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

/**
 * Day-SLOTS a band must keep free for standalone Zone 1-2 blocks (Levi,
 * 2026-09-09: *"as the hours available to train goes up, the max session length
 * needs to increase accordingly so that this does not happen"*).
 *
 * `BAND_CARDIO_SESSION_MINUTES` raised the CEILING on a Zone 1-2 block. It did
 * not give the week anywhere to put one, and that is where the top two bands
 * were losing two thirds of their prescription. Measured on a HYROX `h20_30`
 * advanced build, peak week: 1560 cardio minutes prescribed, 580 delivered. The
 * week held 8 runs + 4 lifts + 1 hybrid = 13 of its 14 slots (7 days x 2, and
 * two-a-day is absolute), so exactly ONE slot was left for the Zone 1-2 work
 * that a 26-hour aerobic week is mostly made of. `h10_20` was the same shape:
 * 13 slots used, 975 prescribed, 502 delivered.
 *
 * The runs got there honestly — `runsForMileage` buys mileage with SESSIONS
 * rather than length, which is the right rule and the one the injury cohort
 * supports. But it is a rule about RUNNING IMPACT, and it was being applied to a
 * week whose remaining volume is deliberately NOT running: `BAND_START_MILEAGE`
 * caps h20_30 at 48 mi against an hours-equivalent of 60 precisely so the
 * surplus lands on the bike / row / ski. The run count was spending the slots
 * that surplus needs.
 *
 * So the slot budget is split before the runs are counted, not after.
 *
 * THE ARITHMETIC, at the h20_30 peak that produced the report:
 *   1560 prescribed - 86 (hybrid) - 580 (runs, whose minutes are fixed by the
 *   mileage target) = ~894 minutes with nowhere to go. At
 *   `BAND_CARDIO_SESSION_MINUTES.h20_30` = 240 that is 3.7 blocks.
 *
 * WHY THREE AND NOT FOUR. The reserve is bounded above by the MILEAGE, not by
 * taste, so it lands one slot short of the minutes. Every run has to stay under
 * the long run (`anchorLongRun`), the long run is pinned at 90 minutes for a
 * station sport (`HYBRID_LONG_RUN_MINUTES`) — about 9.2 miles — and 50 running
 * miles under a 9.2-mile ceiling needs SIX runs. A fourth reserved slot forces
 * five, and the miles that no longer fit are simply not placed: measured, it
 * takes cardio delivery from 74% to 86% and puts three weeks of a 16-week block
 * up to 1.4 mi under their stated mileage. That trade may yet be the right one —
 * Levi's own ruling is that hours win over miles when the two contradict — but
 * it should be made deliberately, and the cheaper half of the gap is not a slot
 * problem at all (see `session-cap.test.ts` on `weekCardioCapacity`).
 *
 * The lower bands get nothing, deliberately: measured, `h0_5` and `h5_10`
 * deliver their prescribed cardio EXACTLY (180/180, 360/360) with 3-5 slots
 * already spare. A reserve there would take sessions off athletes who are not
 * short of anything.
 *
 * `h30_40` has no entry because nothing can reach it: only HYROX and DEKA carry
 * the `bandZone3Z` table this wiring keys off, both are `station_hybrid`, and
 * `MAX_BAND_BY_FAMILY` clamps that family at 20-30 hours. An unmeasured number
 * here would be a guess; the 0 default is exactly today's behaviour.
 */
export const BAND_CARDIO_SLOTS: Partial<Record<WeeklyHoursBand, number>> = {
  h10_20: 3,
  h20_30: 3,
};

/** Day-slots this band keeps clear for Zone 1-2 blocks (0 for the low bands). */
export function bandCardioSlots(band: WeeklyHoursBand): number {
  return BAND_CARDIO_SLOTS[band] ?? 0;
}

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
  const longRun =
    family === "triathlon"
      ? Math.max(session, TRI_LONG_RUN_MINUTES)
      : Math.min(session, HYBRID_LONG_RUN_MINUTES);
  // Two sessions a day, and the longest possible pair is one of each kind.
  return { session, day: session + cardioSession, cardioSession, longRun };
}

/** The caps used when none were supplied — the most conservative tier. */
export const DEFAULT_CAPS: TrainingCaps = {
  session: SESSION_CAP.beginner,
  day: DAY_CAP.beginner,
  cardioSession: SESSION_CAP.beginner,
  longRun: Math.min(SESSION_CAP.beginner, HYBRID_LONG_RUN_MINUTES),
};
