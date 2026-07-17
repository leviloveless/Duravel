/**
 * Single source of truth for how a session's cardio TIME and running MILEAGE
 * are measured. Both the display layer (components/program/format.ts) and the
 * deterministic volume reconciler (lib/generation/reconcile.ts) import from
 * here, so "what the week sums to" is computed the same way everywhere.
 *
 * Weightlifting is excluded from cardio time (spec). Running mileage counts
 * every run's distance plus the runs inside hybrid sessions.
 */

import type { Session } from "@/lib/schemas";
import { clamp, METERS_PER_MILE } from "@/lib/engine/math";
export { METERS_PER_MILE };

type RunSession = Extract<Session, { kind: "run" }>;
type HybridSession = Extract<Session, { kind: "hybrid" }>;

/** Warmup/cooldown minutes by run type (quality runs need a longer warmup). */
export const RUN_WARMUP_COOLDOWN: Record<RunSession["runType"], [number, number]> = {
  easy: [5, 5],
  long: [5, 5],
  fartlek: [8, 5],
  progression: [10, 5],
  tempo: [12, 8],
  threshold: [12, 8],
  interval: [15, 10],
  hybrid_run: [8, 5],
};

/** Hybrid work-time bounds (spec addition: 25–60 min of work). */
export const HYBRID_MIN_WORK = 25;
export const HYBRID_MAX_WORK = 60;

const DEFAULT_HYBRID_RUN_MILES = 1000 / METERS_PER_MILE; // 1000 m per hybrid run

/** Parse a distance ("1000m", "1 km", "0.6 mi") to miles, or null. */
export function parseDistanceMiles(text: string): number | null {
  const t = text.toLowerCase();
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:miles|mile|mi)\b/);
  if (m) return parseFloat(m[1]!); // safe: group 1 is present whenever the match succeeds
  m = t.match(/(\d+(?:\.\d+)?)\s*km\b/);
  if (m) return parseFloat(m[1]!) * 0.621371; // safe: group 1 is present whenever the match succeeds
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:meters|metres|meter|metre|m)\b/);
  if (m) return parseFloat(m[1]!) / METERS_PER_MILE; // safe: group 1 is present whenever the match succeeds
  return null;
}

/** Running miles contained in a hybrid session's run elements. */
export function hybridRunMiles(hybrid: HybridSession): number {
  let miles = 0;
  for (const el of hybrid.elements) {
    const isRun = /run/i.test(el.exercise) || /run/i.test(el.prescription);
    if (!isRun) continue;
    miles += parseDistanceMiles(el.prescription) ?? DEFAULT_HYBRID_RUN_MILES;
  }
  return miles;
}

export interface SessionTiming {
  warmup: number;
  work: number;
  cooldown: number;
  total: number;
}

/**
 * Estimated session length, split into warmup / work / cooldown / total.
 * Deterministic (no AI). A race session returns zeros (event day).
 */
export function sessionTiming(session: Session): SessionTiming {
  if (session.kind === "run") {
    const [warmup, cooldown] = RUN_WARMUP_COOLDOWN[session.runType];
    const work = Math.max(1, Math.round(session.durationMin));
    return { warmup, work, cooldown, total: warmup + work + cooldown };
  }
  if (session.kind === "lift") {
    const sets = session.movements.reduce((n, m) => n + m.sets, 0);
    const work = sets > 0 ? Math.round(sets * 2.5) : 40;
    return { warmup: 10, work, cooldown: 5, total: 10 + work + 5 };
  }
  if (session.kind === "hybrid") {
    const work = clamp(Math.round(session.elements.length * 5), HYBRID_MIN_WORK, HYBRID_MAX_WORK);
    return { warmup: 10, work, cooldown: 5, total: 10 + work + 5 };
  }
  if (session.kind === "cardio") {
    // The block IS the cardio work; its duration is the whole session.
    const work = Math.max(1, Math.round(session.durationMin));
    return { warmup: 0, work, cooldown: 0, total: work };
  }
  if (session.kind === "swim" || session.kind === "bike") {
    // Triathlon endurance session: the prescribed duration IS the work.
    const work = Math.max(1, Math.round(session.durationMin));
    return { warmup: 0, work, cooldown: 0, total: work };
  }
  if (session.kind === "brick") {
    // Bike→run in one session: total is the sum of the segment durations.
    const work = Math.max(1, Math.round(session.segments.reduce((a, s) => a + s.durationMin, 0)));
    return { warmup: 0, work, cooldown: 0, total: work };
  }
  return { warmup: 0, work: 0, cooldown: 0, total: 0 };
}

/** Running miles in a single session (run distance, or hybrid run distances). */
export function sessionMiles(session: Session): number {
  if (session.kind === "run") return session.distanceMiles;
  if (session.kind === "hybrid") return hybridRunMiles(session);
  return 0;
}

/** Warmup + cooldown minutes for a run type (fixed overhead not counted as work). */
export function runOverhead(runType: RunSession["runType"]): number {
  const [w, c] = RUN_WARMUP_COOLDOWN[runType];
  return w + c;
}

/** Total weekly cardio minutes = run + hybrid session totals (weightlifting excluded). */
export function weekCardioMinutes(week: { days: { sessions: Session[] }[] }): number {
  let total = 0;
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (
        s.kind === "run" ||
        s.kind === "hybrid" ||
        s.kind === "cardio" ||
        s.kind === "swim" ||
        s.kind === "bike" ||
        s.kind === "brick"
      )
        total += sessionTiming(s).total;
    }
  }
  return total;
}

/** Total weekly running mileage = every run's distance + hybrid run distances. */
export function weekMileage(week: { days: { sessions: Session[] }[] }): number {
  let miles = 0;
  for (const day of week.days) {
    for (const s of day.sessions) miles += sessionMiles(s);
  }
  return Math.round(miles * 10) / 10;
}
