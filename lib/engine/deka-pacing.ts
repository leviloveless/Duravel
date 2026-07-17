/**
 * DEKA race pacing plan — the DEKA analog of the HYROX pacing plan (pacing.ts).
 *
 * Every DEKA format is 10 functional "zones" in a fixed order; the run geometry
 * differs (FIT/ULTRA 500 m between zones, MILE 160 m, STRONG/ATLAS none), and
 * ULTRA repeats the FIT lap 5×. This builds a race plan: a target run split (for
 * the run formats) plus a target time for each of the 10 zones, summing to the
 * athlete's goal finish (or a realistic finish PREDICTED from their benchmarks).
 *
 * The run split comes from the athlete's VDOT threshold pace (compromised for
 * tired legs); the row/ski zones are individualized from their 2 k erg times.
 * The remaining zones use coarse mid-pack reference times, centralized for
 * tuning. Pure + deterministic. Reads geometry straight off the SportConfig, so
 * it works for all five DEKA formats without per-format branching.
 */
import { computePaces, parseTimeToSeconds } from "./paces";
import { clamp, METERS_PER_MILE } from "./math";
import { formatDuration } from "./pacing";
import type { SportConfig } from "./sports/types";

export { formatDuration };

/** Mid-pack reference zone times (seconds) — DEKA FIT/MILE/STRONG/ULTRA catalog. */
const DEKA_REF_SEC: Record<string, number> = {
  deka_ram_lunge: 80,
  deka_row: 110, // 500 m
  deka_box_over: 55,
  deka_sit_up_throw: 70,
  deka_med_ball_sit_up: 65,
  deka_ski: 120, // 500 m
  deka_farmers_carry: 50, // 100 m
  deka_air_bike: 65, // 25 cal
  deka_wall_over: 75,
  deka_dead_ball_over: 75,
  deka_sled: 85, // 50 m push + 50 m pull
  deka_ram_burpee: 100,
};

/** Mid-pack reference zone times (seconds) — heavier ATLAS catalog. */
const ATLAS_REF_SEC: Record<string, number> = {
  atlas_thruster: 85,
  atlas_burpee_over_bar: 90,
  atlas_surrender_lunge: 80,
  atlas_db_g2oh: 75,
  atlas_db_bear_crawl: 70, // 40 m
  atlas_weighted_sit_up: 60,
  atlas_farmers_carry: 45, // 60 m
  atlas_db_s2oh: 75,
  atlas_single_unders: 55, // 100 reps
  atlas_shoulder_to_carry: 80, // 100 m
};

/** Reference 1 km run split (seconds) when no run benchmark is available. */
const REF_RUN_SPLIT_SEC = 360;
/** Transition seconds per zone (chip in/out, reset). */
const TRANSITION_PER_ZONE = 12;
/** Compromised-running penalty over fresh threshold pace (fatigue between zones). */
const COMPROMISED_FACTOR = 1.06;
/** Fallback reference for any zone id missing from the tables. */
const REF_FALLBACK_SEC = 80;

export interface DekaPacingZone {
  id: string;
  label: string;
  targetSec: number;
}

export interface DekaPacingPlan {
  /** "goal" when the athlete set a finish time; "predicted" when derived. */
  source: "goal" | "predicted";
  /** Race laps (ULTRA = 5, everything else = 1). */
  laps: number;
  /** Run distance between zones (m); 0 for STRONG/ATLAS. */
  runMetersPerSegment: number;
  /** Total race running (m) across all laps; 0 for STRONG/ATLAS. */
  totalRunMeters: number;
  hasRunning: boolean;
  targetFinishSec: number;
  predictedFinishSec: number;
  /** Target run split (sec/km); 0 for no-run formats. */
  runSplitSecPerKm: number;
  /** Total running time across the whole race (sec). */
  runTotalSec: number;
  /** Per-lap zone targets, in race order. */
  zones: DekaPacingZone[];
  /** Zone work across the whole race (all laps) (sec). */
  zonesTotalSec: number;
  /** Transition time across the whole race (sec). */
  transitionSec: number;
}

export interface DekaPacingInput {
  benchmarks?: {
    mileTime?: string;
    fiveKTime?: string;
    tenKTime?: string;
    ski2kTime?: string;
    row2kTime?: string;
  };
  sex?: "male" | "female" | "other";
  goalFinishTime?: string;
}

/** 500 m erg time (sec) from a 2 k erg time: a quarter of the 2 k. */
function ergFiveHundredFrom2k(twoKTime?: string): number | null {
  const s = twoKTime ? parseTimeToSeconds(twoKTime) : null;
  return s && s > 0 ? Math.round(s / 4) : null;
}

/**
 * Build a DEKA pacing plan from the sport config + the athlete's benchmarks.
 * Returns null for non-DEKA sports (HYROX has its own plan; other families none).
 */
export function computeDekaPacingPlan(cfg: SportConfig, input: DekaPacingInput): DekaPacingPlan | null {
  if (cfg.family !== "station_hybrid" || cfg.id === "hyrox") return null;
  const order = cfg.raceStationOrder ?? [];
  if (order.length === 0) return null;

  const isAtlas = cfg.id === "deka_atlas";
  const REF = isAtlas ? ATLAS_REF_SEC : DEKA_REF_SEC;
  const laps = cfg.stationCatalog?.laps ?? 1;
  const runMetersPerSegment = cfg.interStationRunMeters ?? 0;
  const totalRunMeters = cfg.totalRaceRunMeters ?? 0;
  const hasRunning = totalRunMeters > 0;

  const paces = computePaces(input.benchmarks ?? {});
  const runSplitSecPerKm = !hasRunning
    ? 0
    : paces
      ? Math.round((paces.threshold / METERS_PER_MILE) * 1000 * COMPROMISED_FACTOR)
      : REF_RUN_SPLIT_SEC;

  const ski = ergFiveHundredFrom2k(input.benchmarks?.ski2kTime);
  const row = ergFiveHundredFrom2k(input.benchmarks?.row2kTime);

  const baseZones: DekaPacingZone[] = order.map((id) => {
    let sec = REF[id] ?? REF_FALLBACK_SEC;
    if (id === "deka_ski" && ski) sec = ski;
    else if (id === "deka_row" && row) sec = row;
    return { id, label: cfg.stations?.[id]?.label ?? id, targetSec: Math.round(sec) };
  });

  const zonesPerLap = baseZones.reduce((a, z) => a + z.targetSec, 0);
  const transitionSec = TRANSITION_PER_ZONE * order.length * laps; // fixed, not scaled
  const runTotalRaw = hasRunning ? Math.round((totalRunMeters / 1000) * runSplitSecPerKm) : 0;
  const predictedFinishSec = runTotalRaw + zonesPerLap * laps + transitionSec;

  const goalSec = input.goalFinishTime ? parseTimeToSeconds(input.goalFinishTime) : null;
  const useGoal = goalSec != null && goalSec > 0;
  // Scale the run + zone work toward the goal (transitions fixed); clamp for realism.
  const scale = useGoal ? clamp(goalSec / predictedFinishSec, 0.7, 1.3) : 1;

  const zones = baseZones.map((z) => ({ ...z, targetSec: Math.round(z.targetSec * scale) }));
  const runSplitSec = Math.round(runSplitSecPerKm * scale);
  const runTotalSec = hasRunning ? Math.round((totalRunMeters / 1000) * runSplitSec) : 0;
  const zonesTotalSec = zones.reduce((a, z) => a + z.targetSec, 0) * laps;
  const targetFinishSec = runTotalSec + zonesTotalSec + transitionSec;

  return {
    source: useGoal ? "goal" : "predicted",
    laps,
    runMetersPerSegment,
    totalRunMeters,
    hasRunning,
    targetFinishSec,
    predictedFinishSec,
    runSplitSecPerKm: runSplitSec,
    runTotalSec,
    zones,
    zonesTotalSec,
    transitionSec,
  };
}
