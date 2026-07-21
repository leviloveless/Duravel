/**
 * Triathlon — Ironman 70.3 and 140.6 (SportConfig registry entries).
 *
 * The deterministic periodized engine for these sports lives in
 * `lib/engine/ironman` — this file now holds ONLY the DATA registry entries
 * (`tri_70_3` / `tri_140_6` + `TRI_SPORTS`), the band / needs / zone / count
 * tables those configs reference, and the per-discipline level-detection helpers
 * (`swimLevelFromCss` / `bikeLevelFromFtp`) that the skeleton adapter imports.
 *
 * The engine functions are RE-EXPORTED from ironman at the bottom so every
 * existing import site (`@/lib/engine/sports/triathlon`) keeps working. The
 * dependency runs one-way: this file → ironman, never ironman → this file.
 *
 * Values from docs/future-phases/17 + research-triathlon (Friel/MyProCoach/
 * TrainingPeaks/Seiler). Distinguishes 70.3 from 140.6 throughout.
 */
import { parseTimeToSeconds } from "../paces";
import type { PhaseName, ZoneDistribution } from "../types";
import type { SportConfig, ExperienceBand, NeedsDomainConfig, PhaseCountTable } from "./types";

// --- shared bands / needs ---------------------------------------------------

const SWIM_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "can't swim the race distance continuously, or CSS slower than 2:00/100m" },
  { level: "intermediate", criterion: "swims the distance continuously; CSS 1:35–2:00/100m" },
  { level: "advanced", criterion: "CSS faster than 1:35/100m; races the swim, open-water comfortable" },
];
const BIKE_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "FTP under 2.9 W/kg (M) / 2.4 (F); can't hold aero long" },
  { level: "intermediate", criterion: "FTP 2.9–3.6 (M) / 2.4–3.0 (F) W/kg; holds aero most of the race" },
  { level: "advanced", criterion: "FTP over 3.6 (M) / 3.0 (F) W/kg; holds target power in aero" },
];
const RUN_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "threshold slower than 5:30/km, or can't run the distance off the bike" },
  { level: "intermediate", criterion: "threshold 4:30–5:30/km; runs the distance off the bike" },
  { level: "advanced", criterion: "threshold faster than 4:30/km; runs strong off the bike" },
];

const NEEDS: NeedsDomainConfig[] = [
  { key: "swim", label: "swim", scorerId: "swim", anchors: { male: [80, 160], female: [90, 175] }, weight: 1 },
  { key: "bike", label: "bike", scorerId: "bike", anchors: { male: [2.4, 4.2], female: [2.0, 3.6] }, weight: 1 },
  { key: "run", label: "run", scorerId: "run_engine", anchors: { male: [270, 360], female: [297, 396] }, weight: 1 },
];

const ZONES = (
  b: ZoneDistribution,
  bu: ZoneDistribution,
  p: ZoneDistribution,
  t: ZoneDistribution,
): Record<PhaseName, ZoneDistribution> => ({ base: b, build: bu, peak: p, taper: t });

// Endurance-sport distributions: base-heavy (polarized), pyramidal-leaning in build/peak.
const TRI_ZONES = ZONES(
  { z1: 25, z2: 63, z3: 7, z4: 3, z5: 2 },
  { z1: 20, z2: 60, z3: 12, z4: 6, z5: 2 },
  { z1: 16, z2: 58, z3: 15, z4: 8, z5: 3 },
  { z1: 20, z2: 60, z3: 12, z4: 6, z5: 2 },
);

// Discipline balance (share of weekly time) by phase — bike-heavy, bike peaks in build.
type Balance = { swim: number; bike: number; run: number };
const BALANCE: Record<PhaseName, Balance> = {
  base: { swim: 0.25, bike: 0.45, run: 0.3 },
  build: { swim: 0.2, bike: 0.52, run: 0.28 },
  peak: { swim: 0.18, bike: 0.5, run: 0.32 },
  taper: { swim: 0.2, bike: 0.48, run: 0.32 },
};

const SWIM_GUIDANCE = `Fill swim sessions from the session type: technique (drills/form), css (CSS interval sets), threshold (sustained), endurance (continuous distance), open_water (sighting/drafting). Keep ~80% aerobic. Give sets that sum to the prescribed duration.`;
const BIKE_GUIDANCE = `Fill bike sessions from the type: endurance (Z2 long ride — the aerobic cornerstone), sweet_spot (~88–94% FTP), threshold (~95–105% FTP intervals), vo2 (115–120%), recovery. Prescribe intervals to the target duration.`;
const RUN_GUIDANCE_TRI = `Fill run sessions per runType: easy/long (Z2, ~80% of run load), tempo/threshold (race-pace), interval (VO2). Keep run the most conservative discipline. Brick runs open at controlled effort off the bike.`;
const BRICK_GUIDANCE = `Brick = an ordered bike→run session in one workout. Ride the prescribed bike segment, then run the segment immediately off the bike at controlled effort (first km HR/pace drifts — hold target). The single most race-specific session.`;

function triPhilosophy(coach: string) {
  return {
    coach,
    guidance: [SWIM_GUIDANCE, BIKE_GUIDANCE, RUN_GUIDANCE_TRI, BRICK_GUIDANCE],
  };
}

const swimCounts: PhaseCountTable = { base: [2, 2, 3], build: [2, 3, 3], peak: [2, 3, 3], taper: [1, 2, 2] };
const bikeCounts: PhaseCountTable = { base: [2, 3, 3], build: [3, 3, 4], peak: [3, 3, 3], taper: [2, 2, 2] };
const runCounts: PhaseCountTable = { base: [3, 3, 4], build: [3, 4, 4], peak: [3, 3, 4], taper: [2, 2, 3] };
const brick70: PhaseCountTable = { base: 0, build: 1, peak: 2, taper: 1 };
const brick140: PhaseCountTable = { base: 0, build: 1, peak: 2, taper: 1 };
const brickOly: PhaseCountTable = { base: 0, build: 1, peak: 1, taper: 1 };

// --- Olympic-distance (short-course): shorter race → rewards intensity/economy
// over raw hours (research report §6.5). Distribution leans more threshold/VO2
// and less bike-dominant than long course; total volume sits below 70.3. ---
const OLY_ZONES = ZONES(
  { z1: 22, z2: 60, z3: 10, z4: 5, z5: 3 },
  { z1: 18, z2: 57, z3: 13, z4: 8, z5: 4 },
  { z1: 15, z2: 53, z3: 15, z4: 10, z5: 7 },
  { z1: 18, z2: 57, z3: 13, z4: 8, z5: 4 },
);
const OLY_BALANCE: Record<PhaseName, Balance> = {
  base: { swim: 0.3, bike: 0.4, run: 0.3 },
  build: { swim: 0.25, bike: 0.42, run: 0.33 },
  peak: { swim: 0.22, bike: 0.42, run: 0.36 },
  taper: { swim: 0.25, bike: 0.42, run: 0.33 },
};

export const tri_olympic: SportConfig = {
  id: "tri_olympic",
  family: "triathlon",
  displayName: "Olympic Triathlon",
  programType: "race_peaking",
  modalities: ["swim", "bike", "run", "brick", "rest", "race"],
  sessionCounts: { swim: swimCounts, bike: bikeCounts, run: runCounts, brick: brickOly },
  phaseZoneTargets: OLY_ZONES,
  needsDomains: NEEDS,
  experienceAxes: [
    { key: "swim", label: "Swim (CSS)", bands: SWIM_BANDS, needsWeight: 1.0 },
    { key: "bike", label: "Bike (FTP)", bands: BIKE_BANDS, needsWeight: 1.0 },
    { key: "run", label: "Run (off the bike)", bands: RUN_BANDS, needsWeight: 1.0 },
  ],
  volume: {
    kind: "per_discipline",
    // `${distance}:${level}` → [baseHours, peakHours]. Olympic sits below 70.3.
    hoursPerWeekByLevel: {
      "olympic:beginner": [4, 8],
      "olympic:intermediate": [6, 10],
      "olympic:advanced": [8, 12],
    },
    disciplineBalanceByPhase: OLY_BALANCE as unknown as Record<PhaseName, Record<string, number>>,
  },
  philosophy: triPhilosophy("expert Olympic-distance triathlon coach"),
};

export const tri_70_3: SportConfig = {
  id: "tri_70_3",
  family: "triathlon",
  displayName: "Ironman 70.3",
  programType: "race_peaking",
  modalities: ["swim", "bike", "run", "brick", "rest", "race"],
  sessionCounts: { swim: swimCounts, bike: bikeCounts, run: runCounts, brick: brick70 },
  phaseZoneTargets: TRI_ZONES,
  needsDomains: NEEDS,
  experienceAxes: [
    { key: "swim", label: "Swim (CSS)", bands: SWIM_BANDS, needsWeight: 1.0 },
    { key: "bike", label: "Bike (FTP)", bands: BIKE_BANDS, needsWeight: 1.0 },
    { key: "run", label: "Run (off the bike)", bands: RUN_BANDS, needsWeight: 1.0 },
  ],
  volume: {
    kind: "per_discipline",
    // `${distance}:${level}` → [baseHours, peakHours]
    hoursPerWeekByLevel: {
      "70_3:beginner": [6, 12],
      "70_3:intermediate": [8, 14],
      "70_3:advanced": [10, 16],
    },
    disciplineBalanceByPhase: BALANCE as unknown as Record<PhaseName, Record<string, number>>,
  },
  philosophy: triPhilosophy("expert Ironman 70.3 triathlon coach"),
};

export const tri_140_6: SportConfig = {
  id: "tri_140_6",
  family: "triathlon",
  displayName: "Ironman 140.6",
  programType: "race_peaking",
  modalities: ["swim", "bike", "run", "brick", "rest", "race"],
  sessionCounts: { swim: swimCounts, bike: bikeCounts, run: runCounts, brick: brick140 },
  phaseZoneTargets: TRI_ZONES,
  needsDomains: NEEDS,
  experienceAxes: [
    { key: "swim", label: "Swim (CSS)", bands: SWIM_BANDS, needsWeight: 1.0 },
    { key: "bike", label: "Bike (FTP)", bands: BIKE_BANDS, needsWeight: 1.0 },
    { key: "run", label: "Run (off the bike)", bands: RUN_BANDS, needsWeight: 1.0 },
  ],
  volume: {
    kind: "per_discipline",
    hoursPerWeekByLevel: {
      "140_6:beginner": [8, 15],
      "140_6:intermediate": [10, 17],
      "140_6:advanced": [12, 20],
    },
    disciplineBalanceByPhase: BALANCE as unknown as Record<PhaseName, Record<string, number>>,
  },
  philosophy: triPhilosophy("expert Ironman 140.6 triathlon coach"),
  dutyOfCare: {
    longSessionFlagMinutes: 300, // 5h+ sessions
    fueling: { carbGramsPerHour: [60, 90], hydrationMlPerHour: [500, 1000], sodiumMgPerHour: [300, 1500] },
    warnings: [
      "Rehearse race fueling on every long ride — never debut nutrition on race day.",
      "Hyponatremia risk: don't overdrink; salt tablets don't offset overdrinking. Tolerate ≤2–4% body-mass loss.",
      "Never run the full marathon distance in training; cap the long run ~2.5–3h.",
      "Carry fuel + a bail-out plan on 5h+ sessions; get medical clearance.",
    ],
    gateBeginners: true,
  },
};

export const TRI_SPORTS = { tri_olympic, tri_70_3, tri_140_6 };

// --- per-discipline proficiency (from CSS / FTP anchors) --------------------

type Level = "beginner" | "intermediate" | "advanced";

/** Swim level from CSS pace per 100 m (SWIM_BANDS thresholds: 1:35 / 2:00). */
export function swimLevelFromCss(cssPace: string | undefined): Level | undefined {
  const s = cssPace ? parseTimeToSeconds(cssPace) : null;
  if (s === null || s <= 0) return undefined;
  if (s < 95) return "advanced"; // faster than 1:35/100m
  if (s <= 120) return "intermediate"; // 1:35–2:00
  return "beginner";
}

/** Bike level from FTP (W/kg), sex-specific (BIKE_BANDS thresholds). */
export function bikeLevelFromFtp(
  ftpWatts: number | undefined,
  bodyKg: number | undefined,
  sex: string | undefined,
): Level | undefined {
  if (!ftpWatts || ftpWatts <= 0 || !bodyKg || bodyKg <= 0) return undefined;
  const wkg = ftpWatts / bodyKg;
  const female = sex === "female";
  const midLo = female ? 2.4 : 2.9;
  const midHi = female ? 3.0 : 3.6;
  if (wkg > midHi) return "advanced";
  if (wkg >= midLo) return "intermediate";
  return "beginner";
}

// --- back-compat re-exports: the deterministic engine now lives in ironman ---
export {
  buildTriathlonSkeleton,
  buildTriProgramData,
  triAnchorsFromBenchmarks,
  rebuildTriWeek,
  triWeekToProgramWeek,
  triVolumeLevel,
} from "../ironman";
export type { TriAnchors } from "../ironman";
