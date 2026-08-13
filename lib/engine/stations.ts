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
import { round5 } from "./math";

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
  /** Station id. HYROX ids are the StationId union; DEKA catalogs use their own. */
  id: string;
  label: string;
  /** Race-spec work unit at full (Peak) volume. */
  meters?: number;
  /** Reps: a number (volume-progressed) or a fixed string (e.g. "25 cal"). */
  reps?: number | string;
  /** Load in kg by tier (HYROX open|pro; DEKA rx|foundation) × sex, or null. */
  loadKg?: Record<string, Record<StationSex, number>> | null;
  /** Per-hand load (farmers carry / bear crawl) rather than total. */
  perHand?: boolean;
  /** Display note (wall-ball height, magnetic-sled level, etc.). */
  note?: string;
  /** Regex mapping a free-text element name to this station (catalog matcher). */
  match?: RegExp;
}

/**
 * A sport's station catalog + race geometry (P0 rewire). Lets assembly build
 * simulations and progress station prescriptions from a sport-provided catalog
 * instead of the HYROX module globals. HYROX supplies HYROX_CATALOG (below);
 * DEKA formats supply their own 10-zone catalogs.
 */
export interface StationCatalog {
  stations: Record<string, StationSpec>;
  raceOrder: string[];
  /** Run distance (m) that precedes each station in a race simulation (0 = no runs). */
  interStationRunMeters: number;
  /** Map a free-text element name to a catalog station id (null = unknown). */
  matcher: (exercise: string) => string | null;
  /** Race-simulation laps (DEKA ULTRA = 5 consecutive FIT laps). Default 1. */
  laps?: number;
  /** Run-element effort note (default "race pace (threshold)"; Ultra = controlled effort). */
  runNote?: string;
}

/** Build a catalog matcher from each station's `match` regex (first hit wins;
 *  order the specs most-specific first). */
export function makeMatcher(specs: StationSpec[]): (exercise: string) => string | null {
  return (exercise: string) => {
    const t = exercise.toLowerCase();
    for (const s of specs) {
      if (s.match && s.match.test(t)) return s.id;
    }
    return null;
  };
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

export interface StationPrescription {
  stationId: string;
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
  catalog?: StationCatalog,
  scale = 1,
): StationPrescription | null {
  const cat = catalog ?? HYROX_CATALOG;
  const id = cat.matcher(exercise);
  if (!id) return null;
  const spec = cat.stations[id];
  if (!spec) return null;
  // `scale` rides ON TOP of the phase factor rather than replacing it, so a
  // half-volume training station still progresses base → build → peak. It is 1
  // for a race simulation, which is the only hybrid that trains at full spec.
  const vf = VOLUME_FACTOR[phase] * scale;

  const meters = spec.meters != null ? Math.max(5, round5(spec.meters * vf)) : undefined;
  // Numeric reps progress by volume; string reps (e.g. "25 cal") are fixed.
  const numericReps = typeof spec.reps === "number" ? Math.max(5, round5(spec.reps * vf)) : undefined;
  const stringReps = typeof spec.reps === "string" ? spec.reps : undefined;
  // Race load, exact (fixed implements). Use the requested tier, else the
  // catalog's first tier (DEKA has a single Rx set keyed differently from HYROX).
  const tier = spec.loadKg != null ? (spec.loadKg[division] ?? Object.values(spec.loadKg)[0]) : undefined;
  const loadKg = tier ? tier[sex] : undefined;

  const parts: string[] = [];
  if (meters != null) parts.push(`${meters}m`);
  if (numericReps != null) parts.push(`${numericReps} reps`);
  if (stringReps != null) parts.push(stringReps);
  parts.push(spec.label.toLowerCase());
  let prescription = parts.join(" ");
  if (loadKg != null) {
    prescription += spec.perHand ? ` @ 2×${loadKg}kg` : ` @ ${loadKg}kg`;
  }
  if (id === "assault_bike") prescription = `${Math.max(5, round5(20 * vf))} cal assault bike`;

  const atRaceSpec = vf >= 1;
  return { stationId: id, label: spec.label, prescription, meters, reps: numericReps, loadKg, atRaceSpec };
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
  catalog?: StationCatalog,
): HybridElement[] {
  const cat = catalog ?? HYROX_CATALOG;
  const laps = cat.laps ?? 1;
  const runNote = cat.runNote ?? "race pace (threshold)";
  const els: HybridElement[] = [];
  for (let lap = 0; lap < laps; lap++) {
    for (const id of cat.raceOrder) {
      const label = cat.stations[id]?.label ?? id;
      // Station-only formats (DEKA Strong/Atlas) set interStationRunMeters = 0.
      if (cat.interStationRunMeters > 0) {
        els.push({ exercise: "run", prescription: `${cat.interStationRunMeters}m @ ${runNote}` });
      }
      const spec = stationPrescription(label, "peak", division, sex, cat);
      els.push({ exercise: label.toLowerCase(), prescription: spec?.prescription ?? label });
    }
  }
  return els;
}

/**
 * Volume scale for a REGULAR (non-simulation) hybrid session, on top of the
 * phase factor (Levi, 2026-08-12).
 *
 * The rule: **every hybrid touches every race event, at half the race volume,
 * with the FULL between-station run.** Race intensity, recoverable dose. Half
 * lands at PEAK — base and build ramp into it through `VOLUME_FACTOR`, so a
 * 12-week block still progresses (0.30 → 0.425 → 0.50 of race spec) instead of
 * prescribing the identical session in week 1 and week 10.
 *
 * The runs are deliberately NOT halved. Levi's call: the run is where a HYROX is
 * won or lost, and holding race pace over the real 1 km is the thing worth
 * rehearsing. The trade-off he accepted is that the stations do less of the
 * fatiguing, so each run is less "compromised" than it will be on race day.
 */
export const HYBRID_STATION_SCALE = 0.5;

/** Extra volume on the athlete's limiter stations, from the needs analysis. */
export const EMPHASIS_BOOST = 1.2;

/**
 * Seconds per meter (or per rep) of station work for a mid-pack amateur, used
 * ONLY to estimate how long a hybrid session takes. These are coarse race-split
 * averages, not per-athlete predictions — the point is that a 16-element session
 * stops being billed at a flat 60 minutes. Tune the table, not the callers.
 *
 * At full race spec they sum to ~25 min of station work, which is the right
 * shape for a 75–85 min HYROX where the 8 km of running is the other ~50 min.
 */
export const STATION_WORK_RATE: Record<string, number> = {
  ski_erg: 0.255, // 1000 m ≈ 4:15
  sled_push: 1.8, // 50 m ≈ 1:30
  sled_pull: 2.0, // 50 m ≈ 1:40
  burpee_broad_jump: 2.8, // 80 m ≈ 3:45
  row: 0.24, // 1000 m ≈ 4:00
  farmers_carry: 0.45, // 200 m ≈ 1:30
  sandbag_lunge: 2.1, // 100 m ≈ 3:30
  wall_balls: 2.7, // 100 reps ≈ 4:30
  assault_bike: 3.0, // per calorie
};

/** Estimated seconds of work for one prescribed station. */
export function stationWorkSeconds(spec: StationPrescription): number {
  const rate = STATION_WORK_RATE[spec.stationId];
  if (rate == null) return 90; // unknown station: a flat, honest guess
  const units = spec.meters ?? spec.reps ?? 0;
  if (units <= 0) return 90;
  return units * rate;
}

/**
 * The volume scale a hybrid session's stations train at: full race spec for a
 * simulation, `HYBRID_STATION_SCALE` otherwise, with a boost for the athlete's
 * limiter stations. Single source of truth — `buildHybridElements` sizes the
 * session with it and `applyStationProgression` re-derives the SAME number, so
 * the two can never disagree and halve the volume twice.
 */
export function hybridStationScale(
  stationId: string,
  simulation: boolean,
  emphasis: readonly string[] = [],
): number {
  if (simulation) return 1;
  const boost = emphasis.includes(stationId) ? EMPHASIS_BOOST : 1;
  return HYBRID_STATION_SCALE * boost;
}

/**
 * Build a REGULAR hybrid session: every race station, in race order, each
 * preceded by a full-distance run — the race's own structure at a trainable
 * dose. `stationIds` lets the caller ship a subset when the athlete's session
 * cap can't hold all eight (see `fitHybridToCap`).
 */
export function buildHybridElements(
  phase: PhaseName,
  division: Division = "open",
  sex: StationSex = "male",
  catalog?: StationCatalog,
  emphasis: readonly string[] = [],
  stationIds?: readonly string[],
): HybridElement[] {
  const cat = catalog ?? HYROX_CATALOG;
  const runNote = cat.runNote ?? "race pace (threshold)";
  const ids = stationIds ?? cat.raceOrder;
  const els: HybridElement[] = [];
  for (const id of ids) {
    const label = cat.stations[id]?.label ?? id;
    if (cat.interStationRunMeters > 0) {
      els.push({ exercise: "run", prescription: `${cat.interStationRunMeters}m @ ${runNote}` });
    }
    const scale = hybridStationScale(id, false, emphasis);
    const spec = stationPrescription(label, phase, division, sex, cat, scale);
    els.push({ exercise: label.toLowerCase(), prescription: spec?.prescription ?? label });
  }
  return els;
}

/** Meters in one mile — local copy so this module stays free of session-volume. */
const M_PER_MILE = 1609.344;

/** True when a hybrid element is a run leg rather than a station. */
export function isRunElement(el: HybridElement): boolean {
  return /run/i.test(el.exercise) || /run/i.test(el.prescription);
}

/**
 * Estimated WORK minutes for a hybrid session — the runs at the athlete's own
 * threshold pace, the stations off `STATION_WORK_RATE`, plus a transition per
 * element.
 *
 * This replaces `elements.length * 5`, which was fine for the 4–6 element
 * sessions the AI used to write and badly wrong for a 16-element race-structure
 * session: every one of them billed at the same flat number regardless of how
 * fast the athlete actually runs 8 km. Under-billing a session is how a week
 * silently exceeds its band's hour ceiling.
 *
 * `thresholdSecPerMile` null → falls back to a 9:00/mi mid-pack assumption, so
 * an athlete with no run benchmark still gets a sane estimate.
 */
export function estimateHybridWorkMinutes(
  elements: readonly HybridElement[],
  thresholdSecPerMile: number | null,
  phase: PhaseName = "peak",
  division: Division = "open",
  sex: StationSex = "male",
  catalog?: StationCatalog,
  simulation = false,
  emphasis: readonly string[] = [],
): number {
  const cat = catalog ?? HYROX_CATALOG;
  const pace = thresholdSecPerMile && thresholdSecPerMile > 0 ? thresholdSecPerMile : 540;
  const TRANSITION_S = 20;
  let seconds = 0;
  for (const el of elements) {
    seconds += TRANSITION_S;
    if (isRunElement(el)) {
      const m = el.prescription.match(/(\d+(?:\.\d+)?)\s*m\b/);
      const meters = m ? parseFloat(m[1]!) : cat.interStationRunMeters;
      seconds += (meters / M_PER_MILE) * pace;
      continue;
    }
    const id = cat.matcher(el.exercise);
    if (!id) {
      seconds += 90;
      continue;
    }
    const label = cat.stations[id]?.label ?? id;
    const scale = hybridStationScale(id, simulation, emphasis);
    const spec = stationPrescription(label, phase, division, sex, cat, scale);
    seconds += spec ? stationWorkSeconds(spec) : 90;
  }
  return Math.round(seconds / 60);
}

/**
 * Trim a hybrid to the stations that fit inside the athlete's session cap,
 * rotating WHICH stations get dropped by week number.
 *
 * Levi's rule is every event every session; the cap is what can make that
 * impossible — a beginner's 90-minute ceiling will not hold 8 km of running plus
 * eight stations for a 7:00/km athlete. Dropping from the end of race order
 * every time would mean an athlete never once trains wall balls, so the start
 * point rotates: over a mesocycle the coverage is complete even when a single
 * session's isn't. Race ORDER within the session is always preserved.
 *
 * Returns the full list when it already fits, and never goes below `minStations`.
 */
export function fitHybridToCap(
  weekNumber: number,
  capWorkMinutes: number,
  thresholdSecPerMile: number | null,
  phase: PhaseName,
  division: Division = "open",
  sex: StationSex = "male",
  catalog?: StationCatalog,
  emphasis: readonly string[] = [],
  minStations = 4,
): string[] {
  const cat = catalog ?? HYROX_CATALOG;
  const order = cat.raceOrder;
  const floor = Math.min(minStations, order.length);

  for (let n = order.length; n >= floor; n--) {
    // Rotate the window start so a dropped station comes back next week.
    const start = n === order.length ? 0 : (weekNumber * (order.length - n)) % order.length;
    const ids = Array.from({ length: n }, (_, i) => order[(start + i) % order.length]!)
      // Race order, not window order: the session still reads like a race.
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const els = buildHybridElements(phase, division, sex, cat, emphasis, ids);
    const work = estimateHybridWorkMinutes(
      els,
      thresholdSecPerMile,
      phase,
      division,
      sex,
      cat,
      false,
      emphasis,
    );
    if (work <= capWorkMinutes || n === floor) return ids;
  }
  return [...order];
}

/** The HYROX station catalog bundle — the default for the station-hybrid engine. */
export const HYROX_CATALOG: StationCatalog = {
  stations: STATIONS,
  raceOrder: RACE_STATION_ORDER,
  interStationRunMeters: 1000,
  matcher: stationIdFor,
};
