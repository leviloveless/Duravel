/**
 * General Fitness — an open-ended, no-race sport.
 *
 * Uses the shared volume currency (miles + cardio minutes) and the run/lift
 * primitives, but a `general_fitness` ProgramType: buildSkeleton routes it to
 * buildRotationSkeleton, which replaces Base→Build→Peak→Taper with a repeating
 * rotation of ~4-week emphasis blocks (strength → aerobic → mixed, sub-goal
 * biased), no taper, continuous rising volume. Cardio is delivered via runs
 * (easy Z2 + a weekly VO2 interval) plus the reconciler's Z1–2 block; strength
 * hits all 7 movement patterns. Emphasis maps to a synthetic phase so the
 * strength schemes, zone targets, and run-type selection all reuse the engine.
 */
import {
  ZONE_DEFINITIONS,
  RUN_GUIDANCE,
  LIFT_GUIDANCE,
} from "@/lib/ai/philosophy";
import type { PhaseName, ZoneDistribution } from "../types";
import type { SportConfig, ExperienceBand, NeedsDomainConfig } from "./types";

const RUNNING_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "can't yet run 30 min continuously (run/walk)" },
  { level: "intermediate", criterion: "comfortable with 5–10k / 30+ min continuous" },
  { level: "advanced", criterion: "established aerobic base, tolerates 2–3 quality sessions/wk" },
];
const LIFTING_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "under ~1 year of consistent progressive lifting" },
  { level: "intermediate", criterion: "1–3 years; progresses week-to-month" },
  { level: "advanced", criterion: "3+ years; progresses month-to-month, needs autoregulation" },
];

const NEEDS: NeedsDomainConfig[] = [
  { key: "run_engine", label: "aerobic fitness", scorerId: "run_engine", anchors: { male: [360, 720], female: [396, 792] }, weight: 1 },
  { key: "strength", label: "strength", scorerId: "strength", anchors: { male: [1.0, 2.25], female: [0.8, 1.8] }, weight: 1 },
];

// Emphasis → synthetic phase: aerobic=base, mixed=build, strength=peak.
const ZONES: Record<PhaseName, ZoneDistribution> = {
  base: { z1: 25, z2: 62, z3: 7, z4: 4, z5: 2 }, // aerobic block — base-heavy
  build: { z1: 20, z2: 55, z3: 12, z4: 8, z5: 5 }, // mixed block
  peak: { z1: 22, z2: 52, z3: 10, z4: 8, z5: 8 }, // strength block — less volume, keep a VO2 touch
  taper: { z1: 20, z2: 55, z3: 12, z4: 8, z5: 5 }, // unused (no taper)
};

const GF_GUIDANCE = `This is an open-ended general-fitness program with NO race to peak toward. Training rotates through ~4-week emphasis blocks (strength, aerobic, mixed) that repeat from a rising baseline; there is no taper. Each week's MESOCYCLE label reflects the current emphasis (aerobic → base, mixed → build, strength → peak). Fill cardio sessions as runs: mostly easy Zone 2 aerobic, with the phase's quality run (tempo/threshold or a VO2 interval session) — aim to keep roughly one genuine VO2max session per week (e.g. 4×4 min hard). There are NO hybrid/station sessions. Encourage the athlete to re-test key benchmarks (a time trial or estimated 1RMs) every ~8–10 weeks — the re-test replaces "the race" as the progress signal.`;

const PHASE_CHARACTER: Record<PhaseName, string> = {
  base: "Aerobic-emphasis block: build the aerobic base with mostly easy Zone 2 running and one weekly quality run; strength held at a maintenance dose (all patterns, moderate volume).",
  build: "Mixed-emphasis block: balanced strength + conditioning. Threshold/tempo and interval work alongside full strength sessions; moderate volume both silos.",
  peak: "Strength-emphasis block: lifting leads (heavier, all patterns); cardio trimmed to a maintenance dose with one VO2/interval session to keep the aerobic ceiling. Slightly lower total cardio volume.",
  taper: "Recovery/deload boundary between blocks.",
};

export const general_fitness: SportConfig = {
  id: "general_fitness",
  family: "general_fitness",
  displayName: "General Fitness",
  programType: "general_fitness",
  modalities: ["run", "lift", "rest"],
  sessionCounts: {
    // aerobic(base) most runs; mixed(build) moderate; strength(peak) fewer runs, more lifting.
    run: { base: [3, 4, 5], build: [3, 4, 4], peak: [2, 3, 3], taper: [2, 3, 3] },
    hybrid: { base: 0, build: 0, peak: 0, taper: 0 },
    lift: { base: 2, build: 3, peak: 3, taper: 2 },
  },
  runFloor: 2,
  phaseZoneTargets: ZONES,
  needsDomains: NEEDS,
  experienceAxes: [
    { key: "running", label: "Cardio / running", bands: RUNNING_BANDS, needsWeight: 1.0 },
    { key: "lifting", label: "Lifting", bands: LIFTING_BANDS, needsWeight: 1.0 },
  ],
  volume: { kind: "single_currency", startMileageByExp: { beginner: 10, intermediate: 18, advanced: 28 }, avgMinPerMile: 18 },
  philosophy: {
    coach: "expert strength & conditioning coach",
    guidance: [ZONE_DEFINITIONS, RUN_GUIDANCE, LIFT_GUIDANCE, GF_GUIDANCE],
    phaseCharacter: PHASE_CHARACTER,
    // no stationLibrary — general fitness has no hybrid/station work.
  },
};
