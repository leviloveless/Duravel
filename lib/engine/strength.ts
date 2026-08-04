/**
 * Periodized strength prescription (Review #4).
 *
 * Replaces the old flat model (full-body 5–7, upper/lower a fixed 12–15, a
 * static ~75–80% 5RM start, no plyometrics) with an evidence-based scheme:
 *
 *   - HEAVY, LOW-REP MAX STRENGTH drives the full-body day. Heavy strength +
 *     plyometrics improve running economy and delay fatigue far more than
 *     hypertrophy-rep work, and add little mass — which matters in a bodyweight-
 *     carrying 8 km event (Rønnestad & Mujika 2014; Blagrove 2018; Beattie 2017).
 *   - Upper/lower days run a MODERATE strength scheme (6–10 reps, dropping
 *     toward peak) — strength-biased, not the old hypertrophy 12–15.
 *   - The LUNGE pattern (HYROX sandbag lunges) keeps HIGH-REP MUSCULAR
 *     ENDURANCE — the one place high reps are sport-specific.
 *   - Load PROGRESSES across the microcycle (intensity climbs on increase weeks,
 *     backs off on deloads) and is autoregulated with an RIR (reps-in-reserve)
 *     target (Helms 2016), so it isn't a static number.
 *   - A PLYOMETRIC / reactive element is added in Base and Build for RFD and
 *     tendon stiffness → running economy (Barnes & Kilding 2015).
 *
 * Deterministic + pure (engine owns the math, like the running side); assembly
 * applies these schemes over whatever the AI returned so strength is auditable
 * and periodized rather than guessed.
 */

import type { z } from "zod";
import { MovementPattern, StrengthEmphasis as StrengthEmphasisEnum } from "@/lib/schemas";
import type { ExperienceLevel, MicroWeekType, PhaseName } from "./types";
import { clamp, round5, EPLEY_5RM_TO_1RM } from "./math";

// Derived from the canonical Zod enums (roadmap #2.5) — kills the LiftPattern /
// MovementPattern and StrengthEmphasis twins that were maintained by hand.
export type LiftPattern = z.infer<typeof MovementPattern>;
export type StrengthEmphasis = z.infer<typeof StrengthEmphasisEnum>;

export type LiftType = "upper" | "lower" | "full" | "power";

export interface MovementScheme {
  sets: number;
  repRange: string;
  intensityPct: number; // target % of 1RM
  rir: number; // reps in reserve (autoregulation cue)
  emphasis: StrengthEmphasis;
}

interface SchemeBase {
  sets: number;
  repRange: string;
  intensityPct: number;
  rir: number;
}

/** Heavy, low-rep max strength — the full-body day (economy driver). */
const MAX_STRENGTH: Record<PhaseName, SchemeBase> = {
  base: { sets: 4, repRange: "5-6", intensityPct: 78, rir: 3 },
  build: { sets: 4, repRange: "4-5", intensityPct: 83, rir: 2 },
  peak: { sets: 5, repRange: "3", intensityPct: 88, rir: 1 },
  taper: { sets: 3, repRange: "3", intensityPct: 85, rir: 2 },
};

/** Moderate strength — upper/lower compound work (reps drop toward peak). */
const STRENGTH: Record<PhaseName, SchemeBase> = {
  base: { sets: 3, repRange: "8-10", intensityPct: 70, rir: 3 },
  build: { sets: 3, repRange: "6-8", intensityPct: 75, rir: 2 },
  peak: { sets: 3, repRange: "5-6", intensityPct: 80, rir: 2 },
  taper: { sets: 2, repRange: "5-6", intensityPct: 78, rir: 2 },
};

/**
 * LIGHT full-body day (Levi, 2026-08-04). When a week carries more than one
 * full-body lift, the LATER one runs light — 12–15 reps at a submaximal load —
 * so the athlete isn't asked for two maximal-strength efforts in the same week
 * on top of the running. Heavy first while fresh, light second.
 */
const LIGHT_FULL: Record<PhaseName, SchemeBase> = {
  base: { sets: 3, repRange: "12-15", intensityPct: 58, rir: 3 },
  build: { sets: 3, repRange: "12-15", intensityPct: 60, rir: 3 },
  peak: { sets: 3, repRange: "12-15", intensityPct: 55, rir: 3 },
  taper: { sets: 2, repRange: "12-15", intensityPct: 50, rir: 3 },
};

/** High-rep muscular endurance — the lunge pattern (HYROX sandbag lunges). */
const ENDURANCE: Record<PhaseName, SchemeBase> = {
  base: { sets: 3, repRange: "15", intensityPct: 55, rir: 3 },
  build: { sets: 3, repRange: "18", intensityPct: 55, rir: 2 },
  peak: { sets: 3, repRange: "20", intensityPct: 50, rir: 2 },
  taper: { sets: 2, repRange: "12", intensityPct: 50, rir: 3 },
};

/** Per-microcycle-week intensity delta (%1RM) — real load progression. */
const MICRO_INTENSITY_DELTA: Record<MicroWeekType, number> = {
  increase: 2,
  rebound: 0,
  deload: -6,
  taper: -3,
  race: -3,
};

/** Intensity ceilings by emphasis so autoregulation stays safe. */
const PCT_CAP: Record<StrengthEmphasis, number> = {
  max_strength: 90,
  strength: 85,
  endurance: 60,
};
const PCT_FLOOR = 45;

/**
 * The lunge is the one HYROX-specific muscular-endurance pattern. A LIGHT
 * full-body day is muscular-endurance work throughout — 12–15 reps at a
 * submaximal load — so every pattern on it carries the endurance emphasis (which
 * is also what caps its intensity sensibly).
 */
export function patternEmphasis(
  pattern: LiftPattern,
  liftType: LiftType,
  light = false,
): StrengthEmphasis {
  if (light) return "endurance";
  if (pattern === "lunge") return "endurance";
  return liftType === "full" || liftType === "power" ? "max_strength" : "strength";
}

function baseScheme(emphasis: StrengthEmphasis, phase: PhaseName, light: boolean): SchemeBase {
  if (light) return LIGHT_FULL[phase];
  if (emphasis === "endurance") return ENDURANCE[phase];
  if (emphasis === "max_strength") return MAX_STRENGTH[phase];
  return STRENGTH[phase];
}

/**
 * The prescription for one movement given its pattern, the session's lift type,
 * and the week's phase + microcycle position.
 *
 * `light` marks the week's SECOND full-body session (see `LIGHT_FULL`): every
 * movement on it drops to 12–15 reps at a submaximal load. The `sets` returned
 * here are the per-session starting point — `applyStrengthSchemes` then rewrites
 * them so the WEEKLY total per pattern matches the athlete's target
 * (`weeklySetTarget`).
 */
export function movementScheme(
  pattern: LiftPattern,
  liftType: LiftType,
  phase: PhaseName,
  microWeek: MicroWeekType,
  light = false,
): MovementScheme {
  const emphasis = patternEmphasis(pattern, liftType, light);
  const b = baseScheme(emphasis, phase, light);
  const intensityPct = clamp(
    b.intensityPct + (MICRO_INTENSITY_DELTA[microWeek] ?? 0),
    PCT_FLOOR,
    PCT_CAP[emphasis],
  );
  return { sets: b.sets, repRange: b.repRange, intensityPct, rir: b.rir, emphasis };
}

// --- weekly working-set volume per pattern -----------------------------------
//
// Levi's rule (2026-08-04): weekly WORKING SETS per muscle / movement pattern are
// set by the athlete's LIFTING experience, not by the phase's per-session scheme.
// The per-session numbers above are a starting point; what the athlete actually
// accumulates over the week is what drives hypertrophy/strength adaptation, so the
// week is the unit that gets controlled.

/** Weekly working sets per movement pattern, by lifting experience. */
export const WEEKLY_SETS_PER_PATTERN: Record<ExperienceLevel, number> = {
  beginner: 6,
  intermediate: 8,
  advanced: 10,
};

/**
 * Recovery weeks carry a fraction of the target — a deload that kept full volume
 * would not be a deload. Intensity is handled separately by
 * `MICRO_INTENSITY_DELTA`; this is the volume side of the same idea.
 */
const WEEKLY_SET_FACTOR: Record<MicroWeekType, number> = {
  increase: 1,
  rebound: 1,
  deload: 0.6,
  taper: 0.5,
  race: 0.5,
};

/** Weekly working sets per pattern for this athlete in this microcycle week. */
export function weeklySetTarget(liftingExp: ExperienceLevel, microWeek: MicroWeekType): number {
  const base = WEEKLY_SETS_PER_PATTERN[liftingExp] ?? WEEKLY_SETS_PER_PATTERN.intermediate;
  return Math.max(1, Math.round(base * (WEEKLY_SET_FACTOR[microWeek] ?? 1)));
}

/**
 * Split a weekly set target across the sessions that train the pattern, in
 * calendar order. The remainder goes to the EARLIER sessions, which are the
 * heavier ones (the light full-body day is always the later one), so the extra
 * set lands on the quality work.
 *
 * Every session that trains a pattern gets at least one set — if a week somehow
 * trains a pattern more times than the target has sets to give, the weekly total
 * overshoots rather than prescribing a zero-set movement.
 */
export function splitWeeklySets(target: number, occurrences: number): number[] {
  if (occurrences <= 0) return [];
  const base = Math.floor(target / occurrences);
  const remainder = target % occurrences;
  return Array.from({ length: occurrences }, (_, i) => Math.max(1, base + (i < remainder ? 1 : 0)));
}

// --- A/B exercise variation (Tasks #10) --------------------------------------
//
// Each movement PATTERN carries two interchangeable exercise variants — an "A"
// and a "B". The engine alternates them by week so the athlete isn't grinding
// the identical lift every session (a common overuse driver); both variants
// train the same pattern with slightly different mechanics, so periodization and
// emphasis are unchanged. Variant A on odd program weeks, B on even.

export type ABExercise = readonly [a: string, b: string];

/** A (odd weeks) / B (even weeks) exercise per movement pattern. */
export const EXERCISE_AB: Record<LiftPattern, ABExercise> = {
  squat: ["Back Squat", "Front Squat"],
  hip_hinge: ["Conventional Deadlift", "Romanian Deadlift"],
  lunge: ["Walking Lunge", "Reverse Lunge"],
  horizontal_press: ["Barbell Bench Press", "Dumbbell Bench Press"],
  vertical_press: ["Standing Overhead Press", "Push Press"],
  horizontal_pull: ["Barbell Bent-Over Row", "Chest-Supported Row"],
  vertical_pull: ["Pull-Up", "Lat Pulldown"],
};

/**
 * The specific exercise for a pattern on a given program week. Odd weeks → the A
 * variant, even weeks → B, so consecutive weeks never repeat the same exercise
 * for a pattern. Falls back to a spaced pattern name if a pattern is ever missing
 * from the library (defensive; the record is exhaustive today).
 */
export function pickExercise(pattern: LiftPattern, weekNumber: number): string {
  const pair = EXERCISE_AB[pattern];
  if (!pair) return pattern.replace(/_/g, " ");
  return weekNumber % 2 === 1 ? pair[0] : pair[1];
}

// --- suggested working weight from a 5RM benchmark ---------------------------

/** Which 5RM benchmark (if any) maps to a movement pattern. */
export function benchmarkForPattern(
  pattern: LiftPattern,
  benchmarks?: { fiveRmSquat?: number; fiveRmDeadlift?: number; fiveRmBench?: number },
): number | undefined {
  if (!benchmarks) return undefined;
  if (pattern === "squat") return benchmarks.fiveRmSquat;
  if (pattern === "hip_hinge") return benchmarks.fiveRmDeadlift;
  if (pattern === "horizontal_press") return benchmarks.fiveRmBench;
  return undefined;
}

/**
 * Build the suggestedWeight string. With a mapped 5RM benchmark it gives an
 * absolute working weight at the scheme intensity; otherwise a %1RM + RIR cue.
 */
export function suggestedWeight(
  scheme: MovementScheme,
  pattern: LiftPattern,
  benchmarks?: { fiveRmSquat?: number; fiveRmDeadlift?: number; fiveRmBench?: number },
  weightUnit: "lbs" | "kg" = "lbs",
): string {
  const cue = `~${scheme.intensityPct}% 1RM · ${scheme.rir} RIR`;
  const fiveRm = benchmarkForPattern(pattern, benchmarks);
  if (fiveRm && fiveRm > 0) {
    const oneRm = fiveRm * EPLEY_5RM_TO_1RM;
    const w = round5((oneRm * scheme.intensityPct) / 100);
    return `${w} ${weightUnit} (${cue})`;
  }
  return cue;
}

// --- plyometric / reactive element ------------------------------------------

export interface PowerElement {
  exercise: string;
  sets: number;
  reps: string;
  note: string;
}

const POWER_NOTE =
  "Explosive intent with full recovery between sets — this trains rate of force development and running economy, not fatigue.";

/** Plyometric options by phase (Base/Build only). */
const POWER_LIB: Partial<Record<PhaseName, string[]>> = {
  base: ["box jumps", "broad jumps", "pogo hops", "med-ball chest pass"],
  build: ["depth jumps", "broad jumps", "box jumps", "med-ball rotational throw"],
  // Peak/Taper are used only by a forced power session (low-volume, sharpening).
  peak: ["depth jumps", "broad jumps", "pogo hops"],
  taper: ["pogo hops", "box jumps"],
};

/** Plyometric volume by phase. */
const POWER_VOLUME: Partial<Record<PhaseName, { sets: number; reps: string }>> = {
  base: { sets: 4, reps: "3" },
  build: { sets: 5, reps: "3" },
  peak: { sets: 3, reps: "3" },
  taper: { sets: 2, reps: "3" },
};

/**
 * A plyometric/reactive element for a lift session, or null. Programmed in Base
 * and Build only (economy/RFD development); Peak and Taper stay race-specific.
 * `sessionIndex` rotates the exercise across the week's lift sessions.
 */
export function powerElementFor(
  phase: PhaseName,
  microWeek: MicroWeekType,
  sessionIndex: number,
  force = false,
): PowerElement | null {
  // Recovery weeks never carry plyometrics, even a forced power session.
  if (microWeek === "deload" || microWeek === "race") return null;
  // Legacy (non-forced): plyometrics live in Base/Build only. A forced power
  // session (research power-focus liftType) keeps them through Peak and Taper.
  if (!force && (microWeek === "taper" || phase === "peak" || phase === "taper")) return null;
  const lib = POWER_LIB[phase];
  const vol = POWER_VOLUME[phase];
  if (!lib || !vol) return null;
  const exercise = lib[((sessionIndex % lib.length) + lib.length) % lib.length]!; // safe: index normalized into [0, lib.length) and POWER_LIB entries are non-empty
  return { exercise, sets: vol.sets, reps: vol.reps, note: POWER_NOTE };
}
