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
 *   - rebound  → hold the volume from the prior increase week
 *   - increase → +7.5% mileage / +10% cardio over the current held level
 *   - deload   → −40% mileage & cardio (the held level is NOT reduced, so the
 *                next rebound resumes from the pre-deload peak)
 *
 * The first week is a rebound that simply holds the starting volume.
 */

import type { MicroWeekType, TrainingClassName } from "./types";
import { DELOAD_FACTOR, INCREASE_CARDIO_FACTOR, INCREASE_MILEAGE_FACTOR } from "./volume";

const PATTERNS: Record<TrainingClassName, MicroWeekType[]> = {
  non_highly_trained: ["rebound", "increase", "deload"],
  highly_trained: ["rebound", "increase", "increase", "deload"],
};

export function microcyclePattern(trainingClass: TrainingClassName): MicroWeekType[] {
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
): MicrocycleSequence {
  const pattern = PATTERNS[trainingClass];
  const labels: MicroWeekType[] = [];
  const mileage: number[] = [];
  const cardioMinutes: number[] = [];
  const heldMileageArr: number[] = [];
  const heldCardioArr: number[] = [];

  let heldMileage = startMileage; // current "increase" (peak-of-cycle) level
  let heldCardio = startCardio;

  for (let i = 0; i < weeks; i++) {
    const label = pattern[i % pattern.length];
    labels.push(label);

    if (label === "increase") {
      heldMileage *= INCREASE_MILEAGE_FACTOR;
      heldCardio *= INCREASE_CARDIO_FACTOR;
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
