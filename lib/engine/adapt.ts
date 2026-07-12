/**
 * Adaptation Engine (Phase 2 — phase2-spec.md §4). Deterministic, no AI.
 *
 * Reads one completed week's logs, computes compliance + strain signals, and
 * applies an ordered rule set to produce revised targets for the upcoming
 * week. The AI (session refill) never decides how much volume changes — this
 * module is the only adaptation authority, so every change is auditable and
 * unit-testable. Mirrors the v1 split: engine owns the math, Haiku fills
 * content.
 *
 * Volume bounds: hold / earned-bump adjustments are clamped to ±20% of the
 * target week's original skeleton values. Early deload and re-anchor are
 * exempt — they apply the engine's standard −40% deload math (a defined safe
 * operation, like a scheduled deload), and the re-anchor decay respectively.
 */

import type { ProgramWeek, WorkoutLog } from "@/lib/schemas";
import type { MicroWeekType, TrainingDayName, WeekSkeleton } from "./types";
import { ADAPT } from "./adapt-config";

// --- Signals (phase2-spec.md §4a) ---

export interface WeekSignals {
  /** Sessions the plan called for (race days excluded). */
  plannedSessions: number;
  /** completed + 0.5 × partial, over plannedSessions. 0..1. */
  compliance: number;
  /** RPE-weighted strain (easy sessions weighted 1.5×), or null if no RPE logged. */
  strain: number | null;
  /** null = no long run planned this week. */
  longRunCompleted: boolean | null;
  /** null = no quality run (tempo/threshold/interval) planned this week. */
  qualityRunCompleted: boolean | null;
  /** Largest planned long-run distance this week (miles), if any. */
  longRunPlannedMiles: number | null;
  /** Best-effort actual totals (logged actuals, else planned values by status). */
  actualMileage: number;
  actualCardioMinutes: number;
  plannedMileage: number;
  plannedCardioMinutes: number;
}

type LogKey = string;
const logKey = (day: string, sessionIndex: number): LogKey => `${day}:${sessionIndex}`;

function isEasySession(session: ProgramWeek["days"][number]["sessions"][number]): boolean {
  return session.kind === "run" && session.goalZone <= 2;
}

/** Compute the review signals for one program week from its logs. */
export function computeWeekSignals(week: ProgramWeek, logs: WorkoutLog[]): WeekSignals {
  const byKey = new Map<LogKey, WorkoutLog>();
  for (const l of logs) {
    if (l.weekNumber === week.weekNumber) byKey.set(logKey(l.day, l.sessionIndex), l);
  }

  let planned = 0;
  let credit = 0;
  let rpeWeighted = 0;
  let rpeWeightSum = 0;
  let longRunPlanned = false;
  let longRunDone = true;
  let longRunMiles: number | null = null;
  let qualityPlanned = false;
  let qualityDone = true;
  let plannedMileage = 0;
  let plannedCardio = 0;
  let actualMileage = 0;
  let actualCardio = 0;

  for (const day of week.days) {
    day.sessions.forEach((session, sessionIndex) => {
      if (session.kind === "race") return; // races never feed volume adaptation
      planned += 1;

      const log = byKey.get(logKey(day.day, sessionIndex));
      const status = log?.status;
      if (status === "completed") credit += 1;
      else if (status === "partial") credit += ADAPT.PARTIAL_CREDIT;

      if (log?.rpe != null && status !== "skipped") {
        const w = isEasySession(session) ? ADAPT.EASY_RPE_WEIGHT : 1;
        rpeWeighted += log.rpe * w;
        rpeWeightSum += w;
      }

      // Key-session tracking.
      if (session.kind === "run" && session.runType === "long") {
        longRunPlanned = true;
        longRunMiles = Math.max(longRunMiles ?? 0, session.distanceMiles);
        if (status !== "completed") longRunDone = false;
      }
      if (session.kind === "run" && ["tempo", "threshold", "interval"].includes(session.runType)) {
        qualityPlanned = true;
        if (status !== "completed") qualityDone = false;
      }

      // Planned vs actual volume (best effort; logged actuals win).
      const plannedMin =
        session.kind === "run" ? session.durationMin
        : session.kind === "hybrid" ? ADAPT.DEFAULT_HYBRID_MINUTES
        : 0;
      const plannedMi = session.kind === "run" ? session.distanceMiles : 0;
      plannedMileage += plannedMi;
      plannedCardio += plannedMin;

      const fraction = status === "completed" ? 1 : status === "partial" ? ADAPT.PARTIAL_CREDIT : 0;
      actualMileage += log?.actuals?.distanceMiles ?? plannedMi * fraction;
      if (session.kind !== "lift") {
        actualCardio += log?.actuals?.durationMin ?? plannedMin * fraction;
      }
    });
  }

  return {
    plannedSessions: planned,
    compliance: planned === 0 ? 1 : round2(credit / planned),
    strain: rpeWeightSum > 0 ? round1(rpeWeighted / rpeWeightSum) : null,
    longRunCompleted: longRunPlanned ? longRunDone : null,
    qualityRunCompleted: qualityPlanned ? qualityDone : null,
    longRunPlannedMiles: longRunMiles,
    actualMileage: round1(actualMileage),
    actualCardioMinutes: Math.round(actualCardio),
    plannedMileage: round1(plannedMileage),
    plannedCardioMinutes: Math.round(plannedCardio),
  };
}

// --- Decision (phase2-spec.md §4b, first match wins) ---

export type AdaptRuleCode =
  | "none"
  | "hold"
  | "early_deload"
  | "protect_long_run"
  | "earned_bump"
  | "re_anchor";

export interface RevisedTargets {
  targetMileage: number;
  targetCardioMinutes: number;
  /** Set when the rule relabels the week (early deload / re-anchor). */
  microWeek?: MicroWeekType;
}

export interface AdaptDecision {
  rule: AdaptRuleCode;
  /** Plain-language explanation shown on the review screen. */
  reason: string;
  /** null when nothing changes (rule 'none' or a pure-constraint rule). */
  revisedTargets: RevisedTargets | null;
  /** Extra constraints handed to the session refill prompt. */
  constraints: { longRunMaxMiles?: number };
}

export interface AdaptContext {
  /** The reviewed (completed) week's engine targets. */
  reviewedTargets: { targetMileage: number; targetCardioMinutes: number };
  /** Original skeleton of the week being revised, or null if none exists. */
  nextWeek: WeekSkeleton | null;
  /** Previous reviewed week's compliance, if known (for the re-anchor trend). */
  prevCompliance: number | null;
  /** Previous reviewed week's strain, if known (for the deload trend). */
  prevStrain: number | null;
  /** Rule applied by the most recent applied adaptation (bump can't repeat). */
  lastRule: AdaptRuleCode | null;
}

/** Decide what (if anything) to change about the next week. */
export function decideAdaptation(signals: WeekSignals, ctx: AdaptContext): AdaptDecision {
  const none = (reason: string): AdaptDecision => ({
    rule: "none",
    reason,
    revisedTargets: null,
    constraints: {},
  });

  // 1. Taper/race weeks are untouchable; so is a week that doesn't exist.
  const next = ctx.nextWeek;
  if (!next) return none("This is the final week of the program — nothing left to adapt.");
  if (next.phase === "taper" || next.microWeek === "taper" || next.microWeek === "race" || next.raceDay) {
    return none("Next week is part of your race taper, which always runs as planned.");
  }

  const pct = Math.round(signals.compliance * 100);

  // 2. Two straight very-low-compliance weeks → re-anchor.
  if (
    signals.compliance < ADAPT.COMPLIANCE_REANCHOR &&
    ctx.prevCompliance !== null &&
    ctx.prevCompliance < ADAPT.COMPLIANCE_REANCHOR
  ) {
    const decay = ADAPT.REANCHOR_DECAY_PER_WEEK ** 2;
    const factor = Math.max(ADAPT.REANCHOR_FLOOR, decay);
    return {
      rule: "re_anchor",
      reason:
        `You've completed under ${Math.round(ADAPT.COMPLIANCE_REANCHOR * 100)}% of sessions two weeks running — ` +
        `that's a training break, not a bad week. Next week restarts at reduced volume ` +
        `(about ${Math.round(factor * 100)}% of where you left off) so you can rebuild without overreaching. ` +
        `If your schedule has changed for good, consider a full Recalculate instead.`,
      revisedTargets: {
        targetMileage: round1(ctx.reviewedTargets.targetMileage * factor),
        targetCardioMinutes: Math.round(ctx.reviewedTargets.targetCardioMinutes * factor),
        microWeek: "rebound",
      },
      constraints: {},
    };
  }

  // 3. Low compliance → hold volume (no progression, no punitive makeup).
  if (signals.compliance < ADAPT.COMPLIANCE_HOLD) {
    return {
      rule: "hold",
      reason:
        `You completed ${pct}% of last week's sessions, so next week holds at last week's volume ` +
        `instead of progressing. No makeup volume — just pick the plan back up.`,
      revisedTargets: clampToBounds(
        {
          targetMileage: ctx.reviewedTargets.targetMileage,
          targetCardioMinutes: ctx.reviewedTargets.targetCardioMinutes,
        },
        next,
      ),
      constraints: {},
    };
  }

  // 4. High strain → early deload (standard −40% deload math).
  const strained =
    signals.strain !== null &&
    (signals.strain >= ADAPT.STRAIN_DELOAD ||
      (signals.strain >= ADAPT.STRAIN_DELOAD_TREND &&
        ctx.prevStrain !== null &&
        ctx.prevStrain >= ADAPT.STRAIN_DELOAD_TREND));
  if (strained) {
    return {
      rule: "early_deload",
      reason:
        `Your effort averaged RPE ${signals.strain} — that's overreach territory, so next week ` +
        `becomes an early deload (−40% volume). The microcycle picks back up from there.`,
      revisedTargets: {
        targetMileage: round1(ctx.reviewedTargets.targetMileage * ADAPT.DELOAD_FACTOR),
        targetCardioMinutes: Math.round(ctx.reviewedTargets.targetCardioMinutes * ADAPT.DELOAD_FACTOR),
        microWeek: "deload",
      },
      constraints: {},
    };
  }

  // 5. Missed long run (with otherwise-OK compliance) → protect the long run.
  if (signals.longRunCompleted === false && signals.longRunPlannedMiles !== null) {
    return {
      rule: "protect_long_run",
      reason:
        `You missed the long run, so next week's long run stays capped at ` +
        `${signals.longRunPlannedMiles} miles (no progression on it) while the rest of the week proceeds as planned.`,
      revisedTargets: null, // volume unchanged; constraint goes to the refill
      constraints: { longRunMaxMiles: signals.longRunPlannedMiles },
    };
  }

  // 6. Great week on a scheduled increase → small earned bump (never twice in a row).
  if (
    signals.compliance >= ADAPT.COMPLIANCE_BUMP &&
    signals.strain !== null &&
    signals.strain <= ADAPT.STRAIN_BUMP &&
    next.microWeek === "increase" &&
    ctx.lastRule !== "earned_bump"
  ) {
    return {
      rule: "earned_bump",
      reason:
        `${pct}% of sessions done at an easy average effort (RPE ${signals.strain}) — ` +
        `you've earned a little extra on this increase week (+2.5% mileage on top of the scheduled progression).`,
      revisedTargets: clampToBounds(
        {
          targetMileage: next.targetMileage * (1 + ADAPT.BUMP_EXTRA_MILEAGE_PCT),
          targetCardioMinutes: next.targetCardioMinutes,
        },
        next,
      ),
      constraints: {},
    };
  }

  // 7. Default: the plan stands.
  return none(
    `Solid week — ${pct}% of sessions completed. Next week proceeds exactly as planned.`,
  );
}

/** Clamp revised targets to ±20% of the target week's original skeleton values. */
export function clampToBounds(targets: RevisedTargets, original: WeekSkeleton): RevisedTargets {
  const lo = 1 - ADAPT.MAX_DEVIATION_PCT;
  const hi = 1 + ADAPT.MAX_DEVIATION_PCT;
  return {
    ...targets,
    targetMileage: round1(
      clamp(targets.targetMileage, original.targetMileage * lo, original.targetMileage * hi),
    ),
    targetCardioMinutes: Math.round(
      clamp(
        targets.targetCardioMinutes,
        original.targetCardioMinutes * lo,
        original.targetCardioMinutes * hi,
      ),
    ),
  };
}

/** Produce the revised WeekSkeleton for the target week (structure unchanged —
 *  only volume targets and, for deload/re-anchor, the microcycle label move). */
export function applyDecisionToWeek(next: WeekSkeleton, decision: AdaptDecision): WeekSkeleton {
  if (!decision.revisedTargets) return next;
  return {
    ...next,
    targetMileage: decision.revisedTargets.targetMileage,
    targetCardioMinutes: decision.revisedTargets.targetCardioMinutes,
    microWeek: decision.revisedTargets.microWeek ?? next.microWeek,
  };
}

// --- Streak helper (dashboard "This week" card) ---

/** Consecutive weeks (ending at `throughWeek`) with compliance ≥ 80%. */
export function adherenceStreak(
  weeks: ProgramWeek[],
  logs: WorkoutLog[],
  throughWeek: number,
): number {
  let streak = 0;
  for (let w = throughWeek; w >= 1; w--) {
    const week = weeks.find((x) => x.weekNumber === w);
    if (!week) break;
    const s = computeWeekSignals(week, logs);
    if (s.plannedSessions === 0) continue; // race/rest-only weeks don't break a streak
    if (s.compliance >= ADAPT.STREAK_COMPLIANCE) streak += 1;
    else break;
  }
  return streak;
}

// --- misc ---

export type { TrainingDayName };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
