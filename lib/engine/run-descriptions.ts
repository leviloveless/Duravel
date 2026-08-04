/**
 * Canonical run-workout descriptions (Tasks #2, #3, #4, #5).
 *
 * Every run session carries a short, literal how-to (warmup / work / cooldown /
 * ratio) attached deterministically during assembly. Interval and threshold
 * sessions are built from the athlete's VDOT paces so the work reps show pace in
 * min/mi AND min/km plus a concrete rest time derived from that pace (interval
 * 1:1, threshold 2:1). The longer "why this workout" narrative lives in the
 * program glossary / science pages, not here.
 */

import type { ExperienceLevel, RunType } from "./types";
import { formatPace, METERS_PER_MILE, type RunPaces } from "./paces";
import { RUN_WARMUP_COOLDOWN } from "@/lib/session-volume";

const PROGRESSION_BEGINNER =
  "A steady run that gradually builds effort. Warm up 10 minutes easy and conversational, run 20–30 minutes at your standard comfortable aerobic pace (1–2 min/mile faster than easy), pick up to a comfortably hard threshold effort for the final 10–15%, then cool down 5 minutes easy.";

const PROGRESSION_ADVANCED =
  "A three-block progression that finishes hard. Warm up 5 minutes easy, then run 20 minutes at easy/warm-up pace, 20 minutes at marathon or half-marathon race pace, and 20 minutes at a comfortably hard tempo (threshold) effort, finishing with a 5-minute easy cool-down.";

/** Descriptions that don't vary by experience or pace. */
const RUN_DESCRIPTIONS: Record<
  Exclude<RunType, "progression" | "interval" | "threshold">,
  string
> = {
  easy: "Easy, conversational-pace aerobic running in Zone 1–2 that builds and maintains your aerobic base. Keep it relaxed enough to talk in full sentences the whole way.",
  long: "Start in Zone 1–2 and let your heart rate drift up — due to cardiac drift — toward the top of Zone 3 by the end of a 75–90 minute effort, without pushing into Zone 4.",
  fartlek:
    "Fartlek runs can be run by feel or on time. Warm up 1–2 miles easy, then run descending intervals — 8, 7, 6, 5, 4, 3, 2, then 1 minute — at RPE 5 (~10–15K pace), each followed by a 1.5-minute easy jog, and cool down 1–2 miles easy.",
  tempo:
    "A sustained Zone 3–4 effort at roughly half-marathon pace (~80–90% max HR) for 20–35 continuous minutes. Comfortably hard but controlled — hold the pace steady rather than surging.",
  hybrid_run:
    "A threshold-pace (Zone 4) run performed inside a hybrid session, alternating with HYROX stations. Run it at the same controlled, hard effort you'd hold on the HYROX course.",
};

const KM_PER_MILE = METERS_PER_MILE / 1000;
/** Seconds per km from seconds per mile. */
function secPerKm(secPerMile: number): number {
  return secPerMile / KM_PER_MILE;
}
/** Round a duration to the nearest 5 seconds (clean rest prescriptions). */
function roundTo5(sec: number): number {
  return Math.round(sec / 5) * 5;
}
/** "8:07/mi (5:02/km)" from a seconds-per-mile pace. */
function pacePair(secPerMile: number): string {
  return `${formatPace(secPerMile)}/mi (${formatPace(secPerKm(secPerMile))}/km)`;
}

/**
 * Warmup / cooldown lines that state the MINUTES, the distance those minutes cover
 * at easy pace, and the pace itself — e.g. "Warm up: 15 min easy (~1.4 mi) @
 * 10:39/mi". Minutes are the source of truth (session timing has always been built
 * on them); the distance is derived so the athlete can measure it either way, and
 * the pace is stated because "easy" on its own is not a prescription.
 */
function overheadLine(label: string, minutes: number, paces: RunPaces | null, extra = ""): string {
  if (!paces) return `${label}: ${minutes} min easy${extra}`;
  const easySecPerMile = paces.easy;
  const miles = Math.round((minutes / (easySecPerMile / 60)) * 10) / 10;
  return `${label}: ${minutes} min easy (~${miles} mi) @ ${formatPace(easySecPerMile)}/mi${extra}`;
}

/** Reps per session by running experience. */
const INTERVAL_REPS: Record<ExperienceLevel, number> = {
  beginner: 4,
  intermediate: 5,
  advanced: 6,
};
const THRESHOLD_REPS: Record<ExperienceLevel, number> = {
  beginner: 2,
  intermediate: 3,
  advanced: 4,
};

/** Interval (VO2max) how-to: N × 1km at I-pace, 1:1 rest (= the 1km work time). */
function intervalDescription(
  exp: ExperienceLevel,
  paces: RunPaces | null,
  repsOverride?: number,
): string {
  const reps = repsOverride ?? INTERVAL_REPS[exp];
  const work = paces
    ? `${reps} x 1km at ${pacePair(paces.interval)}, with ${formatPace(roundTo5(secPerKm(paces.interval)))} of easy JOGGING between reps at ${formatPace(paces.easy)}/mi (jog, not walk — keep moving so your heart rate stays up)`
    : `${reps} x 1km at your interval (I) pace with an equal-time easy jog/rest between reps`;
  const [wu, cd] = RUN_WARMUP_COOLDOWN.interval;
  return [
    overheadLine("Warm up", wu, paces, " with 3-4 short strides"),
    `Work: ${work}`,
    overheadLine("Cooldown", cd, paces),
    "Work:rest 1:1 - your rest equals your work time.",
  ].join("\n");
}

/** Threshold how-to: N × 1 mile at T-pace, 2:1 rest (= half the 1-mile work time). */
function thresholdDescription(
  exp: ExperienceLevel,
  paces: RunPaces | null,
  repsOverride?: number,
): string {
  const reps = repsOverride ?? THRESHOLD_REPS[exp];
  const work = paces
    ? `${reps} x 1 mile at ${pacePair(paces.threshold)}, with ${formatPace(roundTo5(paces.threshold / 2))} of easy JOGGING between reps at ${formatPace(paces.easy)}/mi (jog, not walk — keep moving so your heart rate stays up)`
    : `${reps} x 1 mile at your threshold (T) pace with an easy jog half the rep time between reps`;
  const [wu, cd] = RUN_WARMUP_COOLDOWN.threshold;
  return [
    overheadLine("Warm up", wu, paces),
    `Work: ${work}`,
    overheadLine("Cooldown", cd, paces),
    "Work:rest 2:1 - your rest is half your work time.",
  ].join("\n");
}

/**
 * The description for a run of the given type. Interval and threshold are built
 * from the athlete's paces (min/mi + min/km + a derived rest time); progression
 * varies by experience; every other type is a fixed string.
 */
export function runDescription(
  runType: RunType,
  runningExp: ExperienceLevel,
  paces: RunPaces | null = null,
  reps?: number,
): string {
  if (runType === "interval") return intervalDescription(runningExp, paces, reps);
  if (runType === "threshold") return thresholdDescription(runningExp, paces, reps);
  if (runType === "progression") {
    return runningExp === "beginner" ? PROGRESSION_BEGINNER : PROGRESSION_ADVANCED;
  }
  return RUN_DESCRIPTIONS[runType as Exclude<RunType, "progression" | "interval" | "threshold">];
}

/**
 * Hybrid (HYROX) session explanation: what "compromised running" is, why it is
 * programmed, and how these station-to-run sessions build it. Attached to every
 * hybrid session during assembly so the athlete always sees the rationale for
 * running straight off a weighted/erg station.
 */
export function hybridDescription(): string {
  return 'This is your compromised-running work. In a HYROX race you run on legs already fatigued by the weighted stations (sled, lunges, wall balls, ergs); running well in that pre-fatigued state is called "compromised running," and it is what decides your finish. By alternating threshold-pace runs with stations here, you train your body to hold pace when your legs are cooked, so your race-day running does not fall apart. Your weekly long run stays a separate, straightforward aerobic long run -- the compromised running is built here, in the hybrid sessions.';
}
