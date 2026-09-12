/**
 * Which authored week is in force on a given program week.
 *
 * Lifted out of `skeleton.ts` on 2026-09-11 so the TRIATHLON skeleton could ask
 * the same question. It cannot import `skeleton.ts` — `skeleton.ts` imports
 * `buildTriathlonSkeleton`, so the dependency already runs the other way and
 * reaching back would close the loop.
 *
 * PURE. No I/O, no framework, no dates.
 */

import type { EngineInput, WeekTemplate } from "./types";

/**
 * The template in force for `weekNumber` — the latest change that has taken
 * effect, falling back to the program's original week.
 *
 * `weekTemplateChanges` is kept as a HISTORY rather than overwriting
 * `weekTemplate`, because the weeks already generated under the old shape are
 * still the athlete's training log and must keep reading the way they were run.
 */
export function templateForWeek(input: EngineInput, weekNumber: number): WeekTemplate | undefined {
  let best = input.weekTemplate;
  let bestFrom = 0;
  for (const change of input.weekTemplateChanges ?? []) {
    if (change.fromWeek <= weekNumber && change.fromWeek >= bestFrom) {
      best = change.template;
      bestFrom = change.fromWeek;
    }
  }
  return best;
}
