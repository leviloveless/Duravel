/**
 * Goal-time HYROX pacing plan (Review #6).
 *
 * HYROX outcomes are dominated by pacing discipline — even splits, not
 * redlining the sled. This builds a race plan: a target 1 km run split plus a
 * target time for each of the 8 stations, summing to the athlete's goal finish
 * (or, when they don't set one, a realistic finish PREDICTED from their
 * benchmarks). The run split and the erg stations are individualized from the
 * athlete's data (VDOT threshold pace, 2 k ski/row); the strength stations use
 * sex/division-aware reference times. Pure + deterministic.
 *
 * Reference times are coarse (a ~mid-pack finisher) and centralized for tuning.
 */

import { computePaces, parseTimeToSeconds, type RaceInput } from "./paces";
import type { Division, StationId } from "./stations";
import { STATIONS, RACE_STATION_ORDER } from "./stations";
import { clamp, METERS_PER_MILE } from "./math";
export { RACE_STATION_ORDER };

/** Reference station times (seconds) for a mid-pack finisher. */
const REF_STATION_SEC: Record<StationId, number> = {
  ski_erg: 245,
  sled_push: 130,
  sled_pull: 165,
  burpee_broad_jump: 225,
  row: 240,
  farmers_carry: 130,
  sandbag_lunge: 195,
  wall_balls: 320,
  assault_bike: 180,
};

/** Reference 1 km run split (seconds) when no run benchmark is available. */
const REF_RUN_SPLIT_SEC = 385;
/** Transition ("roxzone") seconds per station change. */
const ROXZONE_PER_STATION = 35;
/** Compromised-running penalty over fresh threshold pace (tired legs). */
const COMPROMISED_FACTOR = 1.08;
/** Heavier Pro implements slow the strength stations. */
const PRO_STATION_FACTOR = 1.12;

const STRENGTH_STATIONS: ReadonlySet<StationId> = new Set([
  "sled_push",
  "sled_pull",
  "farmers_carry",
  "sandbag_lunge",
  "wall_balls",
]);

export interface PacingStation {
  id: StationId;
  label: string;
  targetSec: number;
}

export interface PacingPlan {
  /** "goal" when the athlete set a finish time; "predicted" when derived. */
  source: "goal" | "predicted";
  targetFinishSec: number;
  predictedFinishSec: number;
  runSplitSecPerKm: number;
  runTotalSec: number;
  stations: PacingStation[];
  stationsTotalSec: number;
  roxzoneSec: number;
}

export interface PacingInput {
  benchmarks?: RaceInput & { ski2kTime?: string; row2kTime?: string };
  sex?: "male" | "female" | "other";
  division?: Division;
  goalFinishTime?: string;
}

/** 1 km time (sec) from a 2 k erg time: half plus a small fade. */
function ergThousandFrom2k(twoKTime?: string): number | null {
  const s = twoKTime ? parseTimeToSeconds(twoKTime) : null;
  return s && s > 0 ? (s / 2) * 1.03 : null;
}

/** Build the pacing plan. */
export function computePacingPlan(input: PacingInput): PacingPlan {
  const division: Division = input.division ?? "open";
  const paces = computePaces(input.benchmarks ?? {});

  // Individualized 1 km run split from VDOT threshold pace (compromised), else ref.
  const runSplitSecPerKm = paces
    ? Math.round((paces.threshold / METERS_PER_MILE) * 1000 * COMPROMISED_FACTOR)
    : REF_RUN_SPLIT_SEC;

  // Per-station target times (pre-scale).
  const ski = ergThousandFrom2k(input.benchmarks?.ski2kTime) ?? REF_STATION_SEC.ski_erg;
  const row = ergThousandFrom2k(input.benchmarks?.row2kTime) ?? REF_STATION_SEC.row;
  const proFactor = division === "pro" ? PRO_STATION_FACTOR : 1;

  const baseStations: PacingStation[] = RACE_STATION_ORDER.map((id) => {
    let sec: number;
    if (id === "ski_erg") sec = ski;
    else if (id === "row") sec = row;
    else sec = REF_STATION_SEC[id] * (STRENGTH_STATIONS.has(id) ? proFactor : 1);
    return { id, label: STATIONS[id].label, targetSec: Math.round(sec) };
  });

  const roxzoneSec = ROXZONE_PER_STATION * RACE_STATION_ORDER.length;
  const runTotalRaw = runSplitSecPerKm * 8;
  const stationsRaw = baseStations.reduce((a, s) => a + s.targetSec, 0);
  const predictedFinishSec = Math.round(runTotalRaw + stationsRaw + roxzoneSec);

  const goalSec = input.goalFinishTime ? parseTimeToSeconds(input.goalFinishTime) : null;
  const useGoal = goalSec != null && goalSec > 0;

  // Scale run + stations toward the goal (roxzone fixed); clamp for realism.
  const scale = useGoal ? clamp(goalSec / predictedFinishSec, 0.75, 1.25) : 1;

  const runSplit = Math.round(runSplitSecPerKm * scale);
  const stations = baseStations.map((s) => ({ ...s, targetSec: Math.round(s.targetSec * scale) }));
  const runTotalSec = runSplit * 8;
  const stationsTotalSec = stations.reduce((a, s) => a + s.targetSec, 0);
  const targetFinishSec = runTotalSec + stationsTotalSec + roxzoneSec;

  return {
    source: useGoal ? "goal" : "predicted",
    targetFinishSec,
    predictedFinishSec,
    runSplitSecPerKm: runSplit,
    runTotalSec,
    stations,
    stationsTotalSec,
    roxzoneSec,
  };
}

/** Format seconds as "h:mm:ss" or "m:ss". */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}
