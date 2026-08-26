/**
 * Heart-rate targets for the rep-based quality runs (Levi, 2026-08-25).
 *
 * An interval or threshold session already tells the athlete the pace of each rep
 * and the length of the jog between them. It never told them what their HEART
 * RATE should be doing in either — so the one number every watch shows during the
 * rep had no prescription attached, and the recovery jog had none at all.
 *
 * Two lines close that, and both are deliberately narrow:
 *
 *  - The REP line is a confirmation target, not a pace-setter. HR lags the work
 *    that produces it: on a 3–4 minute rep at I-pace, heart rate is still
 *    climbing through the first half, and rep 1 finishes below the band no matter
 *    how well it was run. Prescribing "be at 176 the whole rep" invites an
 *    athlete to fix rep 1 by running it harder, which is exactly the mistake the
 *    workout is built to prevent. So it reads as "reach it in the back half".
 *
 *  - The RECOVERY line is a CEILING, not a band. The jog's length is already
 *    fixed by the work:rest ratio, so an HR band to "hold" during it would be
 *    fiction — HR is falling the whole time. What is worth knowing is whether it
 *    fell far enough: an athlete still above the top of Zone 2 when the next rep
 *    starts is running the reps too fast, and that is a diagnosis they can act on.
 *
 * The numbers come from the SAME resolved HR model as the zone chips on the
 * program page (`lib/zones.ts` — custom bands → LTHR → HRR → %HRmax), through
 * the same `zoneBpmRange`, so a session's HR line and its Zone chip can never
 * disagree about what Zone 5 means for this athlete.
 *
 * Pure and dependency-light on purpose: generation bakes these lines into the
 * stored description, and the program view rebuilds them from the athlete's LIVE
 * model. `stripHrLines` is what keeps that from becoming two sources of truth —
 * the view drops whatever was baked and re-renders from the current numbers, so
 * updating a resting HR updates every session that was ever generated.
 */

import type { RunType } from "./types";
import type { HrBandSource, Zone } from "@/lib/zones";
import { zoneBpmRange } from "@/lib/zones";

/** The run types that have reps, and therefore a between-rep recovery jog. */
const REP_RUN_TYPES: readonly RunType[] = ["interval", "threshold"];

/**
 * Every HR line starts with this. It is the marker that lets a stored
 * description's baked lines be swapped for freshly-computed ones — see
 * `stripHrLines`. Changing it orphans the lines in already-generated programs
 * (they would render twice), so it is a constant, not a formatting choice.
 */
export const HR_LINE_PREFIX = "HR ";

/**
 * The zone a recovery jog has to fall back into before the next rep. Zone 2's
 * ceiling, not Zone 1's: dropping under ~70% of max between reps mid-session is
 * aspirational for most athletes, and a target nobody hits is a target nobody
 * reads. The top of Zone 2 is the level where failing to reach it means
 * something.
 */
const RECOVERY_CEILING_ZONE: Zone = 2;

/**
 * The shape of the rep-by-rep climb, per run type (Levi, 2026-08-25: "it should
 * provide an estimate peak heart rate during each one k rep").
 *
 * A rep's PEAK heart rate is not the same number every time through. Rep 1 starts
 * from a warmed-up but rested baseline and the rep ends before HR has finished
 * climbing, so it peaks BELOW the band. Every rep after it starts from a higher
 * floor — the jog only clears part of what the rep built — so each peaks a little
 * higher than the last, with the increments shrinking as the athlete approaches
 * their working ceiling. Printing one flat band for all five reps hides that, and
 * an athlete comparing rep 1 against it concludes they under-performed.
 *
 * Both numbers are expressed as fractions of the session zone's OWN span, so the
 * estimate respects whatever anchoring the athlete has (custom bands, LTHR, HRR
 * or %HRmax) instead of contradicting their zone chips:
 *
 *   `startBelow` — how far under the zone floor rep 1 peaks. Larger for intervals,
 *                  whose 3–4 minute reps end while HR is still climbing; smaller
 *                  for a 1-mile threshold rep, which lasts long enough to arrive.
 *   `ceilFrac`   — where the climb flattens out, as a fraction up the band. Well
 *                  below the top: a session whose last rep touches max HR was
 *                  raced, not run, and would not be repeatable next week.
 */
const REP_RAMP: Partial<Record<RunType, { startBelow: number; ceilFrac: number }>> = {
  interval: { startBelow: 0.35, ceilFrac: 0.72 },
  threshold: { startBelow: 0.15, ceilFrac: 0.6 },
};

/** Each rep closes half the remaining gap to the ceiling — fast, then flattening. */
const GAP_CLOSE = 0.5;

/**
 * Estimated PEAK heart rate for each rep, in bpm and in order.
 *
 * Deliberately an estimate and labelled as one. Heart rate on a given day answers
 * to sleep, heat, caffeine and how the strap is sitting as much as to the work;
 * what this models is the SHAPE — low first rep, rising, flattening — which is
 * what an athlete needs in order to read their own trace correctly.
 */
export function repPeakBpm(
  model: HrBandSource,
  zone: Zone,
  runType: RunType,
  reps: number,
): number[] {
  const ramp = REP_RAMP[runType];
  if (!ramp || reps < 1) return [];
  const { min: lo, max: hi } = zoneBpmRange(model, zone);
  const span = hi - lo;
  // Degenerate bands (a hand-entered zone with no width) have no ramp to show.
  if (!(span > 0)) return Array.from({ length: reps }, () => lo);
  const start = lo - ramp.startBelow * span;
  const ceiling = lo + ramp.ceilFrac * span;
  return Array.from({ length: reps }, (_, i) => {
    const peak = ceiling - (ceiling - start) * Math.pow(GAP_CLOSE, i);
    return Math.min(model.maxHR, Math.round(peak));
  });
}

export interface HrTargetInput {
  runType: RunType;
  /** The session's engine-assigned goal zone (interval 5, threshold 4). */
  goalZone: number;
  /** Resolved HR model — bands as fractions of max HR, plus max HR. */
  model: HrBandSource | null | undefined;
  /** The run's ACTUAL rep count. */
  reps: number;
}

function asZone(zone: number): Zone | null {
  return zone === 1 || zone === 2 || zone === 3 || zone === 4 || zone === 5 ? zone : null;
}

/**
 * The HR prescription for one quality run — empty for a run type that isn't
 * rep-based, or when no HR model is available.
 *
 * Two lines, and no more (Levi, 2026-08-25: "we need to simplify the workout
 * description to as simple as possible"). What went, and why none of it is
 * missed: the zone label and its band, which the session's own Zone chip
 * already carries; the full per-rep list, whose middle figures are just
 * interpolation between its two ends; and the coaching sentences, which belong
 * in the program glossary with the rest of the "why".
 *
 * "By the end of rep N" is doing quiet work in that first line. It is where the
 * back-half truth survives the trim: heart rate lags the work that produces it,
 * so a rep's number belongs to its END — and rep 1's lower figure then reads as
 * the expectation it is, rather than as a target the athlete has missed.
 */
export function hrTargetLines(input: HrTargetInput): string[] {
  const { runType, goalZone, model, reps } = input;
  if (!REP_RUN_TYPES.includes(runType) || !model) return [];
  const zone = asZone(goalZone);
  if (zone === null) return [];
  const peaks = repPeakBpm(model, zone, runType, reps);
  if (!peaks.length) return [];
  const first = peaks[0]!;
  const last = peaks[peaks.length - 1]!;
  const span =
    peaks.length > 1
      ? `${first} by the end of rep 1 - ${last} by the end of rep ${peaks.length}`
      : `${first} by the end of the rep`;
  return [
    `${HR_LINE_PREFIX}reps: ${span}`,
    `${HR_LINE_PREFIX}recovery jogs: heart rate should drop below ${zoneBpmRange(model, RECOVERY_CEILING_ZONE).max}`,
  ];
}

/** A description with any baked HR lines removed. Safe on text that has none. */
export function stripHrLines(description: string): string {
  if (!description.includes(HR_LINE_PREFIX)) return description;
  return description
    .split("\n")
    .filter((line) => !line.startsWith(HR_LINE_PREFIX))
    .join("\n");
}

/**
 * A description carrying exactly one set of HR lines: the ones passed in. Any
 * previously baked set is dropped first, so re-running this over a stored
 * description replaces the numbers rather than appending a second copy.
 */
export function withHrLines(description: string, lines: readonly string[]): string {
  const base = stripHrLines(description);
  if (!lines.length) return base;
  return base ? [base, ...lines].join("\n") : lines.join("\n");
}
