/**
 * Heart-rate calibration — did the quality sessions land where they were aimed?
 *
 * The engine prescribes a quality run at a pace derived from the athlete's 5K
 * (VDOT), and a target zone derived from their HR model. Whether those two agree
 * in practice is only knowable from logged data, and until now nothing read it
 * back. An athlete whose 5K time is stale trains at paces that are too easy for
 * months, and the program has no way to notice.
 *
 * This module turns logged HR into that signal. It deliberately does NOT touch the
 * work:rest ratios — those are set by the workout's intent (Daniels I-pace 1:1,
 * threshold 2:1) and are not a tuning knob. The lever is the PACE model.
 *
 * ---------------------------------------------------------------------------
 * The trap this is built to avoid
 *
 * A whole-session average HR is not comparable to the work-zone band. An interval
 * session is roughly 15 min of warmup, 20 min of reps, 15 min of recovery jogging
 * and 10 min of cooldown: only a third of it is meant to be in Zone 5. Comparing
 * its average against a "175+ bpm" target would report "under-shot" on every
 * correctly-executed session forever.
 *
 * So an average is compared against an EXPECTED average — the time-weighted blend
 * of the zones the session actually prescribes — and a peak is compared against
 * the work-zone band. Which comparison runs depends on which datum is available.
 * ---------------------------------------------------------------------------
 */

import type { Session } from "@/lib/schemas";
import type { HrModel, Zone } from "@/lib/zones";
import { zoneBpmRange } from "@/lib/zones";
import { RUN_WARMUP_COOLDOWN } from "@/lib/session-volume";
import { recoveryFactor } from "./interval-structure";

/** Quality runs are the only sessions with a sharp enough HR target to read. */
const QUALITY_RUN_TYPES = new Set(["interval", "threshold", "tempo"]);

/** Warmup and cooldown are easy running, whatever the session's work zone is. */
const EASY_ZONE: Zone = 2;

export interface SessionHrShape {
  /** Minutes at the session's prescribed work zone. */
  workMin: number;
  /** Minutes of easy running — warmup, cooldown and any between-rep recovery. */
  easyMin: number;
  /** Total minutes actually spent on the session. */
  totalMin: number;
}

/**
 * The true time structure of a quality run, including the between-rep recovery
 * that the stored session timing leaves out. `durationMin` is the reps only, so a
 * "45 minute" interval session is really about 60.
 */
export function sessionHrShape(session: Session): SessionHrShape | null {
  if (session.kind !== "run" || !QUALITY_RUN_TYPES.has(session.runType)) return null;
  const [warmup, cooldown] = RUN_WARMUP_COOLDOWN[session.runType];
  const workMin = Math.max(0, session.durationMin);
  // Prefer the recovery the session actually carries; fall back to the shared
  // rep/rest structure for sessions generated before it was recorded.
  const recoveryMin =
    session.recoveryMin ?? workMin * recoveryFactor(session.runType, "intermediate");
  const easyMin = warmup + cooldown + recoveryMin;
  return { workMin, easyMin, totalMin: workMin + easyMin };
}

/** Midpoint bpm of a zone — the single number a zone "means". */
function zoneMid(model: HrModel, zone: Zone): number {
  const { min, max } = zoneBpmRange(model, zone);
  return (min + max) / 2;
}

/**
 * What a correctly-executed session's AVERAGE HR should look like: the work zone
 * and the easy zone blended by their minutes. This is the number a logged session
 * average is comparable to.
 */
export function expectedAverageHr(session: Session, model: HrModel): number | null {
  const shape = sessionHrShape(session);
  if (!shape || shape.totalMin <= 0) return null;
  if (session.kind !== "run") return null;
  const work = zoneMid(model, session.goalZone as Zone);
  const easy = zoneMid(model, EASY_ZONE);
  return Math.round((work * shape.workMin + easy * shape.easyMin) / shape.totalMin);
}

export type HrReading =
  | { kind: "peak"; bpm: number }
  | { kind: "average"; bpm: number };

export type SessionVerdict = "under" | "on_target" | "over";

export interface SessionCalibration {
  weekNumber: number;
  runType: string;
  reading: HrReading;
  expected: number;
  /** Observed minus expected, in bpm. Negative = easier than prescribed. */
  deltaBpm: number;
  verdict: SessionVerdict;
}

/** Outside this band either way, a session counts as off-target. */
const ON_TARGET_BPM = 5;

/**
 * Judge one session. A peak is measured against the bottom of the work zone —
 * a session that never reaches its zone floor did not deliver its stimulus. An
 * average is measured against the expected blended average.
 */
export function judgeSession(
  session: Session,
  reading: HrReading,
  model: HrModel,
): SessionCalibration | null {
  if (session.kind !== "run" || !QUALITY_RUN_TYPES.has(session.runType)) return null;
  const expected =
    reading.kind === "peak"
      ? zoneBpmRange(model, session.goalZone as Zone).min
      : expectedAverageHr(session, model);
  if (expected === null || !Number.isFinite(reading.bpm) || reading.bpm <= 0) return null;
  const deltaBpm = Math.round(reading.bpm - expected);
  const verdict: SessionVerdict =
    deltaBpm < -ON_TARGET_BPM ? "under" : deltaBpm > ON_TARGET_BPM ? "over" : "on_target";
  return { weekNumber: 0, runType: session.runType, reading, expected, deltaBpm, verdict };
}

export interface HrCalibration {
  /** How many quality sessions carried usable HR. */
  samples: number;
  /** Mean observed-minus-expected across those sessions, in bpm. */
  meanDeltaBpm: number;
  verdict: SessionVerdict | "insufficient_data";
  /**
   * Suggested change to the athlete's pace model, as a fraction. Negative means
   * paces should get FASTER (they are working below the prescribed HR, so their
   * 5K input understates their fitness). Zero when there is nothing to say.
   */
  suggestedPaceShift: number;
  /** One line the athlete can read, or null when there is nothing to report. */
  message: string | null;
}

/** Below this many usable sessions, say nothing — one HR trace proves nothing. */
export const MIN_SAMPLES = 3;
/** Never suggest more than a 3% pace move off HR evidence alone. */
const MAX_PACE_SHIFT = 0.03;
/** bpm of mean deviation that maps to the maximum suggested shift. */
const BPM_FOR_MAX_SHIFT = 15;

export const NO_CALIBRATION: HrCalibration = {
  samples: 0,
  meanDeltaBpm: 0,
  verdict: "insufficient_data",
  suggestedPaceShift: 0,
  message: null,
};

/**
 * Roll several judged sessions into one verdict.
 *
 * Deliberately conservative: it needs `MIN_SAMPLES` sessions before it will say
 * anything, and the suggested pace move is capped at `MAX_PACE_SHIFT`. HR is noisy
 * — heat, sleep, caffeine, a mis-worn strap — and a stale 5K is a slow-moving
 * problem, so there is no case for reacting hard to a short run of data.
 */
export function calibrate(samples: SessionCalibration[]): HrCalibration {
  if (samples.length < MIN_SAMPLES) return { ...NO_CALIBRATION, samples: samples.length };
  const meanDeltaBpm =
    Math.round((samples.reduce((a, s) => a + s.deltaBpm, 0) / samples.length) * 10) / 10;
  if (Math.abs(meanDeltaBpm) <= ON_TARGET_BPM) {
    return {
      samples: samples.length,
      meanDeltaBpm,
      verdict: "on_target",
      suggestedPaceShift: 0,
      message: `Your quality sessions are landing in their prescribed zones (${samples.length} sessions, within ${ON_TARGET_BPM} bpm of target).`,
    };
  }
  const magnitude = Math.min(1, Math.abs(meanDeltaBpm) / BPM_FOR_MAX_SHIFT);
  const shift = Math.round(magnitude * MAX_PACE_SHIFT * 1000) / 1000;
  if (meanDeltaBpm < 0) {
    return {
      samples: samples.length,
      meanDeltaBpm,
      verdict: "under",
      suggestedPaceShift: -shift,
      message: `Your quality sessions are averaging ${Math.abs(meanDeltaBpm)} bpm below target over ${samples.length} sessions — the prescribed paces may be easier than your current fitness. Consider re-testing your 5K.`,
    };
  }
  return {
    samples: samples.length,
    meanDeltaBpm,
    verdict: "over",
    suggestedPaceShift: shift,
    message: `Your quality sessions are averaging ${meanDeltaBpm} bpm above target over ${samples.length} sessions — the prescribed paces may be too aggressive. Consider easing them, or re-testing your 5K.`,
  };
}
