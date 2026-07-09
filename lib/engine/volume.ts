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

/** Microcycle volume math (spec §4b). */
export const INCREASE_MILEAGE_FACTOR = 1.075; // +7.5% mileage on an increase week
export const INCREASE_CARDIO_FACTOR = 1.1; //   +10% total cardio on an increase week
export const DELOAD_FACTOR = 0.6; //            −40% mileage & cardio on a deload week

/**
 * Peak phase carries lower total volume at higher intensity (spec §4c).
 * Applied as a mild multiplier over the ongoing microcycle progression so
 * peak weeks sit below the build-phase highs while intensity (zone mix)
 * shifts upward.
 */
export const PEAK_VOLUME_FACTOR = 0.9;

/** Taper volume reductions, working backward from a race (spec §6). */
export const A_TAPER_WEEK_FACTOR = 0.7; // −30% each of the two A-race taper weeks
export const B_TAPER_FACTOR = 0.6; //     −40% single B-race taper week
export const C_TAPER_FACTOR = 0.8; //     −40% over the final 3–4 days ≈ −20% across the week

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
