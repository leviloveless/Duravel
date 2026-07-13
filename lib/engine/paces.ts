/**
 * Deterministic run paces via the Jack Daniels VDOT model (Review #2).
 *
 * Replaces the earlier fixed-percentage-of-5K rules. VDOT (Daniels' "VO2max
 * from a race performance") is computed from ANY race the athlete has run, so:
 *   - it works from a single time (existing single-5K users keep working), and
 *   - when several times exist (mile / 5K / 10K) we take the BEST VDOT — the
 *     standard Daniels guidance of trusting the strongest recent performance —
 *     which finally uses the mile and 10K the app was already collecting.
 *
 * Training paces are then derived from VDOT at Daniels' intensity fractions
 * (fractions of VDOT, expressed as VO2 and inverted back to a velocity). This
 * makes every pace individual to the athlete's own speed–duration profile
 * instead of assuming one fixed ratio for everyone — and the E-pace formula
 * yields a realistic easy pace (~1:00–2:30/mi over 5K pace) rather than the old
 * 162% multiplier, which is what made easy pace exceed the cardio seed and
 * break the non-running block for slow runners.
 *
 * Downstream code (reconciler, display, run descriptions) is unchanged: the
 * RunPaces shape and effectivePace / paceLabel / formatPace / parseTimeToSeconds
 * are all preserved.
 */

import type { RunType } from "./types";

export const METERS_PER_MILE = 1609.34;
export const MILE_M = METERS_PER_MILE;
export const FIVE_K_M = 5000;
export const TEN_K_M = 10000;
/** 5K distance in miles (kept for backward-compatible imports). */
export const FIVE_K_MILES = FIVE_K_M / METERS_PER_MILE; // ≈ 3.10686

/**
 * Daniels training intensities as fractions of VDOT (see calibration in #2):
 *   easy      0.70  → conversational aerobic (E/L)
 *   tempo     0.86  → ~half-marathon effort (sub-threshold "cruise")
 *   threshold 0.88  → true lactate threshold (T); ~25 s/mi over 5K pace
 *   interval  0.975 → ~vVO2max (I); ≈ 5K pace, faster for slower runners
 * Long runs are prescribed at easy pace (Daniels L = E).
 */
export const VDOT_FRACTION = {
  easy: 0.7,
  tempo: 0.86,
  threshold: 0.88,
  interval: 0.975,
} as const;

export interface RaceInput {
  mileTime?: string | null;
  fiveKTime?: string | null;
  tenKTime?: string | null;
}

export interface RunPaces {
  /** The VDOT these paces were derived from. */
  vdot: number;
  /** Predicted 5K race pace in seconds per mile (for display / legacy callers). */
  fiveKSecPerMile: number;
  easy: number;
  long: number;
  tempo: number;
  threshold: number;
  interval: number;
}

// --- time parsing (unchanged public API; used by needs.ts too) --------------

/** Parse "mm:ss" or "h:mm:ss" (or a plain number of minutes) to seconds. */
export function parseTimeToSeconds(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || Number.isNaN(Number(p)))) {
    const n = Number(t);
    return Number.isFinite(n) ? n * 60 : null; // bare number → minutes
  }
  const nums = parts.map(Number);
  // safe: element access guarded by the just-checked nums.length in each branch.
  if (nums.length === 2) return nums[0]! * 60 + nums[1]!;
  if (nums.length === 3) return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
  if (nums.length === 1) return nums[0]! * 60;
  return null;
}

// --- Daniels VDOT core ------------------------------------------------------

/** VO2 cost (ml/kg/min) of running at velocity v (m/min). Daniels/Gilbert. */
function vo2AtVelocity(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max sustainable for a race lasting t minutes. Daniels/Gilbert. */
function pctMaxAtDuration(tMin: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}

/** VDOT from a single race (distance in meters, time in seconds). */
export function vdotFromRace(distMeters: number, timeSec: number): number | null {
  if (!(distMeters > 0) || !(timeSec > 0)) return null;
  const tMin = timeSec / 60;
  const v = distMeters / tMin; // m/min
  const vdot = vo2AtVelocity(v) / pctMaxAtDuration(tMin);
  return Number.isFinite(vdot) && vdot > 0 ? vdot : null;
}

/** Velocity (m/min) that elicits a given VO2 — inverts vo2AtVelocity (+ root). */
function velocityForVo2(vo2: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** Training pace (sec/mile) at a fraction of VDOT. */
export function paceForVdotFraction(vdot: number, fraction: number): number {
  const v = velocityForVo2(fraction * vdot); // m/min
  return (METERS_PER_MILE / v) * 60; // sec/mile
}

/** Predicted race time (sec) for a distance at a given VDOT (bisection on the
 *  monotonic VDOT↔time relationship). Used to report a 5K-equivalent pace. */
function predictRaceTimeSec(distMeters: number, vdot: number): number {
  let lo = 30; // 30 s (absurdly fast) …
  let hi = 6 * 3600; // … 6 h (absurdly slow)
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = vdotFromRace(distMeters, mid);
    if (v === null) break;
    // VDOT decreases as time increases: if predicted VDOT is too high, race is
    // too fast → move slower (increase time).
    if (v > vdot) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- public pace computation ------------------------------------------------

/**
 * Compute the full deterministic pace set from the athlete's race times, or
 * null if none are usable. Accepts a RaceInput or (back-compat) a bare 5K time
 * string.
 */
export function computePaces(input: string | RaceInput | null | undefined): RunPaces | null {
  const races: RaceInput = typeof input === "string" ? { fiveKTime: input } : input ?? {};

  const vdots: number[] = [];
  const consider = (distM: number, time?: string | null) => {
    if (!time) return;
    const sec = parseTimeToSeconds(time);
    if (sec === null || sec <= 0) return;
    const v = vdotFromRace(distM, sec);
    if (v !== null) vdots.push(v);
  };
  consider(MILE_M, races.mileTime);
  consider(FIVE_K_M, races.fiveKTime);
  consider(TEN_K_M, races.tenKTime);

  if (vdots.length === 0) return null;
  const vdot = Math.max(...vdots); // trust the best performance

  const easy = paceForVdotFraction(vdot, VDOT_FRACTION.easy);
  return {
    vdot: Math.round(vdot * 10) / 10,
    fiveKSecPerMile: predictRaceTimeSec(FIVE_K_M, vdot) / FIVE_K_MILES,
    easy,
    long: easy, // Daniels: long runs are at easy pace
    tempo: paceForVdotFraction(vdot, VDOT_FRACTION.tempo),
    threshold: paceForVdotFraction(vdot, VDOT_FRACTION.threshold),
    interval: paceForVdotFraction(vdot, VDOT_FRACTION.interval),
  };
}

/**
 * Effective pace (sec/mile) used to convert a run's distance ↔ duration.
 * Fartlek and progression blend easy + threshold, so their effective pace is
 * the midpoint of the two.
 */
export function effectivePace(runType: RunType, p: RunPaces): number {
  switch (runType) {
    case "easy":
      return p.easy;
    case "long":
      return p.long;
    case "tempo":
      return p.tempo;
    case "threshold":
      return p.threshold;
    case "interval":
      return p.interval;
    case "hybrid_run":
      return p.threshold;
    case "fartlek":
    case "progression":
      return (p.easy + p.threshold) / 2;
    default:
      return p.easy;
  }
}

/** Format seconds/mile as "m:ss". */
export function formatPace(secPerMile: number): string {
  const total = Math.round(secPerMile);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Display pace label for a run. Fartlek/progression show a fast→slow range
 * (threshold to easy); every other run type shows a single pace.
 */
export function paceLabel(runType: RunType, p: RunPaces): string {
  if (runType === "fartlek" || runType === "progression") {
    return `${formatPace(p.threshold)}–${formatPace(p.easy)}`;
  }
  return formatPace(effectivePace(runType, p));
}
