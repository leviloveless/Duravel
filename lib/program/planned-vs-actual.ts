/**
 * PLANNED VS ACTUAL FOR A LINKED SESSION (Levi, 2026-08-25).
 *
 * "When I sync a workout to a planned workout, it needs to display the planned
 * distance and time and the actual distance and time and other data. The actual
 * data being the data that comes from the syncing source."
 *
 * The data was already there and only the display was missing:
 * `linkActivityToSession` has written `actuals` (distance, duration, average HR)
 * onto the workout log since sync-linking shipped, but the week table showed only
 * a "Synced" chip — the athlete could see THAT a workout was attached, never what
 * it said. The numbers were a click deep in a modal that showed them as a single
 * formatted string with nothing to compare against.
 *
 * Two rules this encodes, both of them Levi's calls:
 *
 *  - **The planned figures stay the headline.** The comparison sits beside the
 *    prescription; it does not replace it. A week card that swapped in actuals
 *    once a session was linked would leave the week's planned totals disagreeing
 *    with its own rows — the work-vs-total shape that has bitten this repo seven
 *    times.
 *  - **Planned distance is TOTAL on feet** (`sessionMiles`) and planned time is
 *    the TOTAL session (`sessionTiming().total`), because that is what a watch
 *    records. Comparing a GPS trace against the main set alone would report every
 *    correctly-run interval session as a 100% overshoot.
 */

import type { Session, WorkoutLog } from "@/lib/schemas";
import { sessionMiles, sessionTiming } from "@/lib/session-volume";

export interface Comparison {
  planned: number;
  actual: number;
  /** actual − planned. */
  delta: number;
}

export interface PlannedVsActual {
  /** Absent for a session with no distance to compare — a lift, or a cardio block. */
  distance?: Comparison;
  time?: Comparison;
  /** Average HR the source recorded. No planned counterpart: the prescription is
   *  a per-rep ramp, not one number (see `lib/engine/hr-targets.ts`). */
  avgHr?: number;
}

/** Does this session carry a distance worth comparing a GPS trace against? */
function hasDistance(session: Session): boolean {
  return session.kind === "run" || session.kind === "hybrid";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The comparison for one session, or `null` when there is nothing to show —
 * no log, no actuals on it, or a skipped session (where "actual 0" would be
 * noise on a row that already says skipped).
 */
export function plannedVsActual(session: Session, log: WorkoutLog | null): PlannedVsActual | null {
  if (!log || log.status === "skipped") return null;
  const a = log.actuals;
  if (!a) return null;
  const out: PlannedVsActual = {};

  if (typeof a.distanceMiles === "number" && hasDistance(session)) {
    const planned = round1(sessionMiles(session));
    const actual = round1(a.distanceMiles);
    out.distance = { planned, actual, delta: round1(actual - planned) };
  }
  if (typeof a.durationMin === "number") {
    const planned = sessionTiming(session).total;
    const actual = Math.round(a.durationMin);
    out.time = { planned, actual, delta: actual - planned };
  }
  if (typeof a.avgHr === "number") out.avgHr = Math.round(a.avgHr);

  return out.distance || out.time || out.avgHr !== undefined ? out : null;
}

/** "+0.3" / "−4" / "on plan" — the signed difference, or nothing when it lands. */
export function deltaLabel(c: Comparison, unit: string): string | null {
  if (Math.abs(c.delta) < 0.05) return null;
  const sign = c.delta > 0 ? "+" : "−";
  return `${sign}${Math.abs(c.delta)}${unit}`;
}
