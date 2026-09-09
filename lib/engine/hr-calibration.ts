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
 * of the zones the session actually prescribes. Which comparison runs depends on
 * which datum is available.
 *
 * The peak has the same trap one level down, and it bit. A peak was compared
 * against the flat FLOOR of the work zone, but the prescription the athlete reads
 * has never stated a flat floor — it states a per-rep ramp, one estimated peak
 * for each rep, precisely because heart rate lags the work and rep 1 finishes
 * below the band no matter how well it is run. Two numbers computed in two places
 * for the same question will disagree, and here they did: an athlete who executed
 * the session exactly as written could be told they under-performed against a bar
 * they were never given. A peak is now compared against `expectedPeakBpm` — the
 * prescription's own function, reading the athlete's own model.
 * ---------------------------------------------------------------------------
 */

import type { Session } from "@/lib/schemas";
import type { HrModel, Zone } from "@/lib/zones";
import { zoneBpmRange } from "@/lib/zones";
import { RUN_CROSS_WARMUP, RUN_WARMUP_COOLDOWN } from "@/lib/session-volume";
import { recoveryFactor, repsForWorkMiles } from "./interval-structure";
import { expectedPeakBpm } from "./hr-targets";

/** Quality runs are the only sessions with a sharp enough HR target to read. */
const QUALITY_RUN_TYPES = new Set(["interval", "threshold", "tempo"]);

/** Warmup and cooldown are easy running, whatever the session's work zone is. */
const EASY_ZONE: Zone = 2;

export interface SessionHrShape {
  /** Minutes at the session's prescribed work zone. */
  workMin: number;
  /** Minutes of Zone 1–2 work — warm-up (run and bike), cooldown, and any
   *  between-rep recovery. */
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
  // The bike/rower half of a quality warm-up (`RUN_CROSS_WARMUP`) is Zone 1–2
  // work like the jog it replaced, so it belongs in `easyMin` — the athlete's
  // heart rate does not know which machine it is on. Leaving it out would make a
  // correctly-executed session read as if it had skipped its warm-up.
  const easyMin = warmup + cooldown + (RUN_CROSS_WARMUP[session.runType] ?? 0) + recoveryMin;
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

/**
 * The peak a correctly-executed session should REACH — the same number the
 * athlete's own prescription printed as the top of its HR line.
 *
 * This used to be the flat floor of the session's work zone, and that was the
 * bug. The prescription has never stated a flat band: it states a per-rep ramp
 * ("HR reps: 166 by the end of rep 1 - 179 by the end of rep 5"), because heart
 * rate lags the work that produces it and rep 1 ends below the zone by design.
 * Judging a logged peak against the zone floor therefore measured the athlete
 * against a bar nobody ever gave them — sometimes too low, and on a Zone 5
 * interval session, far too low. `expectedPeakBpm` is the prescription's own
 * function, so the two can no longer disagree.
 *
 * The rep count comes from the run's WORK DISTANCE, exactly as the description
 * and the program view derive it (`repsForWorkMiles`) — the reconciler resizes
 * every quality run to hit the week's mileage, so the experience-level rep tables
 * describe a workout that in general is not the one the athlete was given. An
 * experience level is not recorded on a session, and "intermediate" only ever
 * feeds the zero-distance placeholder case, which the description path does not
 * rewrite either.
 *
 * Falls back to the work-zone floor when the run type has no modelled shape at
 * all, which is a stimulus floor rather than a target, and better than refusing
 * to judge the session.
 */
export function expectedPeakHr(session: Session, model: HrModel): number | null {
  if (session.kind !== "run" || !QUALITY_RUN_TYPES.has(session.runType)) return null;
  const zone = session.goalZone as Zone;
  const reps = repsForWorkMiles(session.runType, session.distanceMiles, "intermediate") ?? 0;
  return expectedPeakBpm(model, zone, session.runType, reps) ?? zoneBpmRange(model, zone).min;
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
 * Judge one session. A peak is measured against the peak the PRESCRIPTION stated
 * for this run — the last rep's estimate on a rep-based session, the drifted end
 * of the band on a tempo. An average is measured against the expected blended
 * average.
 *
 * Both comparisons now read a number the athlete was actually shown. That is the
 * whole point: a calibration verdict that disagrees with the session text is not
 * a judgement about the athlete, it is a bug in the judge.
 */
export function judgeSession(
  session: Session,
  reading: HrReading,
  model: HrModel,
): SessionCalibration | null {
  if (session.kind !== "run" || !QUALITY_RUN_TYPES.has(session.runType)) return null;
  const expected =
    reading.kind === "peak" ? expectedPeakHr(session, model) : expectedAverageHr(session, model);
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
