/**
 * Forward readiness signal (Review #7).
 *
 * The adaptation engine was purely retrospective (last week's compliance /
 * strain / ACWR). This adds a PROSPECTIVE dial: a weekly Hooper wellness
 * check-in (sleep, fatigue, stress, soreness — the validated 4-item subjective
 * index; Hooper & Mackinnon 1995, McLean 2010) plus optional resting-HR / HRV.
 * A low readiness score lets the engine soften the upcoming week BEFORE a bad
 * one instead of only reacting after.
 *
 * Objective inputs (RHR/HRV) are interpreted against the athlete's OWN prior
 * check-ins (a personal baseline), so they only sharpen the signal once there's
 * a little history; with none, Hooper alone drives the score. Pure + testable.
 */

import { ADAPT } from "./adapt-config";
import { clamp } from "./math";

export interface ReadinessCheckin {
  weekNumber: number;
  /** Hooper items, each 1 (best) … 7 (worst). */
  sleep: number;
  fatigue: number;
  stress: number;
  soreness: number;
  /** Optional objective inputs. */
  restingHr?: number | null;
  hrv?: number | null;
}

export type ReadinessCategory = "very_low" | "low" | "moderate" | "good";

export interface Readiness {
  /** 0–100, higher = more ready. */
  score: number;
  category: ReadinessCategory;
  /** The Hooper-only score before objective adjustments (for display/audit). */
  hooperScore: number;
  /** Human-readable note on what moved the score (elevated RHR, HRV drop). */
  note: string;
}

const HOOPER_MIN = 4; // 4 items × 1
const HOOPER_MAX = 28; // 4 items × 7

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sum of the 4 Hooper items (4–28; higher = worse wellness). */
export function hooperSum(c: ReadinessCheckin): number {
  return c.sleep + c.fatigue + c.stress + c.soreness;
}

/** Hooper wellness as a 0–100 readiness score (100 = fully ready). */
export function hooperReadiness(c: ReadinessCheckin): number {
  const sum = clamp(hooperSum(c), HOOPER_MIN, HOOPER_MAX);
  return Math.round((100 * (HOOPER_MAX - sum)) / (HOOPER_MAX - HOOPER_MIN));
}

function categorize(score: number): ReadinessCategory {
  if (score < ADAPT.READINESS_VERY_LOW) return "very_low";
  if (score < ADAPT.READINESS_LOW) return "low";
  if (score < ADAPT.READINESS_MODERATE) return "moderate";
  return "good";
}

/**
 * Compute readiness from the current check-in, using prior check-ins to form a
 * personal RHR/HRV baseline. Objective penalties apply only with ≥2 priors.
 */
export function computeReadiness(
  current: ReadinessCheckin,
  priors: ReadinessCheckin[] = [],
): Readiness {
  const hooper = hooperReadiness(current);
  let score = hooper;
  const notes: string[] = [];

  // Elevated resting HR vs personal baseline → lower readiness.
  const priorRhr = priors.map((p) => p.restingHr).filter((n): n is number => typeof n === "number");
  if (typeof current.restingHr === "number" && priorRhr.length >= 2) {
    const delta = current.restingHr - mean(priorRhr);
    if (delta > 1) {
      const penalty = Math.min(20, delta * 2);
      score -= penalty;
      notes.push(`resting HR +${Math.round(delta)} bpm vs baseline`);
    }
  }

  // HRV suppressed vs personal baseline → lower readiness.
  const priorHrv = priors.map((p) => p.hrv).filter((n): n is number => typeof n === "number");
  if (typeof current.hrv === "number" && priorHrv.length >= 2) {
    const base = mean(priorHrv);
    if (base > 0) {
      const drop = (base - current.hrv) / base;
      if (drop > 0.03) {
        const penalty = Math.min(20, clamp(drop, 0, 0.4) * 50);
        score -= penalty;
        notes.push(`HRV ${Math.round(drop * 100)}% below baseline`);
      }
    }
  }

  score = clamp(Math.round(score), 0, 100);
  return { score, category: categorize(score), hooperScore: hooper, note: notes.join("; ") };
}
