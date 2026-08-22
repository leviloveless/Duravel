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

/**
 * Minutes of weekly cardio TIME seeded per mile of running when the athlete
 * doesn't override "starting weekly cardio."
 *
 * This is total cardio time per running mile, not a run pace: it must exceed the
 * time it actually takes to run a mile at easy pace (162% of 5K pace ≈ 12–15
 * min/mi for most athletes) so there's headroom for the non-running Zone 1–2
 * cross-training block the reconciler adds. 18 leaves a healthy cross-training
 * margin for typical/faster athletes; very slow runners may see little or no
 * non-running block (the reconciler handles that gracefully), and any athlete
 * can override this in onboarding.
 */
export const AVG_MIN_PER_MILE = 18;

/**
 * Microcycle volume math (spec §4b, refined per Tasks #5/#6).
 *
 * On an increase week:
 *   - mileage grows by the GREATER of +1.5 miles or +7.5% of the prior week
 *     (Tasks #5). So a small-mileage runner always gets at least +1.5 mi, while
 *     a higher-mileage runner scales up at 7.5%.
 *       e.g. 10 mi → +max(1.5, 0.75) = +1.5 → 11.5 mi
 *            25 mi → +max(1.5, 1.875) = +1.875 → 26.875 mi
 *   - cardio grows by the GREATER of +20 minutes or +10% of the prior week
 *     (Tasks #6).
 *       e.g. 100 min → +max(20, 10) = +20 → 120 min
 *            250 min → +max(20, 25) = +25 → 275 min
 */
export const INCREASE_MILEAGE_PCT = 0.075; //      +7.5% of current mileage…
export const INCREASE_MILEAGE_MIN_STEP = 1.5; //   …but at least +1.5 miles/week
export const INCREASE_CARDIO_PCT = 0.1; //         +10% of current cardio minutes…
export const INCREASE_CARDIO_MIN_STEP = 20; //     …but at least +20 minutes/week
export const DELOAD_FACTOR = 0.6; //               deload week = 60% of the prior week (−40%)
/**
 * Ceiling on the RELATIVE weekly mileage increase (Review #5). The +1.5 mi
 * absolute floor made low-mileage beginners jump disproportionately (12 → 13.5 =
 * +12.5%), i.e. the athletes least able to absorb load ramped FASTER than
 * advanced runners (a flat +7.5%). Capping the relative step at 10% — the
 * classic safe ceiling — removes that inversion while still letting beginners
 * progress a little quicker in absolute terms than a pure-percentage rule.
 */
export const MAX_INCREASE_MILEAGE_REL_PCT = 0.1;

/**
 * Absolute bounds on the weekly mileage step (Levi, 2026-08-19).
 *
 * The rule above is PURELY RELATIVE, and a purely relative rule grows every
 * athlete by the same fraction wherever they start. Measured over a real
 * 16-week goal-event program that came out as **33–48% growth at every starting
 * mileage** — which treats "3 → 4.4 mi" and "45 → 60 mi" as the same amount of
 * progress. They are not.
 *
 *  - **The floor.** Below ~10 mi/week a percentage is not a training decision,
 *    it is a rounding error: 10% of 5 miles is half a mile. A 5 mi/week athlete
 *    took THIRTY-SIX weeks to reach 15, and finished a whole 16-week block
 *    peaking at 7.3 mi. One mile is the smallest step that means anything.
 *  - **The cap.** Above ~40 mi the same percentage keeps growing the absolute
 *    jump (+3.4 mi at 45, +4.5 at 60, +6 at 80) exactly where an athlete's
 *    absorbable step should be flattening out.
 *  - **The ceiling on the floor.** A flat 1-mile floor is 33% of a 3 mi week,
 *    past the >30% progression Nielsen 2014 associated with distance-related
 *    injury in novices. So the floor itself is capped at 20% of current, which
 *    is the highest relative step this function can ever produce.
 *
 * Between 10 and 40 mi — where most athletes are — the step is BYTE-IDENTICAL to
 * the old rule. That is deliberate: this changes the two ends that were wrong
 * and nothing else.
 */
export const MIN_INCREASE_MILEAGE_STEP = 1.0;
export const MAX_INCREASE_MILEAGE_STEP = 3.0;
/** Ceiling on the step as a share of current mileage, so the absolute FLOOR
 *  cannot become a reckless relative jump at a very low starting volume. */
export const MAX_INCREASE_MILEAGE_FLOOR_REL_PCT = 0.2;

/**
 * Masters age threshold (Review #10). At/above this age recovery slows, so the
 * program uses a more frequent deload (a 3-week 2:1 microcycle) regardless of
 * training class. Tunable.
 */
export const MASTERS_AGE = 50;

// Kept for backward-compatible imports; the rules above are authoritative.
export const INCREASE_MILEAGE_FACTOR = 1.075;
export const INCREASE_CARDIO_FACTOR = 1.1;

/**
 * Mileage increase step, in miles, for one increase week.
 *
 * Three layers, applied in this order:
 *   1. `max(absolute floor, percentage of current)`, capped at
 *      `MAX_INCREASE_MILEAGE_REL_PCT` of current (Tasks #5; the relative cap
 *      came from Review #5, to remove a ramp-rate inversion where low-mileage
 *      beginners progressed FASTER in percentage terms than advanced runners);
 *   2. absolute bounds at both ends — see `MIN_INCREASE_MILEAGE_STEP` /
 *      `MAX_INCREASE_MILEAGE_STEP` for why a purely relative rule is wrong at
 *      the ends;
 *   3. a ceiling of `MAX_INCREASE_MILEAGE_FLOOR_REL_PCT` so the absolute floor
 *      cannot turn into a >20% jump at a tiny starting volume.
 *
 * Worked: 3 → +0.6 · 5 → +1.0 · 8 → +1.0 · 12 → +1.2 · 20 → +1.5 · 30 → +2.25 ·
 * 40 → +3.0 · 45 → +3.0 · 60 → +3.0. Everything from 10 to 40 is what it always
 * was.
 */
export function increaseStep(current: number, pct: number, minStep: number): number {
  const relative = Math.min(
    Math.max(minStep, current * pct),
    current * MAX_INCREASE_MILEAGE_REL_PCT,
  );
  const bounded = Math.min(
    Math.max(relative, MIN_INCREASE_MILEAGE_STEP),
    MAX_INCREASE_MILEAGE_STEP,
  );
  return Math.min(bounded, current * MAX_INCREASE_MILEAGE_FLOOR_REL_PCT);
}

/** Cardio increase step = max(absolute floor, percentage of current) (Tasks #6). */
export function increaseCardioStep(current: number): number {
  return Math.max(INCREASE_CARDIO_MIN_STEP, current * INCREASE_CARDIO_PCT);
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
