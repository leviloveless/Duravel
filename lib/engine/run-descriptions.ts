/**
 * Canonical run-workout descriptions (Tasks #2, #3, #4, #5).
 *
 * Every run session carries a short explanation of what the run is and how to
 * execute it. These are attached deterministically during assembly — not left
 * to the AI — so the exact coaching protocol the athlete expects is always
 * shown, regardless of the generated paces/distances.
 *
 * Quality runs read differently by running experience: the progression build
 * (Tasks #4) and the interval (VO2max) and threshold (lactate-threshold)
 * sessions scale rep count/length by level. Recovery is prescribed as a
 * work:rest RATIO — interval 1:1, threshold 2:1 — rather than a fixed number of
 * seconds, so the rest scales to the athlete's own pace: a fast 1000m and a slow
 * 1000m earn the same physiological stimulus, not the same stopwatch.
 */

import type { ExperienceLevel, RunType } from "./types";

const PROGRESSION_BEGINNER =
  "A steady run that gradually builds effort. Warm up 10 minutes easy and conversational, run 20–30 minutes at your standard comfortable aerobic pace (1–2 min/mile faster than easy), pick up to a comfortably hard threshold effort for the final 10–15%, then cool down 5 minutes easy.";

const PROGRESSION_ADVANCED =
  "A three-block progression that finishes hard. Warm up 5 minutes easy, then run 20 minutes at easy/warm-up pace, 20 minutes at marathon or half-marathon race pace, and 20 minutes at a comfortably hard tempo (threshold) effort, finishing with a 5-minute easy cool-down.";

// --- Interval (VO2max, I-pace): 1:1 work:rest, reps 2–4 min ---
const INTERVAL_BEGINNER =
  "A VO2max session that builds your aerobic ceiling. Warm up 1 mile easy (10–15 min) with 3–4 short strides, then run 4 × ~800m at your interval (I) pace — each rep should take about 2–3 minutes, the VO2max window. Recover with an easy jog EQUAL in time to the rep you just ran (a 1:1 work:rest ratio), so your rest scales to your own speed rather than a fixed clock. Cool down 1 mile easy, and keep every rep the same controlled ~5K effort — repeatable speed, not an all-out.";

const INTERVAL_INTERMEDIATE =
  "A VO2max session at the classic 1000m rep. Warm up 1.5 miles easy with drills and 4 × 20-second strides, then run 5 × 1000m at your interval (I) pace (each about 3–4 minutes) with an easy jog recovery EQUAL in time to each rep — a 1:1 work:rest ratio. That 1:1 rest is the point: a 3-minute rep earns 3 minutes of jog and a 4-minute rep earns 4, so runners of different speeds get the same session rather than the same stopwatch. Cool down 1–1.5 miles easy; if your 1000m falls outside ~3–4 minutes, adjust the rep length to stay in the VO2max window.";

const INTERVAL_ADVANCED =
  "A full VO2max session. Warm up 2 miles easy with drills and strides, then run 6 × 1000m at your interval (I) pace with an easy jog recovery EQUAL in time to each rep — a strict 1:1 work:rest ratio. Because the rest scales with your rep time, resist shortening it: the 1:1 ratio is what keeps this a VO2max stimulus instead of a lactate grind. Cool down 1.5–2 miles easy, and hold vVO2max on every rep — the session is won on reps 5–6, so bank nothing early.";

// --- Threshold (lactate threshold, T-pace): 2:1 work:rest, reps 5+ min ---
const THRESHOLD_BEGINNER =
  "A threshold session that raises the pace you can hold before lactate accumulates — the biggest single lever for HYROX and 5K-to-half fitness. Warm up 1 mile easy, then run 2 × 1 mile at your threshold (T) pace: 'comfortably hard,' able to say only a few words at a time. Recover between reps with an easy jog HALF as long as the rep took (a 2:1 work:rest ratio), so the rest scales to your pace. Cool down 1 mile easy — and if it feels like 5K racing, ease off; threshold is a controlled, repeatable hard.";

const THRESHOLD_INTERMEDIATE =
  "More time at lactate threshold. Warm up 1.5 miles easy with a few strides, then run 3 × 1 mile at your threshold (T) pace, each followed by an easy jog HALF the length of the rep — a 2:1 work:rest ratio. The short 2:1 recovery keeps blood lactate near the threshold 'tipping point' for the whole session, but scaled to your speed rather than a fixed 60 seconds that would punish a slower runner and coddle a faster one. Cool down 1 mile easy, holding the same comfortably-hard pace on every mile.";

const THRESHOLD_ADVANCED =
  "A peak-phase threshold dose. Warm up 2 miles easy with drills and strides, then run 4 × 1 mile (or 2 × 2 miles) at your threshold (T) pace, each followed by an easy jog HALF the length of the rep — a 2:1 work:rest ratio. Long work phases held at a 2:1 ratio push your lactate-clearance capacity hard. Cool down 1.5–2 miles easy; on race-specific weeks, run the final rep at goal HYROX run pace to rehearse holding threshold on tired legs.";

/** Quality runs whose protocol scales with running experience. */
const BY_EXPERIENCE: Partial<Record<RunType, Record<ExperienceLevel, string>>> = {
  progression: {
    beginner: PROGRESSION_BEGINNER,
    intermediate: PROGRESSION_ADVANCED,
    advanced: PROGRESSION_ADVANCED,
  },
  interval: {
    beginner: INTERVAL_BEGINNER,
    intermediate: INTERVAL_INTERMEDIATE,
    advanced: INTERVAL_ADVANCED,
  },
  threshold: {
    beginner: THRESHOLD_BEGINNER,
    intermediate: THRESHOLD_INTERMEDIATE,
    advanced: THRESHOLD_ADVANCED,
  },
};

/** Descriptions that don't vary by experience. */
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

/**
 * The description for a run of the given type. Progression, interval, and
 * threshold runs vary by running experience; every other type is fixed.
 */
export function runDescription(runType: RunType, runningExp: ExperienceLevel): string {
  const varied = BY_EXPERIENCE[runType];
  if (varied) return varied[runningExp];
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
