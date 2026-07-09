/**
 * Mesocycle allocation (spec §4a).
 *
 * Programs run four sequential mesocycles: Base → Build → Peak → Taper.
 * Base is always the largest. Allocations scale from 20-week reference
 * anchors (both summing cleanly to 20 with a 2-week A-race taper):
 *
 *   Non-highly-trained: Base 9 / Build 6 / Peak 3 / Taper 2   (3-week micro)
 *   Highly-trained:     Base 8 / Build 6 / Peak 4 / Taper 2   (4-week micro)
 *
 * For other durations we scale the non-taper portion proportionally and let
 * Base absorb the remainder (keeping it largest). The taper is protected:
 * its length comes from the highest-priority race's protocol (§6), not from
 * scaling. General-fitness programs omit the taper entirely.
 */

import type { EngineInput, EngineRace, MesocycleAllocation, PhaseName, RacePriorityName, TrainingClassName } from "./types";

/** 20-week reference anchors (A race, taper = 2). Non-taper portion sums to 18. */
const ANCHORS: Record<TrainingClassName, MesocycleAllocation> = {
  non_highly_trained: { base: 9, build: 6, peak: 3, taper: 2 },
  highly_trained: { base: 8, build: 6, peak: 4, taper: 2 },
};

const PRIORITY_RANK: Record<RacePriorityName, number> = { A: 3, B: 2, C: 1 };

/** Taper mesocycle length by race priority (spec §6). */
export function taperWeeksForPriority(priority: RacePriorityName | null): number {
  switch (priority) {
    case "A":
      return 2; // 2-week taper
    case "B":
      return 1; // 1-week deload-equivalent
    case "C":
      return 1; // 3–4 days, labeled as a single taper week
    default:
      return 0;
  }
}

/** Highest-priority race in the program (A > B > C), or null if none. */
export function topPriority(races: EngineRace[]): RacePriorityName | null {
  if (races.length === 0) return null;
  return races.reduce<RacePriorityName>(
    (best, r) => (PRIORITY_RANK[r.priority] > PRIORITY_RANK[best] ? r.priority : best),
    races[0].priority,
  );
}

/**
 * Allocate the four mesocycles for a program. Guarantees:
 *   - base + build + peak + taper === durationWeeks
 *   - base is the largest phase whenever the program is long enough to have one
 *   - taper length is protected (driven by race priority; 0 for general fitness)
 */
export function allocateMesocycles(input: EngineInput): MesocycleAllocation {
  const anchor = ANCHORS[input.trainingClass];
  const D = input.durationWeeks;

  let taper: number;
  if (input.programType === "general_fitness" || input.races.length === 0) {
    taper = 0;
  } else {
    taper = taperWeeksForPriority(topPriority(input.races));
  }
  // Never let the taper starve the rest of the program: leave ≥1 working week.
  taper = Math.min(taper, Math.max(0, D - 1));

  const working = D - taper;
  const { base, build, peak } = distributeWorking(anchor, working);

  return { base, build, peak, taper };
}

/**
 * Split the non-taper "working" weeks across Base/Build/Peak.
 * For >3 working weeks: proportional to the anchor's non-taper split, with
 * Base taking the remainder. For ≤3: fill Base → Build → Peak one at a time.
 */
function distributeWorking(
  anchor: MesocycleAllocation,
  working: number,
): { base: number; build: number; peak: number } {
  if (working <= 0) return { base: 0, build: 0, peak: 0 };
  if (working === 1) return { base: 1, build: 0, peak: 0 };
  if (working === 2) return { base: 1, build: 1, peak: 0 };
  if (working === 3) return { base: 1, build: 1, peak: 1 };

  const anchorWorking = anchor.base + anchor.build + anchor.peak; // 18
  let peak = Math.max(1, Math.round((anchor.peak / anchorWorking) * working));
  let build = Math.max(1, Math.round((anchor.build / anchorWorking) * working));
  let base = working - peak - build;

  // Guard against rounding overshoot leaving Base too small / not largest.
  while (base < build || base < peak) {
    if (peak >= build && peak > 1) peak -= 1;
    else if (build > 1) build -= 1;
    else break;
    base = working - peak - build;
  }

  return { base, build, peak };
}

/**
 * Expand an allocation into a per-week phase array of length durationWeeks,
 * in order: Base…, Build…, Peak…, Taper…
 */
export function expandPhases(alloc: MesocycleAllocation, durationWeeks: number): PhaseName[] {
  const phases: PhaseName[] = [];
  const push = (phase: PhaseName, n: number) => {
    for (let i = 0; i < n; i++) phases.push(phase);
  };
  push("base", alloc.base);
  push("build", alloc.build);
  push("peak", alloc.peak);
  push("taper", alloc.taper);
  // Safety: pad/truncate to exactly durationWeeks (allocation should already match).
  while (phases.length < durationWeeks) phases.push("taper");
  return phases.slice(0, durationWeeks);
}
