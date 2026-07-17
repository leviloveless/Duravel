/**
 * Sport-abstraction contract (P0 — see docs/future-phases/15 + 19).
 *
 * A `SportConfig` is the DATA registry entry for one sport: catalogs, count
 * tables, zone targets, needs domains, experience axes, volume currency, and
 * copy. A `ProgramType` is the small BEHAVIOR interface for the macro-arc
 * (race-peaking vs. general-fitness rotation). Two ProgramTypes + N SportConfigs
 * express all 9 sports over the one shared periodization core.
 *
 * P0 introduces this contract and makes HYROX `SPORTS.hyrox`; nothing on the
 * generation path consumes it yet, so HYROX output stays byte-identical (the
 * golden-hyrox oracle is the gate). Later phases flip each consumer to read the
 * config, then register new sports.
 */
import type { ExperienceLevel, PhaseName, ZoneDistribution } from "../types";
import type { StationSpec, StationCatalog } from "../stations";
import type { SportId } from "@/lib/schemas";

export type { SportId };

export type SportFamily = "station_hybrid" | "triathlon" | "general_fitness";
export type ProgramTypeId = "race_peaking" | "general_fitness";

/** A schedulable session kind. Family A: run|lift|hybrid. Family B adds
 *  swim|bike|brick. Family C adds cardio|strength. rest|race always valid. */
export type Modality =
  | "run"
  | "lift"
  | "hybrid"
  | "swim"
  | "bike"
  | "brick"
  | "cardio"
  | "strength"
  | "rest"
  | "race";

export interface ExperienceBand {
  level: ExperienceLevel;
  /** Human-readable, measurable criterion shown in onboarding. */
  criterion: string;
}

export interface ExperienceAxis {
  key: string; // "running" | "swim" | "bike" | "lifting" | ...
  label: string;
  bands: ExperienceBand[];
  /** Weight this axis gets in the needs analysis for this sport (0 = ignore). */
  needsWeight: number;
}

/** Per-phase session count. A scalar, or [beginner, intermediate, advanced]. */
export type PhaseCountTable = Record<PhaseName, number | [number, number, number]>;

export interface NeedsDomainConfig {
  key: string; // "run_engine" | "erg_engine" | "strength" | "swim" | ...
  label: string;
  /** Selects the scoring function (keeps needs.ts from a central switch). */
  scorerId: string;
  /** sex/context → [best, worst] or [worst, best] anchors. */
  anchors: Record<string, [number, number]>;
  weight: number;
}

export interface PacingConfig {
  refRunSplitSecPerKm?: number;
  /** stationId → reference seconds at race spec. */
  refStationSec: Record<string, number>;
  proStationFactor?: number;
  /** Transition/roxzone seconds per station (HYROX ~35, DEKA ~20). */
  transitionSec: number;
  compromisedRunFactor?: number;
}

export interface FuelingConfig {
  carbGramsPerHour: [number, number];
  hydrationMlPerHour: [number, number];
  sodiumMgPerHour: [number, number];
}

export interface DutyOfCareConfig {
  /** Surface fueling/hydration guidance for sessions longer than this. */
  longSessionFlagMinutes: number;
  fueling?: FuelingConfig;
  warnings: string[];
  /** Redirect/gate true beginners (140.6, DekaUltra). */
  gateBeginners?: boolean;
}

export type SubGoalKey = "recomp" | "general_strength" | "general_endurance" | "balanced";

export interface SubGoalConfig {
  key: SubGoalKey;
  label: string;
  volumeBias: { aerobicFactor: number; strengthFactor: number };
  sessionDelta: Partial<Record<Modality, number>>;
  /** Health floors applied last, so a bias never drops below guideline minimums. */
  floors: { aerobicMinutesMin: number; strengthDaysMin: number };
  cues?: string[];
}

export interface RotationBlock {
  emphasis: "strength" | "aerobic" | "mixed";
  weeks: number;
}

/** General-fitness macro-arc: repeating emphasis blocks, no peak/taper. */
export interface RotationPlan {
  blocks: RotationBlock[];
  retestEveryWeeks: number;
}

/** Family A/C: running miles + cardio minutes (today's currency). */
export interface VolumeConfigSingle {
  kind: "single_currency";
  startMileageByExp: Record<ExperienceLevel, number>;
  avgMinPerMile: number;
}

/** Family B (triathlon): per-discipline hours reconciled to unified TSS. */
export interface VolumeConfigMulti {
  kind: "per_discipline";
  /** `${distance}:${level}` → [baseHours, peakHours]. */
  hoursPerWeekByLevel: Record<string, [number, number]>;
  /** phase → { discipline → share of weekly time }. */
  disciplineBalanceByPhase: Record<PhaseName, Record<string, number>>;
}

export type VolumeConfig = VolumeConfigSingle | VolumeConfigMulti;

export interface PhilosophyConfig {
  /** e.g. "expert HYROX coach". */
  coach: string;
  /** Guidance blocks injected into the generation prompt. */
  guidance: string[];
  /** Station name pool by phase (station-hybrid sports). */
  stationLibrary?: Record<PhaseName, string[]>;
  /** Per-phase character text for the user prompt. */
  phaseCharacter?: Record<PhaseName, string>;
}

export interface SportConfig {
  id: SportId;
  family: SportFamily;
  displayName: string;
  programType: ProgramTypeId;

  modalities: Modality[];
  /** Per-modality per-phase session counts (keys vary by family). */
  sessionCounts: Partial<Record<Modality, PhaseCountTable>>;
  /** Minimum runs the deload/taper floors may not drop below (Strong/Atlas → 0). */
  runFloor?: number;

  stations?: Record<string, StationSpec>;
  raceStationOrder?: string[];
  interStationRunMeters?: number;
  totalRaceRunMeters?: number;
  /** Station catalog bundle used by assembly (simulations + station progression). */
  stationCatalog?: StationCatalog;

  phaseZoneTargets: Record<PhaseName, ZoneDistribution>;
  needsDomains: NeedsDomainConfig[];
  /** Station names (matching the philosophy library) the needs analysis emphasizes
   *  for an erg / strength limiter. Omit → HYROX station names. */
  needsStations?: { erg: readonly string[]; strength: readonly string[] };
  experienceAxes: ExperienceAxis[];

  pacing?: PacingConfig;
  volume: VolumeConfig;
  philosophy: PhilosophyConfig;

  dutyOfCare?: DutyOfCareConfig;
  subGoals?: SubGoalConfig[];
}

/** The macro-arc behavior. `race_peaking` = today's engine; `general_fitness`
 *  = rotating emphasis blocks. Wired into the engine in a later P0 step. */
export interface ProgramType {
  id: ProgramTypeId;
  buildsToRace: boolean;
  retestEveryWeeks?: number;
}
