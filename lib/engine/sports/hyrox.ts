/**
 * HYROX as `SPORTS.hyrox` (P0). Values are IMPORTED from the existing engine
 * constants wherever possible, so this config cannot drift from live behavior —
 * it is an aggregation of the current source of truth, not a hand-copied
 * duplicate. Fields the config layer will own later but the engine still reads
 * inline today (session counts, station catalog, zone targets) are wired here so
 * the subsequent consumer-rewire is a mechanical swap, gated by the oracle.
 */
import {
  ZONE_DEFINITIONS,
  RUN_GUIDANCE,
  LIFT_GUIDANCE,
  HYBRID_GUIDANCE,
  TAPER_GUIDANCE,
  HYBRID_LIBRARY,
  PHASE_CHARACTER,
} from "@/lib/ai/philosophy";
import { STATIONS, RACE_STATION_ORDER, HYROX_CATALOG } from "../stations";
import { RUN_COUNT, HYBRID_COUNT } from "../slots";
import { PHASE_ZONE_TARGETS, STARTING_MILEAGE, AVG_MIN_PER_MILE } from "../volume";
import type { PhaseName } from "../types";
import type { SportConfig } from "./types";

const LIFT_COUNT: Record<PhaseName, number> = { base: 3, build: 3, peak: 3, taper: 2 };

export const hyrox: SportConfig = {
  id: "hyrox",
  family: "station_hybrid",
  displayName: "HYROX",
  programType: "race_peaking",

  modalities: ["run", "lift", "hybrid", "rest", "race"],
  sessionCounts: {
    run: RUN_COUNT, // [beg, int, adv] per phase
    hybrid: HYBRID_COUNT,
    lift: LIFT_COUNT,
  },

  stations: STATIONS,
  raceStationOrder: RACE_STATION_ORDER,
  stationCatalog: HYROX_CATALOG,
  interStationRunMeters: 1000,
  totalRaceRunMeters: 8000,

  phaseZoneTargets: PHASE_ZONE_TARGETS,

  // Needs domains for the station-hybrid family. The authoritative scoring
  // functions + full multi-metric anchors live in lib/engine/needs.ts; these
  // entries are the registry contract the rewire will point that logic at.
  needsDomains: [
    {
      key: "run_engine",
      label: "running endurance",
      scorerId: "run_engine",
      anchors: { male: [360, 720], female: [396, 792] }, // 10k pace sec/mi [best,worst]
      weight: 1,
    },
    {
      key: "erg_engine",
      label: "erg / non-running cardio",
      scorerId: "erg_engine",
      anchors: { male: [400, 560], female: [460, 644] }, // 2k row sec [best,worst]
      weight: 1,
    },
    {
      key: "strength",
      label: "maximal strength",
      scorerId: "strength",
      anchors: { male: [1.0, 2.25], female: [0.8, 1.8] }, // rel squat 1RM [worst,best]
      weight: 1,
    },
  ],

  experienceAxes: [
    {
      key: "running",
      label: "Running",
      needsWeight: 1,
      bands: [
        { level: "beginner", criterion: "under 15 miles/week sustained over the last 6 months" },
        { level: "intermediate", criterion: "15–30 miles/week sustained over the last 6 months" },
        { level: "advanced", criterion: "over 30 miles/week sustained over the last 6 months" },
      ],
    },
    {
      key: "hybrid",
      label: "Hybrid (HIIT)",
      needsWeight: 1,
      bands: [
        { level: "beginner", criterion: "≤1 hybrid HIIT workout/week over the last 6 months" },
        { level: "intermediate", criterion: "2 hybrid HIIT workouts/week over the last 6 months" },
        { level: "advanced", criterion: "≥3 hybrid HIIT workouts/week over the last 6 months" },
      ],
    },
    {
      key: "lifting",
      label: "Lifting",
      needsWeight: 1,
      bands: [
        { level: "beginner", criterion: "lifting consistently for under 3 years" },
        { level: "intermediate", criterion: "lifting consistently for 3–5 years" },
        { level: "advanced", criterion: "lifting consistently for over 5 years" },
      ],
    },
  ],

  volume: {
    kind: "single_currency",
    startMileageByExp: STARTING_MILEAGE,
    avgMinPerMile: AVG_MIN_PER_MILE,
  },

  philosophy: {
    coach: "expert HYROX coach",
    guidance: [ZONE_DEFINITIONS, RUN_GUIDANCE, LIFT_GUIDANCE, HYBRID_GUIDANCE, TAPER_GUIDANCE],
    stationLibrary: HYBRID_LIBRARY,
    phaseCharacter: PHASE_CHARACTER,
  },
};
