import type { ProgramDay, Session } from "@/lib/schemas";
import type { WeekSkeleton } from "@/lib/engine/types";
import {
  METERS_PER_MILE,
  hybridRunMiles,
  sessionWorkMiles,
  weekMileage,
} from "@/lib/session-volume";

/**
 * The hard-running ceiling for hybrid weeks (Levi, 2026-09-28). PURE.
 *
 * THE PROBLEM, MEASURED. Across 2,160 weeks of hybrid plans (the three bands
 * under 20 h/week × experience × training days × starting mileage), 29.3% of
 * running miles were at threshold or harder on average, half of all weeks were
 * over 30%, and the 14–30 mi range sat at 36–38%. Two sources: every hybrid runs
 * its legs at race pace (full 1 km each, Levi 2026-08-12), and since 2026-08-23
 * a week of 14 mi or more also keeps its own threshold run. At these volumes the
 * two together are a third of the week, and it is the easy aerobic running that
 * gets squeezed.
 *
 * THE RULE. In a week that holds a regular hybrid, hard running may be at most
 * `HARD_RUNNING_SHARE_CAP` of the week's miles. When a week is over:
 *   1. the week's threshold / tempo runs become easy runs, one at a time, until
 *      it is under — the hybrid already carries race-pace running that week;
 *   2. only if it is STILL over, the hybrid's run legs are shortened, never
 *      below `hybridRunFloor` (500 m, or the race's own leg if shorter).
 * Intervals are left alone (the VO2 stimulus is the one a hybrid does not give),
 * and a week with the peak race SIMULATION is exempt — it is the race.
 * Levi chose 25% and this order on 2026-09-28 from the modelled trade-offs.
 *
 * WHAT COUNTS AS HARD: the work miles of threshold, tempo and interval runs,
 * plus every hybrid's run legs (run at race pace). Warm-ups, cool-downs and the
 * hybrid's jogs are easy running. The share is of the week's TOTAL miles — what
 * the athlete actually runs.
 */

export const HARD_RUNNING_SHARE_CAP = 0.25;

const HARD_RUN_TYPES = new Set(["threshold", "tempo", "interval"]);
/** Run types that give way first when a week is over the cap. */
const CONVERTIBLE_RUN_TYPES = new Set(["threshold", "tempo"]);

function allSessions(days: readonly ProgramDay[]): Session[] {
  return days.flatMap((d) => d.sessions);
}

export function weekHardMiles(days: readonly ProgramDay[]): number {
  let hard = 0;
  for (const s of allSessions(days)) {
    if (s.kind === "run" && HARD_RUN_TYPES.has(s.runType)) hard += sessionWorkMiles(s);
    if (s.kind === "hybrid") hard += hybridRunMiles(s);
  }
  return hard;
}

export function weekHardShare(days: readonly ProgramDay[]): number {
  const total = weekMileage({ days: days as ProgramDay[] });
  return total > 0 ? weekHardMiles(days) / total : 0;
}

/** The cap applies to a week holding a regular hybrid and no race simulation. */
export function hardCapApplies(days: readonly ProgramDay[]): boolean {
  const hybrids = allSessions(days).filter((s) => s.kind === "hybrid");
  return hybrids.length > 0 && !hybrids.some((s) => s.kind === "hybrid" && s.simulation);
}

/** Over the cap by more than rounding noise. */
export function overHardCap(days: readonly ProgramDay[], cap = HARD_RUNNING_SHARE_CAP): boolean {
  return hardCapApplies(days) && weekHardShare(days) > cap + 0.005;
}

/**
 * The planned week with every HARD run the reconciler dropped removed from it.
 *
 * Needed before any rebuild. The reconciler consolidates a week that cannot pay
 * for all its runs by dropping the most droppable — easy first, quality later
 * (`DROP_RANK`). Turn a surviving threshold run into an easy run and rebuild, and
 * the reconciler now drops THAT instead and resurrects the interval or fartlek it
 * had dropped before: the hard running comes straight back and the long run pays
 * for it. Measured on the first cut of this change — it is how easing a threshold
 * run ended with an interval in its place and shorter hybrid legs on top. Pruning
 * the dropped hard runs means a rebuild can only ever REMOVE hard work.
 */
export function prunedToSurvivors(
  planned: WeekSkeleton,
  built: readonly ProgramDay[],
): WeekSkeleton {
  const next = structuredClone(planned);
  for (const day of next.days) {
    const builtDay = built.find((d) => d.day === day.day);
    const available = (builtDay?.sessions ?? []).filter((s) => s.kind === "run");
    day.sessions = day.sessions.filter((slot) => {
      // Easy runs stay: they are where the freed miles should land. Without them
      // the only sink left is the long run, and a beginner's 12-mile week grew a
      // 7-mile long run out of shortened hybrid legs.
      if (slot.kind !== "run" || slot.isLong || slot.runType === "easy") return true;
      const i = available.findIndex((s) => s.kind === "run" && s.runType === slot.runType);
      if (i === -1) return false;
      available.splice(i, 1);
      return true;
    });
  }
  return next;
}

/**
 * The skeleton with its first remaining threshold / tempo run turned into an
 * easy run, or null when there is none left. Changed in the SKELETON, before
 * assembly, so the reconciler sizes the week around an easy run from the start
 * and every total stays honest.
 */
export function withOneQualityRunEased(skel: WeekSkeleton): WeekSkeleton | null {
  const next = structuredClone(skel);
  for (const day of next.days) {
    for (const slot of day.sessions) {
      if (slot.kind === "run" && CONVERTIBLE_RUN_TYPES.has(slot.runType) && !slot.isLong) {
        slot.runType = "easy";
        slot.goalZone = 2;
        return next;
      }
    }
  }
  return null;
}

/** The run-leg length the week's hybrids currently use, in metres (the longest). */
export function currentLegMeters(days: readonly ProgramDay[]): number | null {
  let longest: number | null = null;
  for (const s of allSessions(days)) {
    if (s.kind !== "hybrid" || s.simulation) continue;
    const legs = s.elements.filter((e) => /run/i.test(e.exercise) || /run/i.test(e.prescription));
    if (legs.length === 0) continue;
    const perLeg = (hybridRunMiles(s) / legs.length) * METERS_PER_MILE;
    longest = longest === null ? perLeg : Math.max(longest, perLeg);
  }
  return longest;
}

/** Hybrid run legs in the week (regular hybrids only). */
export function hybridLegCount(days: readonly ProgramDay[]): number {
  let n = 0;
  for (const s of allSessions(days)) {
    if (s.kind !== "hybrid" || s.simulation) continue;
    n += s.elements.filter((e) => /run/i.test(e.exercise) || /run/i.test(e.prescription)).length;
  }
  return n;
}

/**
 * The leg length that would bring the week under the cap, assuming the miles
 * taken off the legs go to easy running (the reconciler holds the week's total).
 * Rounded down to 50 m, never below `floorMeters`, never above the current leg.
 */
export function legMetersForCap(
  days: readonly ProgramDay[],
  floorMeters: number,
  cap = HARD_RUNNING_SHARE_CAP,
): number | null {
  const current = currentLegMeters(days);
  const legs = hybridLegCount(days);
  if (current === null || legs === 0) return null;
  const total = weekMileage({ days: days as ProgramDay[] });
  const overMiles = weekHardMiles(days) - cap * total;
  if (overMiles <= 0) return current;
  const target = current - (overMiles / legs) * METERS_PER_MILE;
  const rounded = Math.floor(target / 50) * 50;
  return Math.max(floorMeters, Math.min(current, rounded));
}
