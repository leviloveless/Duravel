/**
 * Training-load metrics (Review #5) — split out of adapt.ts (roadmap #2.6).
 *
 * Weekly session-RPE load and the Acute:Chronic Workload Ratio (ACWR) that the
 * load-gated adaptation rules read. Kept separate from the decision logic so the
 * "how loaded is the athlete" question lives in one place.
 */

import type { ProgramWeek, WorkoutLog } from "@/lib/schemas";
import { computeWeekSignals } from "./adapt";
import { ADAPT } from "./adapt-config";
import { round2 } from "./math";

/** Weekly session-RPE load for any program week (Review #5). */
export function weekLoad(week: ProgramWeek, logs: WorkoutLog[]): number {
  return computeWeekSignals(week, logs).weeklyLoad;
}

export interface LoadMetrics {
  /** This week's load (the "acute" 7-day load). */
  acute: number;
  /** Rolling ~4-week average weekly load (the "chronic" 28-day load). */
  chronic: number;
  /** Acute:Chronic Workload Ratio, or null when history is too short to trust. */
  acwr: number | null;
}

/**
 * Acute:Chronic Workload Ratio across weeks (Review #5). Acute = the reviewed
 * week's load; chronic = the rolling mean over the last (up to) 4 weeks. Returns
 * acwr = null until at least ADAPT.ACWR_MIN_WEEKS weeks carry logged load, so a
 * cold start never triggers a load rule.
 */
export function computeLoadMetrics(
  weeks: ProgramWeek[],
  logs: WorkoutLog[],
  throughWeek: number,
): LoadMetrics {
  const byNum = new Map(weeks.map((w) => [w.weekNumber, w]));
  const loadAt = (n: number): number => {
    const w = byNum.get(n);
    return w ? weekLoad(w, logs) : 0;
  };
  const acute = loadAt(throughWeek);
  // Chronic baseline = mean over the window's WEEKS THAT ACTUALLY CARRY LOAD, so
  // unlogged past weeks don't deflate the baseline and inflate the ratio.
  const loaded: number[] = [];
  for (let n = throughWeek - 3; n <= throughWeek; n++) {
    if (!byNum.has(n)) continue;
    const l = loadAt(n);
    if (l > 0) loaded.push(l);
  }
  const chronic = loaded.length ? loaded.reduce((a, b) => a + b, 0) / loaded.length : 0;
  const acwr =
    loaded.length >= ADAPT.ACWR_MIN_WEEKS && chronic > 0 ? round2(acute / chronic) : null;
  return { acute: Math.round(acute), chronic: Math.round(chronic), acwr };
}
