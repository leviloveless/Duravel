/**
 * Shared numeric helpers + physical constants for the engine (roadmap #2.4).
 *
 * These were previously re-declared in ~12 files (round1/round2/round5, clamp,
 * METERS_PER_MILE, the Epley factor, 5K/10K distances), which risked silent
 * divergence if one copy were ever tuned. This is the single source of truth.
 * Implementations are byte-for-byte identical to the copies they replace.
 */

export const METERS_PER_MILE = 1609.34;
export const MILE_M = METERS_PER_MILE;
export const FIVE_K_M = 5000;
export const TEN_K_M = 10000;
export const FIVE_K_MILES = FIVE_K_M / METERS_PER_MILE; // ≈ 3.10686
export const TEN_K_MILES = TEN_K_M / METERS_PER_MILE;

/** Epley 5RM→1RM factor (1 + reps/30 at 5 reps) ≈ 1.1667. */
export const EPLEY_5RM_TO_1RM = 1 + 5 / 30;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round5(n: number): number {
  return Math.round(n / 5) * 5;
}
