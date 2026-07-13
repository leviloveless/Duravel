/**
 * HYROX station catalog + capacity progression (Review #6).
 *
 * The eight HYROX stations have fixed distances/reps; only the LOADS change by
 * division (Open/Pro) and sex. Previously the AI free-filled hybrid station
 * prescriptions with no reference to real race demands and no progression. This
 * module gives each station its true race spec and ramps volume + load across
 * the mesocycles toward it, so hybrid work actually prepares the athlete for the
 * loads they'll face on race day.
 *
 * Pure + deterministic (engine owns it); assembly rewrites hybrid element
 * prescriptions from here, like the strength and pace models.
 *
 * NOTE: loads are reference values (kg) and are centralized here for easy
 * tuning; verify against the current HYROX rulebook for the target season.
 */

import type { PhaseName } from "./types";

export type Division = "open" | "pro";
export type StationSex = "male" | "female";

/** Canonical HYROX stations (in race order). */
export type StationId =
  | "ski_erg"
  | "sled_push"
  | "sled_pull"
  | "burpee_broad_jump"
  | "row"
  | "farmers_carry"
  | "sandbag_lunge"
  | "wall_balls"
  | "assault_bike"; // training substitute, not a race station

export interface StationSpec {
  id: StationId;
  label: string;
  /** Race-spec work unit at full (Peak) volume. */
  meters?: number;
  reps?: number;
  /** Load in kg by division × sex, or null when the station has no load. */
  loadKg?: Record<Division, Record<StationSex, number>> | null;
  /** Per-hand load (farmers carry) rather than total. */
  perHand?: boolean;
  /** Wall-ball target height note. */
  note?: string;
}

/** Race specs. Distances/reps are division-independent; loads are not. */
export const STATIONS: Record<StationId, StationSpec> = {
  ski_erg: { id: "ski_erg", label: "SkiErg", meters: 1000, loadKg: null },
  sled_push: {
    id: "sled_push",
    label: "Sled Push",
    meters: 50,
    loadKg: { open: { male: 152, female: 102 }, pro: { male: 202, female: 152 } },
  },
  sled_pull: {
    id: "sled_pull",
    label: "Sled Pull",
    meters: 50,
    loadKg: { open: { male: 103, female: 78 }, pro: { male: 153, female: 103 } },
  },
  burpee_broad_jump: { id: "burpee_broad_jump", label: "Burpee Broad Jumps", meters: 80, loadKg: null },
  row: { id: "row", label: "Row", meters: 1000, loadKg: null },
  farmers_carry: {
    id: "farmers_carry",
    label: "Farmers Carry",
    meters: 200,
    perHand: true,
    loadKg: { open: { male: 24, female: 16 }, pro: { male: 32, female: 24 } },
  },
  sandbag_lunge: {
    id: "sandbag_lunge",
    label: "Sandbag Lunges",
    meters: 100,
    loadKg: { open: { male: 20, female: 10 }, pro: { male: 30, female: 20 } },
  },
  wall_balls: {
    id: "wall_balls",
    label: "Wall Balls",
    reps: 100,
    loadKg: { open: { male: 6, female: 4 }, pro: { male: 9, female: 6 } },
    note: "to target (M 3.0 m / F 2.7 m)",
  },
  assault_bike: { id: "assault_bike", label: "Assault Bike", loadKg: null },
};

/** Map a free-text hybrid element name to a canonical station id. */
export function stationIdFor(exercise: string): StationId | null {
  const t = exercise.toLowerCase();
  if (/ski/.test(t)) return "ski_erg";
  if (/row/.test(t)) return "row";
  if (/(assault|echo|air)\s*bike|bike\s*erg|\bbike\b/.test(t)) return "assault_bike";
  if (/sled.*push|push.*sled/.test(t)) return "sled_push";
  if (/sled.*pull|pull.*sled/.test(t)) return "sled_pull";
  if (/burpee/.test(t)) return "burpee_broad_jump";
  if (/farmer/.test(t)) return "farmers_carry";
  if (/(sandbag|walking)\s*lunge|lunge/.test(t)) return "sandbag_lunge";
  if (/wall\s*ball/.test(t)) return "wall_balls";
  return null;
}

/**
 * Phase progression toward race spec. HYROX implements come in fixed weights
 * (you can't load a 3.2 kg wall ball), so we train at RACE LOAD throughout and
 * progress VOLUME (meters/reps) toward the full race distance across the block.
 * Peak = full race spec; Taper keeps race load but cuts volume for sharpness.
 */
const VOLUME_FACTOR: Record<PhaseName, number> = { base: 0.6, build: 0.85, peak: 1, taper: 0.6 };

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

export interface StationPrescription {
  stationId: StationId;
  label: string;
  /** Human-readable prescription, e.g. "50m sled push @ 120kg" or "1000m ski". */
  prescription: string;
  /** Structured pieces for callers that want them. */
  meters?: number;
  reps?: number;
  loadKg?: number;
  atRaceSpec: boolean;
}

/**
 * Build the progressed prescription for a station at a given phase/division/sex.
 * Returns null if the exercise isn't a recognized station (caller keeps AI text).
 */
export function stationPrescription(
  exercise: string,
  phase: PhaseName,
  division: Division = "open",
  sex: StationSex = "male",
): StationPrescription | null {
  const id = stationIdFor(exercise);
  if (!id) return null;
  const spec = STATIONS[id];
  const vf = VOLUME_FACTOR[phase];

  const meters = spec.meters != null ? Math.max(5, round5(spec.meters * vf)) : undefined;
  const reps = spec.reps != null ? Math.max(5, round5(spec.reps * vf)) : undefined;
  // Race load, exact (fixed implements) — progression is by volume, not load.
  const loadKg = spec.loadKg != null ? spec.loadKg[division][sex] : undefined;

  const parts: string[] = [];
  if (meters != null) parts.push(`${meters}m`);
  if (reps != null) parts.push(`${reps} reps`);
  parts.push(spec.label.toLowerCase());
  let prescription = parts.join(" ");
  if (loadKg != null) {
    prescription += spec.perHand ? ` @ 2×${loadKg}kg` : ` @ ${loadKg}kg`;
  }
  if (id === "assault_bike") prescription = `${Math.max(5, round5(20 * vf))} cal assault bike`;

  const atRaceSpec = vf >= 1;
  return { stationId: id, label: spec.label, prescription, meters, reps, loadKg, atRaceSpec };
}

/** The 8 race stations in HYROX race order (no assault bike). */
export const RACE_STATION_ORDER: StationId[] = [
  "ski_erg",
  "sled_push",
  "sled_pull",
  "burpee_broad_jump",
  "row",
  "farmers_carry",
  "sandbag_lunge",
  "wall_balls",
];

export interface HybridElement {
  exercise: string;
  prescription: string;
}

/**
 * Build the element list for a full race simulation (Review #9): the 8 race
 * stations in order, each preceded by a 1 km run (run → station × 8), at race
 * spec. Runs are tagged race pace; the reconciler paces them at threshold.
 */
export function buildSimulationElements(
  division: Division = "open",
  sex: StationSex = "male",
): HybridElement[] {
  const els: HybridElement[] = [];
  for (const id of RACE_STATION_ORDER) {
    els.push({ exercise: "run", prescription: "1000m @ race pace (threshold)" });
    const spec = stationPrescription(STATIONS[id].label, "peak", division, sex);
    els.push({ exercise: STATIONS[id].label.toLowerCase(), prescription: spec?.prescription ?? STATIONS[id].label });
  }
  return els;
}
