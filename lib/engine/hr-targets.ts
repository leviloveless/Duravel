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
import { formatZoneBpm, zoneBpmRange } from "@/lib/zones";

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

/** How each rep type's HR target should be read. Kept short — a description line. */
const REP_CUE: Partial<Record<RunType, string>> = {
  interval:
    "reach it in the back half of each rep (rep 1 reads low — that is normal, do not chase it with pace)",
  threshold: "settle into the band by the back half of rep 1 and hold it",
};

export interface HrTargetInput {
  runType: RunType;
  /** The session's engine-assigned goal zone (interval 5, threshold 4). */
  goalZone: number;
  /** Resolved HR model — bands as fractions of max HR, plus max HR. */
  model: HrBandSource | null | undefined;
  /** The run's ACTUAL rep count. Below 2 there are no gaps, so no recovery line. */
  reps: number;
  /** True when max HR is an age/sex estimate and nothing better was supplied. */
  estimated?: boolean;
}

function asZone(zone: number): Zone | null {
  return zone === 1 || zone === 2 || zone === 3 || zone === 4 || zone === 5 ? zone : null;
}

/**
 * The HR prescription lines for one quality run — empty for any run type that
 * isn't rep-based, or when no HR model is available.
 */
export function hrTargetLines(input: HrTargetInput): string[] {
  const { runType, goalZone, model, reps, estimated = false } = input;
  if (!REP_RUN_TYPES.includes(runType) || !model) return [];
  const zone = asZone(goalZone);
  if (zone === null) return [];
  const cue = REP_CUE[runType];
  const lines = [
    `${HR_LINE_PREFIX}reps: Zone ${zone}, ${formatZoneBpm(model, zone)}${cue ? ` — ${cue}` : ""}.`,
  ];
  if (reps > 1) {
    const ceiling = zoneBpmRange(model, RECOVERY_CEILING_ZONE).max;
    lines.push(
      `${HR_LINE_PREFIX}recovery jog: let your HR fall below ${ceiling} bpm (top of Zone ${RECOVERY_CEILING_ZONE}) before the next rep starts — if it hasn't, the reps are too fast.`,
    );
  }
  if (estimated) {
    lines.push(
      `${HR_LINE_PREFIX}note: these bpm come from an age-based max-HR estimate — add your resting or threshold HR in settings to sharpen them.`,
    );
  }
  return lines;
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
