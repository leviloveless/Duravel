/**
 * Microcycle sequencing + volume progression (spec §4b).
 *
 * Microcycles repeat continuously across the non-taper weeks
 * (Base → Build → Peak) until a taper begins:
 *
 *   Non-highly-trained (3-week): rebound, increase, deload
 *   Highly-trained     (4-week): rebound, increase, increase, deload
 *
 * Volume math:
 *   - rebound  → hold the volume from the prior increase week (nearly exactly
 *                the same cardio + mileage — Tasks #3)
 *   - increase → add the greater of (1.5 mi, 7.5%) to mileage (Tasks #5) and the
 *                greater of (20 min, 10%) to cardio (Tasks #6), over the held level
 *   - deload   → 60% of the held level, i.e. −40% mileage & cardio (Tasks #4;
 *                the held level is NOT reduced, so the next rebound resumes from
 *                the pre-deload peak)
 *
 * The first week is a rebound that simply holds the starting volume.
 */

import type { MicroWeekType, TrainingClassName } from "./types";
import {
  DELOAD_FACTOR,
  INCREASE_MILEAGE_MIN_STEP,
  INCREASE_MILEAGE_PCT,
  MASTERS_AGE,
  increaseCardioStep,
  increaseStep,
} from "./volume";
import { round1 } from "./math";

const PATTERNS: Record<TrainingClassName, MicroWeekType[]> = {
  non_highly_trained: ["rebound", "increase", "deload"],
  highly_trained: ["rebound", "increase", "increase", "deload"],
};

export function microcyclePattern(trainingClass: TrainingClassName, age?: number): MicroWeekType[] {
  // Masters athletes recover more slowly → more frequent deloads: use the
  // 3-week (2:1) microcycle regardless of training class (Review #10).
  if (typeof age === "number" && age >= MASTERS_AGE) return PATTERNS.non_highly_trained;
  return PATTERNS[trainingClass];
}

export interface MicrocycleSequence {
  labels: MicroWeekType[];
  mileage: number[];
  cardioMinutes: number[];
  /** The "held" (increase-level) volume at each week — the peak reference a
   *  rebound holds and a taper reduces from, regardless of deload troughs. */
  heldMileage: number[];
  heldCardio: number[];
}

/**
 * Produce the microcycle labels + weekly mileage / cardio-minute targets for
 * `weeks` consecutive non-taper weeks.
 */
export function sequenceMicrocycles(
  weeks: number,
  trainingClass: TrainingClassName,
  startMileage: number,
  startCardio: number,
  age?: number,
): MicrocycleSequence {
  const pattern = microcyclePattern(trainingClass, age);
  const labels: MicroWeekType[] = [];
  const mileage: number[] = [];
  const cardioMinutes: number[] = [];
  const heldMileageArr: number[] = [];
  const heldCardioArr: number[] = [];

  let heldMileage = startMileage; // current "increase" (peak-of-cycle) level
  let heldCardio = startCardio;

  for (let i = 0; i < weeks; i++) {
    const label = pattern[i % pattern.length]!; // safe: microcyclePattern always returns a non-empty array
    labels.push(label);

    if (label === "increase") {
      heldMileage += increaseStep(heldMileage, INCREASE_MILEAGE_PCT, INCREASE_MILEAGE_MIN_STEP);
      heldCardio += increaseCardioStep(heldCardio);
      mileage.push(round1(heldMileage));
      cardioMinutes.push(Math.round(heldCardio));
    } else if (label === "deload") {
      mileage.push(round1(heldMileage * DELOAD_FACTOR));
      cardioMinutes.push(Math.round(heldCardio * DELOAD_FACTOR));
    } else {
      // rebound: hold the current level
      mileage.push(round1(heldMileage));
      cardioMinutes.push(Math.round(heldCardio));
    }

    heldMileageArr.push(round1(heldMileage));
    heldCardioArr.push(Math.round(heldCardio));
  }

  return {
    labels,
    mileage,
    cardioMinutes,
    heldMileage: heldMileageArr,
    heldCardio: heldCardioArr,
  };
}
