/**
 * Canonical run-workout descriptions (Tasks #2, #3, #4, #5).
 *
 * Every run session carries a short (1–2 sentence) explanation of what the run
 * is and how to execute it. These are attached deterministically during
 * assembly — not left to the AI — so the exact coaching protocol the athlete
 * expects is always shown, regardless of the generated paces/distances.
 *
 * Progression runs read differently by running experience (Tasks #4):
 * beginners get a simpler two-effort build; intermediate/advanced runners get
 * the three-block build.
 */

import type { ExperienceLevel, RunType } from "./types";

const PROGRESSION_BEGINNER =
  "A steady run that gradually builds effort. Warm up 10 minutes easy and conversational, run 20–30 minutes at your standard comfortable aerobic pace (1–2 min/mile faster than easy), pick up to a comfortably hard threshold effort for the final 10–15%, then cool down 5 minutes easy.";

const PROGRESSION_ADVANCED =
  "A three-block progression that finishes hard. Warm up 5 minutes easy, then run 20 minutes at easy/warm-up pace, 20 minutes at marathon or half-marathon race pace, and 20 minutes at a comfortably hard tempo (threshold) effort, finishing with a 5-minute easy cool-down.";

/** Descriptions that don't vary by experience. */
const RUN_DESCRIPTIONS: Record<Exclude<RunType, "progression">, string> = {
  easy:
    "Easy, conversational-pace aerobic running in Zone 1–2 that builds and maintains your aerobic base. Keep it relaxed enough to talk in full sentences the whole way.",
  long:
    "Start in Zone 1–2 and let your heart rate drift up — due to cardiac drift — toward the top of Zone 3 by the end of a 75–90 minute effort, without pushing into Zone 4.",
  fartlek:
    "Fartlek runs can be run by feel or on time. Warm up 1–2 miles easy, then run descending intervals — 8, 7, 6, 5, 4, 3, 2, then 1 minute — at RPE 5 (~10–15K pace), each followed by a 1.5-minute easy jog, and cool down 1–2 miles easy.",
  tempo:
    "A sustained Zone 3–4 effort at roughly half-marathon pace (~80–90% max HR) for 20–35 continuous minutes. Comfortably hard but controlled — hold the pace steady rather than surging.",
  threshold:
    "Zone 4 running at true lactate threshold — 'comfortably hard,' about 20–30 sec/mile slower than 5K pace. The primary quality run of the peak phase, it lifts the pace you can sustain on race day.",
  interval:
    "Warm up with a 5-minute easy jog, then run 6–8 rounds of 800m at your interval pace (about your 5K pace or a touch faster) with a 1-minute slow jog recovery between reps, and finish with a 5-minute easy walk cool-down.",
  hybrid_run:
    "A threshold-pace (Zone 4) run performed inside a hybrid session, alternating with HYROX stations. Run it at the same controlled, hard effort you'd hold on the HYROX course.",
};

/**
 * The description for a run of the given type. Progression runs vary by running
 * experience; every other type is fixed.
 */
export function runDescription(runType: RunType, runningExp: ExperienceLevel): string {
  if (runType === "progression") {
    return runningExp === "beginner" ? PROGRESSION_BEGINNER : PROGRESSION_ADVANCED;
  }
  return RUN_DESCRIPTIONS[runType];
}

/**
 * Hybrid (HYROX) session explanation: what "compromised running" is, why it is
 * programmed, and how these station-to-run sessions build it. Attached to every
 * hybrid session during assembly so the athlete always sees the rationale for
 * running straight off a weighted/erg station.
 */
export function hybridDescription(): string {
  return "This is your compromised-running work. In a HYROX race you run on legs already fatigued by the weighted stations (sled, lunges, wall balls, ergs); running well in that pre-fatigued state is called \"compromised running,\" and it is what decides your finish. By alternating threshold-pace runs with stations here, you train your body to hold pace when your legs are cooked, so your race-day running does not fall apart. Your weekly long run stays a separate, straightforward aerobic long run -- the compromised running is built here, in the hybrid sessions.";
}
