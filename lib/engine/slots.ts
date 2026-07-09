/**
 * Session-slot assignment (spec §5).
 *
 * For each week the engine decides WHICH sessions happen and their intensity
 * (run type + goal zone, lift split, hybrid), then maps them onto the user's
 * training days. The AI later fills the concrete content (paces, exercises,
 * sets × reps). The engine never invents volume the periodization didn't call
 * for — it only distributes the prescribed sessions.
 *
 * Fixed rules:
 *   - 3 lifts / week (upper, lower, full) during Base/Build/Peak
 *   - Runs 3–8 / week, scaled by phase and running experience
 *   - Hybrid frequency ramps Base → Peak (earlier if hybrid-inexperienced)
 *   - Taper weeks trim volume; a race week is a shakeout + the race itself
 */

import type {
  DaySlot,
  ExperienceLevel,
  MicroWeekType,
  PhaseName,
  RacePriorityName,
  RunSlot,
  RunType,
  SessionSlot,
  TrainingDayName,
} from "./types";

const GOAL_ZONE: Record<RunType, number> = {
  easy: 2,
  fartlek: 2,
  long: 2,
  tempo: 3,
  threshold: 4,
  interval: 5,
  hybrid_run: 4,
};

const EXP_INDEX: Record<ExperienceLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 };

/** Base run counts per phase, indexed by running experience [beg, int, adv]. */
const RUN_COUNT: Record<PhaseName, [number, number, number]> = {
  base: [3, 4, 5],
  build: [4, 5, 6],
  peak: [3, 4, 4],
  taper: [2, 3, 3],
};

/** Hybrid session counts per phase (ramps toward race). */
const HYBRID_COUNT: Record<PhaseName, number> = {
  base: 1,
  build: 2,
  peak: 3,
  taper: 1,
};

const LIFT_SPLIT: Array<"upper" | "lower" | "full"> = ["full", "upper", "lower"];

export interface SlotPlan {
  runs: number;
  lifts: number;
  hybrids: number;
}

/** How many of each session kind a given week should contain. */
export function planWeek(
  phase: PhaseName,
  microWeek: MicroWeekType,
  runningExp: ExperienceLevel,
  hybridExp: ExperienceLevel,
): SlotPlan {
  if (microWeek === "race") {
    return { runs: 1, lifts: 0, hybrids: 0 }; // shakeout only; race is added separately
  }

  const ei = EXP_INDEX[runningExp];
  let runs = RUN_COUNT[phase][ei];
  let hybrids = HYBRID_COUNT[phase];
  let lifts = 3;

  // Hybrid-inexperienced athletes get more HYROX-specific work earlier (§4c).
  if (hybridExp === "beginner" && phase === "base") hybrids += 1;

  if (microWeek === "deload" || microWeek === "taper") {
    runs = Math.max(2, Math.round(runs * 0.6));
    hybrids = Math.max(0, hybrids - 1);
    lifts = 2;
  }

  return { runs, lifts, hybrids };
}

/** Build the ordered list of run slots for a week (always exactly one long run). */
export function buildRunSlots(phase: PhaseName, count: number): RunSlot[] {
  if (count <= 0) return [];
  const types: RunType[] = ["long"]; // long run anchors every week

  const fillers: RunType[] = [];
  switch (phase) {
    case "base":
      fillers.push("fartlek", "easy", "fartlek", "easy", "easy", "easy", "easy");
      break;
    case "build":
      fillers.push("tempo", "easy", "fartlek", "easy", "easy", "easy", "easy");
      break;
    case "peak":
      fillers.push("threshold", "interval", "easy", "easy", "easy", "easy", "easy");
      break;
    case "taper":
      fillers.push("threshold", "easy", "easy", "easy", "easy", "easy", "easy");
      break;
  }
  for (let i = 0; types.length < count; i++) types.push(fillers[i % fillers.length]);

  return types.slice(0, count).map((rt) => ({
    kind: "run" as const,
    runType: rt,
    goalZone: GOAL_ZONE[rt],
    isLong: rt === "long",
  }));
}

function buildLiftSlots(count: number): SessionSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "lift" as const,
    liftType: LIFT_SPLIT[i % LIFT_SPLIT.length],
  }));
}

function buildHybridSlots(count: number): SessionSlot[] {
  return Array.from({ length: count }, () => ({ kind: "hybrid" as const, goalZone: GOAL_ZONE.hybrid_run }));
}

/**
 * Assign a week's sessions across the training days. Sessions are interleaved
 * round-robin so hard days spread out; days with no session get an explicit
 * rest slot; when there are more sessions than days, days double up.
 */
export function assignDays(
  trainingDays: TrainingDayName[],
  phase: PhaseName,
  microWeek: MicroWeekType,
  runningExp: ExperienceLevel,
  hybridExp: ExperienceLevel,
  race?: { priority: RacePriorityName; date?: string },
): DaySlot[] {
  const plan = planWeek(phase, microWeek, runningExp, hybridExp);

  // Interleave kinds (run, lift, hybrid, run, lift, …) so similar sessions
  // don't cluster on adjacent days.
  const runs = buildRunSlots(phase, plan.runs);
  const lifts = buildLiftSlots(plan.lifts);
  const hybrids = buildHybridSlots(plan.hybrids);
  const ordered = interleave(runs, lifts, hybrids);

  const days: DaySlot[] = trainingDays.map((day) => ({ day, sessions: [] as SessionSlot[] }));

  let di = 0;
  for (const s of ordered) {
    days[di % days.length].sessions.push(s);
    di += 1;
  }

  if (race) {
    // Race goes on the last training day of the week; keep only a light
    // shakeout run before it.
    const last = days[days.length - 1];
    last.sessions = [{ kind: "race", priority: race.priority }];
  }

  for (const d of days) {
    if (d.sessions.length === 0) d.sessions.push({ kind: "rest" });
  }

  return days;
}

function interleave(...groups: SessionSlot[][]): SessionSlot[] {
  const out: SessionSlot[] = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max; i++) {
    for (const g of groups) {
      if (i < g.length) out.push(g[i]);
    }
  }
  return out;
}
