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
 * Reduced race-week sessions for A and B priority (spec §6 A/B taper rules).
 *   A: maximum freshness — cut lifting entirely; a short easy shakeout plus a
 *      sharp "opener" (short, high-RPM strides / intervals) to keep the legs
 *      snappy without fatigue.
 *   B: mini-taper — keep one quality session (tempo) and a single reduced lift.
 * C races are NOT routed here: they train through as a normal week, with the
 * race simply replacing the race-day session.
 */
function raceWeekSlots(priority: RacePriorityName): SessionSlot[] {
  if (priority === "A") {
    return [
      { kind: "run", runType: "easy", goalZone: GOAL_ZONE.easy },
      { kind: "run", runType: "interval", goalZone: GOAL_ZONE.interval }, // opener
    ];
  }
  if (priority === "B") {
    return [
      { kind: "run", runType: "easy", goalZone: GOAL_ZONE.easy },
      { kind: "run", runType: "tempo", goalZone: GOAL_ZONE.tempo }, // retained quality
      { kind: "lift", liftType: "full" },
    ];
  }
  return [];
}

/** Optional day-placement preferences (new-additions #4). */
export interface DayPreferences {
  longRunDay?: TrainingDayName;
  restDays?: TrainingDayName[];
}

/**
 * Priority rank of a session within a single day (new-additions #5). Higher
 * ranks are the more important / more sport-specific work that should lead the
 * day when it doubles up (done first, while fresh). Used only to order sessions
 * that already share a day — it never changes which sessions a week contains.
 */
export function slotPriority(slot: SessionSlot): number {
  switch (slot.kind) {
    case "race":
      return 100;
    case "hybrid":
      return 90; // HYROX-specific work is the priority session
    case "run":
      switch (slot.runType) {
        case "long":
          return 80;
        case "interval":
          return 78;
        case "threshold":
          return 76;
        case "tempo":
          return 74;
        case "fartlek":
          return 60;
        case "hybrid_run":
          return 58;
        case "easy":
          return 30;
        default:
          return 40;
      }
    case "lift":
      return 50;
    case "rest":
      return 0;
    default:
      return 40;
  }
}

/** Stable sort a day's sessions so the highest-priority one comes first. */
function orderByPriority(sessions: SessionSlot[]): SessionSlot[] {
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => slotPriority(b.s) - slotPriority(a.s) || a.i - b.i)
    .map((x) => x.s);
}

function isLongRun(slot: SessionSlot): boolean {
  return slot.kind === "run" && slot.isLong === true;
}

/**
 * Move the weekly long run onto the preferred day (new-additions #4). Keeps the
 * total session count intact: if the target day already holds sessions, its
 * first session is swapped back to the long run's original day.
 */
function placeLongRunOn(days: DaySlot[], targetDay: TrainingDayName): void {
  let fromDay = -1;
  let fromIdx = -1;
  for (let i = 0; i < days.length; i++) {
    const j = days[i].sessions.findIndex(isLongRun);
    if (j !== -1) {
      fromDay = i;
      fromIdx = j;
      break;
    }
  }
  if (fromDay === -1) return;

  const targetIdx = days.findIndex((d) => d.day === targetDay);
  if (targetIdx === -1 || targetIdx === fromDay) return;

  const [longRun] = days[fromDay].sessions.splice(fromIdx, 1);
  if (days[targetIdx].sessions.length > 0) {
    const displaced = days[targetIdx].sessions.shift()!;
    days[fromDay].sessions.push(displaced);
  }
  days[targetIdx].sessions.unshift(longRun);
}

/**
 * Assign a week's sessions across the training days. Sessions are interleaved
 * round-robin so hard days spread out; days with no session get an explicit
 * rest slot; when there are more sessions than days, days double up.
 *
 * When `prefs` are supplied (new-additions #4) the distribution keeps the
 * athlete's preferred rest days empty where the schedule allows and pins the
 * long run to the preferred day. Within every day, sessions are ordered so the
 * priority workout comes first (new-additions #5). With no prefs the round-robin
 * distribution is unchanged.
 */
export function assignDays(
  trainingDays: TrainingDayName[],
  phase: PhaseName,
  microWeek: MicroWeekType,
  runningExp: ExperienceLevel,
  hybridExp: ExperienceLevel,
  race?: { priority: RacePriorityName; date?: string },
  prefs?: DayPreferences,
): DaySlot[] {
  // An A/B race week (microWeek "race") uses the reduced taper sessions; a C
  // race keeps its normal microcycle label and trains through, so it falls to
  // the normal plan below and just has the race overlaid on the race day.
  let ordered: SessionSlot[];
  if (race && microWeek === "race") {
    ordered = raceWeekSlots(race.priority);
  } else {
    const plan = planWeek(phase, microWeek, runningExp, hybridExp);
    // Interleave kinds (run, lift, hybrid, run, lift, …) so similar sessions
    // don't cluster on adjacent days.
    const runs = buildRunSlots(phase, plan.runs);
    const lifts = buildLiftSlots(plan.lifts);
    const hybrids = buildHybridSlots(plan.hybrids);
    ordered = interleave(runs, lifts, hybrids);
  }

  const days: DaySlot[] = trainingDays.map((day) => ({ day, sessions: [] as SessionSlot[] }));

  // Preferred rest days are honored only when they don't apply to an A/B race
  // week (whose taper structure is fixed) and only when enough non-rest days
  // remain to hold every session.
  const restSet = new Set(
    !(race && microWeek === "race")
      ? (prefs?.restDays ?? []).filter((d) => trainingDays.includes(d))
      : [],
  );
  let distributionDays = trainingDays.filter((d) => !restSet.has(d));
  if (distributionDays.length === 0 || ordered.length > distributionDays.length) {
    // Not enough room to respect the rest preference (or none set): fall back to
    // spreading across all training days so no session is dropped.
    distributionDays = [...trainingDays];
  }
  const idxByDay = new Map(days.map((d, i) => [d.day, i]));

  let di = 0;
  for (const s of ordered) {
    const dayKey = distributionDays[di % distributionDays.length];
    days[idxByDay.get(dayKey)!].sessions.push(s);
    di += 1;
  }

  // Pin the long run to the preferred day (skipped for A/B race weeks).
  if (prefs?.longRunDay && !(race && microWeek === "race")) {
    placeLongRunOn(days, prefs.longRunDay);
  }

  if (race) {
    // The race takes the last training day of the week, replacing that day's
    // session (for a C race this is the only change to an otherwise normal week).
    const last = days[days.length - 1];
    last.sessions = [{ kind: "race", priority: race.priority }];
  }

  for (const d of days) {
    if (d.sessions.length === 0) d.sessions.push({ kind: "rest" });
    // Priority workout first on any day that doubles up (new-additions #5).
    else if (d.sessions.length > 1) d.sessions = orderByPriority(d.sessions);
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
