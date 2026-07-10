/**
 * Volume & zone-distribution primitives (spec §3, §4b, §4c).
 *
 * The microcycle sequencer (microcycles.ts) drives the week-to-week
 * progression; this module owns the constants it uses plus the
 * per-phase zone-distribution targets and starting-volume lookup.
 */

import type { ExperienceLevel, PhaseName, ZoneDistribution } from "./types";

/**
 * Starting weekly running mileage, anchored to the spec's running
 * experience bands (§2a: <15 / 15–30 / >30 mi per week). We start at a
 * conservative point inside each band so the +7.5% progression has room
 * to climb across a full mesocycle without overreaching early.
 */
export const STARTING_MILEAGE: Record<ExperienceLevel, number> = {
  beginner: 12,
  intermediate: 22,
  advanced: 35,
};

/** Rough average easy-running pace used to seed a starting cardio-minute baseline. */
export const AVG_MIN_PER_MILE = 9;

/**
 * Microcycle volume math (spec §4b, refined).
 *
 * An increase week adds the LESSER of an absolute step or a percentage of the
 * current held volume — so early/low-volume weeks grow by the percentage while
 * higher-volume weeks are capped to a safe absolute bump:
 *   mileage: +min(1.5 miles, 7.5%)   cardio: +min(15 minutes, 10%)
 */
export const INCREASE_MILEAGE_PCT = 0.075; //  +7.5% of current mileage
export const INCREASE_MILEAGE_CAP = 1.5; //    …but no more than +1.5 miles/week
export const INCREASE_CARDIO_PCT = 0.1; //     +10% of current cardio minutes
export const INCREASE_CARDIO_CAP = 15; //      …but no more than +15 minutes/week
export const DELOAD_FACTOR = 0.6; //           −40% mileage & cardio on a deload week

// Kept for backward-compatible imports; the capped rule above is authoritative.
export const INCREASE_MILEAGE_FACTOR = 1.075;
export const INCREASE_CARDIO_FACTOR = 1.1;

/** Increase step = min(absolute cap, percentage of current). */
export function increaseStep(current: number, pct: number, cap: number): number {
  return Math.min(cap, current * pct);
}

/**
 * Peak phase carries lower total volume at higher intensity (spec §4c).
 * Applied as a mild multiplier over the ongoing microcycle progression so
 * peak weeks sit below the build-phase highs while intensity (zone mix)
 * shifts upward.
 */
export const PEAK_VOLUME_FACTOR = 0.9;

/**
 * Taper volume reductions, working backward from a race (spec §6, refined per
 * the A/B/C race taper philosophy).
 *   A race: two taper weeks — ~80% of peak, then ~60% on race week (i.e. volume
 *           lands in the 50–70% range by the final days). Interval intensity /
 *           pacing stays at race-day targets; only reps/duration drop. Heavy
 *           lifting is cut in the race week and short openers are added.
 *   B race: the race week is cut ~40% (a mini-taper that keeps training rhythm;
 *           hard efforts stay in, reps/time at high zones drop). The following
 *           week opens with a full rest day, then two easy days.
 *   C race: NO formal taper — train right through and treat the race itself as a
 *           high-quality hard workout. Volume is unchanged (factor 1.0).
 */
export const A_TAPER_WEEK1_FACTOR = 0.8; //     first A-race taper week ≈ 80% of peak
export const A_TAPER_RACEWEEK_FACTOR = 0.6; //  A-race week ≈ 60% of peak (within 50–70%)
export const B_TAPER_FACTOR = 0.6; //           −40% single B-race taper week
export const C_TAPER_FACTOR = 1.0; //           train through — no volume reduction

/**
 * Per-phase target zone distribution (percentages, sum to 100). Base is
 * easy-dominant; intensity migrates up through Build and Peak; Taper holds
 * intensity while volume drops. Averaged across a full program these land
 * near the spec's overall 20/60/10/5/5 target (§3).
 */
export const PHASE_ZONE_TARGETS: Record<PhaseName, ZoneDistribution> = {
  base: { z1: 25, z2: 60, z3: 8, z4: 4, z5: 3 },
  build: { z1: 20, z2: 58, z3: 12, z4: 6, z5: 4 },
  peak: { z1: 15, z2: 52, z3: 15, z4: 10, z5: 8 },
  taper: { z1: 18, z2: 57, z3: 13, z4: 7, z5: 5 },
};

export function startingMileage(exp: ExperienceLevel): number {
  return STARTING_MILEAGE[exp];
}

export function startingCardioMinutes(mileage: number): number {
  return Math.round(mileage * AVG_MIN_PER_MILE);
}
