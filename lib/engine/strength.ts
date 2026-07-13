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
import type { MicroWeekType, PhaseName } from "./types";
import { clamp, round5, EPLEY_5RM_TO_1RM } from "./math";

// Derived from the canonical Zod enums (roadmap #2.5) — kills the LiftPattern /
// MovementPattern and StrengthEmphasis twins that were maintained by hand.
export type LiftPattern = z.infer<typeof MovementPattern>;
export type StrengthEmphasis = z.infer<typeof StrengthEmphasisEnum>;

export type LiftType = "upper" | "lower" | "full";

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

/** The lunge is the one HYROX-specific muscular-endurance pattern. */
export function patternEmphasis(pattern: LiftPattern, liftType: LiftType): StrengthEmphasis {
  if (pattern === "lunge") return "endurance";
  return liftType === "full" ? "max_strength" : "strength";
}

function baseScheme(emphasis: StrengthEmphasis, phase: PhaseName): SchemeBase {
  if (emphasis === "endurance") return ENDURANCE[phase];
  if (emphasis === "max_strength") return MAX_STRENGTH[phase];
  return STRENGTH[phase];
}

/**
 * The prescription for one movement given its pattern, the session's lift type,
 * and the week's phase + microcycle position.
 */
export function movementScheme(
  pattern: LiftPattern,
  liftType: LiftType,
  phase: PhaseName,
  microWeek: MicroWeekType,
): MovementScheme {
  const emphasis = patternEmphasis(pattern, liftType);
  const b = baseScheme(emphasis, phase);
  const intensityPct = clamp(
    b.intensityPct + (MICRO_INTENSITY_DELTA[microWeek] ?? 0),
    PCT_FLOOR,
    PCT_CAP[emphasis],
  );
  return { sets: b.sets, repRange: b.repRange, intensityPct, rir: b.rir, emphasis };
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
};

/** Plyometric volume by phase. */
const POWER_VOLUME: Partial<Record<PhaseName, { sets: number; reps: string }>> = {
  base: { sets: 4, reps: "3" },
  build: { sets: 5, reps: "3" },
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
): PowerElement | null {
  if (microWeek === "deload" || microWeek === "taper" || microWeek === "race") return null;
  const lib = POWER_LIB[phase];
  const vol = POWER_VOLUME[phase];
  if (!lib || !vol) return null;
  const exercise = lib[((sessionIndex % lib.length) + lib.length) % lib.length]!; // safe: index normalized into [0, lib.length) and POWER_LIB entries are non-empty
  return { exercise, sets: vol.sets, reps: vol.reps, note: POWER_NOTE };
}
