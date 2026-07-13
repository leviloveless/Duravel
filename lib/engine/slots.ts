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
import type { ProgramBias, RunEmphasis } from "./needs";

const GOAL_ZONE: Record<RunType, number> = {
  easy: 2,
  fartlek: 2,
  progression: 3, // builds from easy to a threshold finish
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
  bias?: ProgramBias,
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

  // Review #1: needs-analysis frequency nudges. Applied only on normal loading
  // weeks (never deload/taper/race) so recovery is untouched, then clamped to
  // the spec bounds (runs 3–8, hybrids 0–3). This changes training FREQUENCY of
  // a quality, not weekly volume — the reconciler still hits the mileage/cardio
  // targets exactly.
  if (bias && (microWeek === "rebound" || microWeek === "increase")) {
    runs = clampInt(runs + (bias.runCountDelta ?? 0), 3, 8);
    hybrids = clampInt(hybrids + (bias.hybridCountDelta ?? 0), 0, 3);
  }

  if (microWeek === "taper") {
    // Taper: cut frequency AND volume for race-week freshness.
    runs = Math.max(2, Math.round(runs * 0.6));
    hybrids = Math.max(0, hybrids - 1);
    lifts = 2;
  } else if (microWeek === "deload") {
    // Deload (Review #9): preserve intensity + frequency touch-points and let the
    // −40% volume target (set at the microcycle level) do the load reduction by
    // shortening each session, rather than dropping quality work. Keep ≥3 runs so
    // the long run and a quality run both survive; keep one hybrid; trim lifts.
    runs = Math.max(3, runs - 1);
    hybrids = Math.max(1, hybrids - 1);
    lifts = 2;
  }

  return { runs, lifts, hybrids };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * Position of a week inside its own mesocycle, used to pick phase-appropriate
 * run types (Tasks #5 — "2nd half of build"). `index` is 0-based within the
 * phase; `length` is the phase's total week count.
 */
export interface PhasePosition {
  index: number;
  length: number;
}

/** True when the week sits in the back half of its mesocycle. */
function isSecondHalf(pos?: PhasePosition): boolean {
  if (!pos || pos.length <= 0) return false;
  return pos.index >= Math.floor(pos.length / 2);
}

/**
 * Ordered run "filler" types (everything after the anchoring long run) for a
 * phase. Run-type placement follows the periodization rules:
 *   - Fartlek runs appear only in Base and Build (Tasks #3).
 *   - Interval runs appear in the 2nd half of Build, all of Peak, and some of
 *     the Taper (Tasks #5).
 *   - Progression runs appear only in Peak and Taper (Tasks #4).
 */
function runFillers(phase: PhaseName, pos?: PhasePosition): RunType[] {
  switch (phase) {
    case "base":
      return ["fartlek", "easy", "fartlek", "easy", "easy", "easy", "easy"];
    case "build":
      // Intervals join the rotation once the Build phase is half over.
      return isSecondHalf(pos)
        ? ["tempo", "interval", "fartlek", "easy", "easy", "easy", "easy"]
        : ["tempo", "fartlek", "easy", "easy", "easy", "easy", "easy"];
    case "peak":
      return ["threshold", "interval", "progression", "easy", "easy", "easy", "easy"];
    case "taper":
      // Progression leads; an interval appears only on higher-count taper weeks
      // ("some" of the taper, Tasks #5).
      return ["progression", "interval", "threshold", "easy", "easy", "easy", "easy"];
  }
}

/** Build the ordered list of run slots for a week (always exactly one long run).
 *  `emphasis` (Review #1) reorders the filler pool so, at low run counts, the
 *  athlete's needed quality leads: "aerobic" fronts easy running, "threshold"
 *  fronts tempo/threshold/interval. "none" leaves the default order untouched. */
export function buildRunSlots(
  phase: PhaseName,
  count: number,
  pos?: PhasePosition,
  emphasis: RunEmphasis = "none",
): RunSlot[] {
  if (count <= 0) return [];
  const types: RunType[] = ["long"]; // long run anchors every week
  const fillers = applyRunEmphasis(runFillers(phase, pos), emphasis);
  for (let i = 0; types.length < count; i++) types.push(fillers[i % fillers.length]);

  return types.slice(0, count).map((rt) => ({
    kind: "run" as const,
    runType: rt,
    goalZone: GOAL_ZONE[rt],
    isLong: rt === "long",
  }));
}

const QUALITY_RUN_TYPES: ReadonlySet<RunType> = new Set(["tempo", "threshold", "interval"]);

/** Stable-reorder the filler pool by emphasis (default "none" = identity). */
function applyRunEmphasis(fillers: RunType[], emphasis: RunEmphasis): RunType[] {
  if (emphasis === "none") return fillers;
  const rank = (t: RunType): number => {
    if (emphasis === "aerobic") return t === "easy" ? 0 : 1;
    return QUALITY_RUN_TYPES.has(t) ? 0 : 1; // "threshold"
  };
  return fillers
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map((x) => x.t);
}

function buildLiftSlots(count: number): SessionSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "lift" as const,
    liftType: LIFT_SPLIT[i % LIFT_SPLIT.length],
  }));
}

function buildHybridSlots(count: number, simulateFirst = false): SessionSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "hybrid" as const,
    goalZone: GOAL_ZONE.hybrid_run,
    ...(simulateFirst && i === 0 ? { simulation: true } : {}),
  }));
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

/**
 * Optional day-placement preferences: which workout types land on which days
 * (new-additions #4; extended to lift + hybrid days in Tasks #1).
 */
export interface DayPreferences {
  longRunDay?: TrainingDayName;
  restDays?: TrainingDayName[];
  liftDays?: TrainingDayName[];
  hybridDays?: TrainingDayName[];
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
        case "progression":
          return 72;
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

type SlotPredicate = (slot: SessionSlot) => boolean;

const isLongRun: SlotPredicate = (s) => s.kind === "run" && s.isLong === true;
const isHybrid: SlotPredicate = (s) => s.kind === "hybrid";
const isLift: SlotPredicate = (s) => s.kind === "lift";

// --- Concurrent-training sequencing guards (Review #8) ---
//
// Endurance and strength adaptations interfere (AMPK vs mTOR), and heavy leg
// work leaves residual fatigue that compromises a quality run the next day. So
// we keep heavy-leg lifts (lower / full body) off the day BEFORE a key run
// (long / interval / threshold / tempo). Best-effort + count-preserving: it only
// relocates onto unprotected days and never onto (or the day before) another key
// run, and only pushes a "light" session back to the vacated day.

const KEY_RUN_TYPES: ReadonlySet<RunType> = new Set(["long", "interval", "threshold", "tempo"]);
export const isKeyRun: SlotPredicate = (s) => s.kind === "run" && KEY_RUN_TYPES.has(s.runType);
export const isHardLegLift: SlotPredicate = (s) =>
  s.kind === "lift" && (s.liftType === "lower" || s.liftType === "full");

/** A session light enough to sit the day before a key run (no leg fatigue). */
function isLightSlot(s: SessionSlot): boolean {
  if (s.kind === "rest") return true;
  if (s.kind === "run") return !isKeyRun(s);
  if (s.kind === "lift") return s.liftType === "upper";
  return false; // hybrid / race are not "light"
}

function dayHas(day: DaySlot, pred: SlotPredicate): boolean {
  return day.sessions.some(pred);
}

/** Index of a movable "light" session on a day, or -1. */
function lightIndex(day: DaySlot): number {
  return day.sessions.findIndex(isLightSlot);
}

/**
 * Pick a day to relocate a heavy-leg lift to: unprotected, not a key-run day,
 * not the day before a key run, and able to give back a light session (or empty).
 * Empty days are strongly preferred. Returns the day index, or -1.
 */
function pickSequencingTarget(
  days: DaySlot[],
  keyRunIdx: number,
  protectedDays: Set<TrainingDayName>,
): number {
  const beforeKeyRun = (t: number) => t + 1 < days.length && dayHas(days[t + 1], isKeyRun);
  let best = -1;
  let bestScore = -Infinity;
  for (let t = 0; t < days.length; t++) {
    if (t === keyRunIdx || t === keyRunIdx - 1) continue;
    if (protectedDays.has(days[t].day)) continue;
    if (dayHas(days[t], isKeyRun)) continue;
    if (beforeKeyRun(t)) continue;
    const empty = days[t].sessions.length === 0;
    if (!empty && lightIndex(days[t]) === -1) continue; // nothing safe to swap back
    const load = days[t].sessions.filter((x) => x.kind !== "rest").length;
    const score = (empty ? 100 : 0) - load;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Relocate heavy-leg lifts that sit the day before a key run. */
export function applySequencingGuards(days: DaySlot[], protectedDays: Set<TrainingDayName>): void {
  for (let i = 1; i < days.length; i++) {
    if (!dayHas(days[i], isKeyRun)) continue;
    const prev = days[i - 1];
    if (protectedDays.has(prev.day)) continue;
    const j = prev.sessions.findIndex(isHardLegLift);
    if (j === -1) continue;
    const target = pickSequencingTarget(days, i, protectedDays);
    if (target === -1) continue;

    const [lift] = prev.sessions.splice(j, 1);
    const tgt = days[target];
    if (tgt.sessions.length === 0) {
      tgt.sessions.push(lift);
    } else {
      const di = lightIndex(tgt); // guaranteed ≥ 0 by pickSequencingTarget
      const [back] = tgt.sessions.splice(di, 1);
      prev.sessions.push(back);
      tgt.sessions.push(lift);
    }
  }
}

/**
 * Move a session matching `predicate` onto `targetDay` (new-additions #4;
 * generalized for lift/hybrid days in Tasks #1). Keeps the total session count
 * intact via a swap: if the target day already holds sessions, one is moved
 * back to the source day. No-ops when the target already satisfies the
 * preference, the target is protected (e.g. a rest day or an already-pinned
 * day), or no movable source session exists on an unprotected day.
 */
function placeSessionOn(
  days: DaySlot[],
  targetDay: TrainingDayName,
  predicate: SlotPredicate,
  protectedDays: Set<TrainingDayName>,
): void {
  const targetIdx = days.findIndex((d) => d.day === targetDay);
  if (targetIdx === -1 || protectedDays.has(targetDay)) return;
  if (days[targetIdx].sessions.some(predicate)) return; // already satisfied

  for (let i = 0; i < days.length; i++) {
    if (i === targetIdx || protectedDays.has(days[i].day)) continue;
    const j = days[i].sessions.findIndex(predicate);
    if (j === -1) continue;
    const [sess] = days[i].sessions.splice(j, 1);
    if (days[targetIdx].sessions.length > 0) {
      const displaced = days[targetIdx].sessions.shift()!;
      days[i].sessions.push(displaced);
    }
    days[targetIdx].sessions.unshift(sess);
    return;
  }
}

/**
 * Place matching sessions onto several preferred days in order, protecting each
 * day once it's been assigned so the next target can't steal it back.
 */
function placeSessionsOn(
  days: DaySlot[],
  targetDays: TrainingDayName[],
  predicate: SlotPredicate,
  protectedDays: Set<TrainingDayName>,
): void {
  for (const day of targetDays) {
    placeSessionOn(days, day, predicate, protectedDays);
    protectedDays.add(day);
  }
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
  pos?: PhasePosition,
  bias?: ProgramBias,
): DaySlot[] {
  // An A/B race week (microWeek "race") uses the reduced taper sessions; a C
  // race keeps its normal microcycle label and trains through, so it falls to
  // the normal plan below and just has the race overlaid on the race day.
  let ordered: SessionSlot[];
  if (race && microWeek === "race") {
    ordered = raceWeekSlots(race.priority);
  } else {
    const plan = planWeek(phase, microWeek, runningExp, hybridExp, bias);
    // Interleave kinds (run, lift, hybrid, run, lift, …) so similar sessions
    // don't cluster on adjacent days.
    const runs = buildRunSlots(phase, plan.runs, pos, bias?.runEmphasis ?? "none");
    const lifts = buildLiftSlots(plan.lifts);
    // Review #9: one Peak hybrid per normal week becomes a full race simulation.
    const simulate = phase === "peak" && (microWeek === "rebound" || microWeek === "increase");
    const hybrids = buildHybridSlots(plan.hybrids, simulate);
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

  // Pin preferred workout types to their days (skipped for A/B race weeks whose
  // taper structure is fixed). Order matters — the long run is placed first and
  // protected, then hybrids (sport-specific), then lifts (Tasks #1). Rest-day
  // preferences are protected throughout so nothing is pinned onto them.
  if (!(race && microWeek === "race")) {
    const inDays = (d: TrainingDayName) => trainingDays.includes(d);
    const protectedDays = new Set<TrainingDayName>(restSet);
    if (prefs?.longRunDay && inDays(prefs.longRunDay)) {
      placeSessionOn(days, prefs.longRunDay, isLongRun, protectedDays);
      protectedDays.add(prefs.longRunDay);
    }
    if (prefs?.hybridDays?.length) {
      placeSessionsOn(days, prefs.hybridDays.filter(inDays), isHybrid, protectedDays);
    }
    if (prefs?.liftDays?.length) {
      placeSessionsOn(days, prefs.liftDays.filter(inDays), isLift, protectedDays);
    }
    // Review #8: keep heavy-leg lifts off the day before a key run.
    applySequencingGuards(days, protectedDays);
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
