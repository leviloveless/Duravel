/**
 * DEKA sport family — DekaFit, DekaMile, DekaStrong, DekaAtlas, DekaUltra.
 *
 * All five are Family A (station_hybrid, race_peaking). They reuse the HYROX
 * periodization/skeleton/prompt/station machinery and differ only in DATA:
 * station catalog, run geometry (interStationRunMeters / totalRaceRunMeters),
 * energy-system zone targets, session counts, volume bands, and copy. Strong &
 * Atlas are station-only (totalRaceRunMeters 0 → runFloor 0 + maintenance runs).
 * Ultra is 5 consecutive FIT laps (catalog.laps = 5).
 *
 * Values from docs/future-phases/16 (Stage-1 DEKA spec) + research-deka.
 * Loads are kg (engine convention); DEKA standards are lb — verify against the
 * versioned Rules PDF for the target season.
 */
import {
  type StationSpec,
  type StationCatalog,
  makeMatcher,
} from "../stations";
import {
  ZONE_DEFINITIONS,
  RUN_GUIDANCE,
  LIFT_GUIDANCE,
  TAPER_GUIDANCE,
} from "@/lib/ai/philosophy";
import type { PhaseName, ZoneDistribution } from "../types";
import type {
  SportConfig,
  ExperienceBand,
  NeedsDomainConfig,
  PhilosophyConfig,
} from "./types";

// --- Station catalogs -------------------------------------------------------

/** Canonical DEKA 10 zones (+ the 2 sibling variants for zones 4 & 8). */
export const DEKA_STATIONS: StationSpec[] = [
  { id: "deka_ram_lunge", label: "RAM Alternating Reverse Lunge", reps: 30, loadKg: { rx: { male: 25, female: 15 } }, match: /ram.*lunge|(reverse|alternating).*lunge/ },
  { id: "deka_row", label: "Row", meters: 500, match: /\brow\b/ },
  { id: "deka_box_over", label: "Box Step/Jump Over", reps: 20, match: /box.*(step|jump|over)|step.?over/ },
  { id: "deka_sit_up_throw", label: "Sit-Up Throw", reps: 25, loadKg: { rx: { male: 9, female: 6 } }, match: /sit.?up.*(throw|target)|throw.*sit/ },
  { id: "deka_med_ball_sit_up", label: "Med Ball Sit-Up", reps: 25, loadKg: { rx: { male: 9, female: 6 } }, match: /med.?ball.*sit|sit.?up(?!.*throw)/ },
  { id: "deka_ski", label: "Ski", meters: 500, match: /\bski\b/ },
  { id: "deka_farmers_carry", label: "Farmers Carry", meters: 100, perHand: true, loadKg: { rx: { male: 27.5, female: 17.5 } }, match: /farmer/ },
  { id: "deka_air_bike", label: "Air Bike", reps: "25 cal", match: /(assault|echo|air)\s*bike|air.?bike/ },
  { id: "deka_wall_over", label: "Dead Ball Wall-Over", reps: 20, loadKg: { rx: { male: 27.5, female: 17.5 } }, match: /(wall|yoke).?over|dead.?ball.*over/ },
  { id: "deka_dead_ball_over", label: "Dead Ball Shoulder-Over", reps: 20, loadKg: { rx: { male: 27.5, female: 17.5 } }, match: /dead.?ball.*(shoulder|over)|shoulder.?over/ },
  { id: "deka_sled", label: "Magnetic Sled Push/Pull", meters: 100, reps: "50m push + 50m pull", note: "Torque Tank Lvl 3 / Xebex Lvl 8 +160lb (M); Lvl 2 / Lvl 7 +160lb (F)", match: /sled/ },
  { id: "deka_ram_burpee", label: "RAM Weighted Burpee", reps: 20, loadKg: { rx: { male: 20, female: 10 } }, match: /ram.*burpee|weighted.*burpee|burpee/ },
];

/** Distinct heavier Atlas 10 zones (Rx + Foundation). No running. */
export const ATLAS_STATIONS: StationSpec[] = [
  { id: "atlas_thruster", label: "Barbell Thruster", reps: 20, loadKg: { rx: { male: 43, female: 29.5 }, foundation: { male: 29.5, female: 20.5 } }, match: /thruster/ },
  { id: "atlas_burpee_over_bar", label: "Bar-Facing Burpee Over Bar", reps: 20, match: /burpee.*(bar|over)|bar.?facing/ },
  { id: "atlas_surrender_lunge", label: "Surrender Lunge", reps: 20, loadKg: { rx: { male: 22.5, female: 16 }, foundation: { male: 16, female: 11 } }, match: /surrender.*lunge/ },
  { id: "atlas_db_g2oh", label: "Single-Arm DB Ground-to-Overhead", reps: 20, loadKg: { rx: { male: 22.5, female: 16 }, foundation: { male: 16, female: 11 } }, match: /(ground|g2oh).*overhead|single.?arm.*db/ },
  { id: "atlas_db_bear_crawl", label: "DB Bear Crawl", meters: 40, perHand: true, loadKg: { rx: { male: 22.5, female: 16 }, foundation: { male: 16, female: 11 } }, match: /bear.?crawl/ },
  { id: "atlas_weighted_sit_up", label: "Weighted Sit-Up", reps: 20, loadKg: { rx: { male: 16, female: 9 }, foundation: { male: 9, female: 6 } }, match: /weighted.*sit|sit.?up/ },
  { id: "atlas_farmers_carry", label: "Farmers Carry", meters: 60, perHand: true, loadKg: { rx: { male: 45, female: 32 }, foundation: { male: 32, female: 22.5 } }, match: /farmer/ },
  { id: "atlas_db_s2oh", label: "DB Shoulder-to-Overhead", reps: 20, perHand: true, loadKg: { rx: { male: 22.5, female: 16 }, foundation: { male: 16, female: 11 } }, match: /(shoulder|s2oh).*overhead|db.*shoulder/ },
  { id: "atlas_single_unders", label: "Single-Unders (Jump Rope)", reps: 100, match: /single.?under|jump.?rope/ },
  { id: "atlas_shoulder_to_carry", label: "Atlas Shoulder-to-Carry", meters: 100, loadKg: { rx: { male: 45, female: 32 }, foundation: { male: 32, female: 22.5 } }, match: /atlas.*(carry|shoulder)|shoulder.?to.?carry/ },
];

const toMap = (specs: StationSpec[]): Record<string, StationSpec> =>
  Object.fromEntries(specs.map((s) => [s.id, s]));

const DEKA_MAP = toMap(DEKA_STATIONS);
const ATLAS_MAP = toMap(ATLAS_STATIONS);
const dekaMatcher = makeMatcher(DEKA_STATIONS);
const atlasMatcher = makeMatcher(ATLAS_STATIONS);

// Race orders: FIT/ULTRA use throw(Z4)+wall-over(Z8); MILE/STRONG use tap(Z4)+shoulder-over(Z8).
const FIT_ORDER = ["deka_ram_lunge", "deka_row", "deka_box_over", "deka_sit_up_throw", "deka_ski", "deka_farmers_carry", "deka_air_bike", "deka_wall_over", "deka_sled", "deka_ram_burpee"];
const MILE_ORDER = ["deka_ram_lunge", "deka_row", "deka_box_over", "deka_med_ball_sit_up", "deka_ski", "deka_farmers_carry", "deka_air_bike", "deka_dead_ball_over", "deka_sled", "deka_ram_burpee"];
const ATLAS_ORDER = ["atlas_thruster", "atlas_burpee_over_bar", "atlas_surrender_lunge", "atlas_db_g2oh", "atlas_db_bear_crawl", "atlas_weighted_sit_up", "atlas_farmers_carry", "atlas_db_s2oh", "atlas_single_unders", "atlas_shoulder_to_carry"];

const dekaCatalog = (raceOrder: string[], runM: number, extra?: Partial<StationCatalog>): StationCatalog => ({
  stations: DEKA_MAP,
  raceOrder,
  interStationRunMeters: runM,
  matcher: dekaMatcher,
  ...extra,
});

// --- Experience bands -------------------------------------------------------

const RUNNING_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "under 15 miles/week sustained over the last 6 months" },
  { level: "intermediate", criterion: "15–30 miles/week sustained over the last 6 months" },
  { level: "advanced", criterion: "over 30 miles/week sustained over the last 6 months" },
];
const HYBRID_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "≤1 hybrid/HIIT workout per week over the last 6 months" },
  { level: "intermediate", criterion: "2 hybrid/HIIT workouts per week over the last 6 months" },
  { level: "advanced", criterion: "≥3 hybrid/HIIT workouts per week over the last 6 months" },
];
const LIFTING_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "lifting consistently for under 3 years" },
  { level: "intermediate", criterion: "lifting consistently for 3–5 years" },
  { level: "advanced", criterion: "lifting consistently for over 5 years" },
];
const ATLAS_LIFTING_BANDS: ExperienceBand[] = [
  { level: "beginner", criterion: "under 3 yr lifting; below 95lb thruster ×20 or 100lb/hand carry" },
  { level: "intermediate", criterion: "3–5 yr; can complete Rx thruster + carry loads" },
  { level: "advanced", criterion: "over 5 yr; Rx loads unbroken, relative squat >1.75× / press >0.9×" },
];

// --- Needs domains (registry contract; scoring wired per-sport later) --------

// Station names (matching the philosophy libraries) the needs analysis emphasizes
// toward an erg / strength limiter — the DEKA analog of HYROX ERG/STRENGTH_STATIONS.
const DEKA_NEEDS_STATIONS = {
  erg: ["row", "ski", "air bike"],
  strength: ["magnetic sled push/pull", "farmers carry", "ram alternating reverse lunge", "dead ball shoulder-over", "ram weighted burpee", "box step/jump over"],
} as const;
const ATLAS_NEEDS_STATIONS = {
  erg: ["single-unders", "bar-facing burpee over bar"],
  strength: ["barbell thruster", "db shoulder-to-overhead", "farmers carry", "atlas shoulder-to-carry", "surrender lunge", "single-arm db ground-to-overhead"],
} as const;

const DEKA_NEEDS: NeedsDomainConfig[] = [
  { key: "run_engine", label: "running endurance", scorerId: "run_engine", anchors: { male: [360, 720], female: [396, 792] }, weight: 1 },
  { key: "erg_engine", label: "erg / non-running cardio", scorerId: "erg_engine", anchors: { male: [88, 125], female: [100, 143] }, weight: 1 },
  { key: "strength", label: "maximal strength", scorerId: "strength", anchors: { male: [1.0, 2.25], female: [0.8, 1.8] }, weight: 1 },
];
const ATLAS_NEEDS: NeedsDomainConfig[] = [
  { key: "strength", label: "absolute strength", scorerId: "strength", anchors: { male: [1.0, 2.25], female: [0.8, 1.8] }, weight: 1 },
  { key: "press_endurance", label: "overhead pressing endurance", scorerId: "press_endurance", anchors: { male: [12, 40], female: [8, 30] }, weight: 1 },
  { key: "glycolytic", label: "glycolytic capacity", scorerId: "glycolytic", anchors: { male: [210, 90], female: [240, 105] }, weight: 1 },
];

// --- Philosophy: guidance + libraries + phase character ----------------------

const DEKA_STATION_LIBRARY: Record<PhaseName, string[]> = {
  base: ["row", "ski", "air bike", "farmers carry", "med ball sit-up"],
  build: ["row", "ski", "ram alternating reverse lunge", "farmers carry", "dead ball shoulder-over", "box step/jump over"],
  peak: ["row", "ski", "magnetic sled push/pull", "farmers carry", "dead ball shoulder-over", "ram weighted burpee", "box step/jump over", "ram alternating reverse lunge"],
  taper: ["row", "ski", "farmers carry"],
};
const ATLAS_STATION_LIBRARY: Record<PhaseName, string[]> = {
  base: ["barbell thruster", "db shoulder-to-overhead", "farmers carry", "weighted sit-up", "single-unders"],
  build: ["barbell thruster", "single-arm db ground-to-overhead", "db shoulder-to-overhead", "surrender lunge", "farmers carry", "bar-facing burpee over bar"],
  peak: ["barbell thruster", "single-arm db ground-to-overhead", "db shoulder-to-overhead", "atlas shoulder-to-carry", "farmers carry", "surrender lunge", "db bear crawl", "bar-facing burpee over bar"],
  taper: ["barbell thruster", "db shoulder-to-overhead", "single-unders"],
};

const DEKA_PHASE_CHARACTER: Record<PhaseName, string> = {
  base: "Aerobic + general strength foundation. Easy running dominant, one fartlek quality run; build work capacity on the ergs and carries; light station circuits.",
  build: "Rising specificity. Short, sharp 500m repeat-run economy; station circuits at race reps; add threshold and interval work; transition efficiency (fast on/off ergs).",
  peak: "Race-specific 10-zone simulations, high intensity, volume drops. Sled leg-drive, grip endurance, and glycolytic finishers; maximum circuit specificity.",
  taper: "Reduced volume, intensity held to the final days. Short openers keep the legs and pulls snappy; minimal lifting; one light circuit.",
};
const ATLAS_PHASE_CHARACTER: Record<PhaseName, string> = {
  base: "Absolute-strength + work-capacity base. Heavy compound lifting (thruster, press, carry patterns); low aerobic maintenance; light barbell/DB circuits.",
  build: "Strength-endurance specificity. Overhead-pressing volume, loaded carries, barbell metcons at moderate load; glycolytic couplets.",
  peak: "Heavy 10-zone Atlas simulations, overhead-endurance and grip under fatigue; max strength maintained, capacity sharpened; volume drops.",
  taper: "Sharpen and freshen. Keep intensity/quality on the main lifts; cut volume; light single-under conditioning.",
};

const DEKA_HYBRID_GUIDANCE = (runM: number, zones: number): string =>
  runM > 0
    ? `Hybrid sessions simulate the DEKA format: ${zones} functional "zones" in order, each preceded by a ${runM}m run (run → zone → run → zone …). Each run is at threshold effort (give the pace); each zone is a short functional station. The "elements" array alternates run and zone entries. The engine rewrites zone prescriptions to the DEKA race spec (loads, phase-progressed reps/meters), so you only pick the zones from the library; assign a goal HR zone (typically Zone 3–4). 25–50 min of work.`
    : `Hybrid sessions are DEKA station circuits: ${zones} functional "zones" performed back-to-back with NO running between them ("all work, no runs"). The "elements" array is zones only. The engine rewrites zone prescriptions to race spec, so you pick zones from the library and order them for a hard, continuous glycolytic effort; assign a goal HR zone (Zone 3–5). 10–25 min of work.`;

const dekaPhilosophy = (coach: string, runM: number, zones: number, library: Record<PhaseName, string[]>, character: Record<PhaseName, string>): PhilosophyConfig => ({
  coach,
  guidance: [ZONE_DEFINITIONS, RUN_GUIDANCE, LIFT_GUIDANCE, DEKA_HYBRID_GUIDANCE(runM, zones), TAPER_GUIDANCE],
  stationLibrary: library,
  phaseCharacter: character,
});

// --- Zone-target tables (energy-system calibrated; sum to 100) ---------------

const ZT = (b: ZoneDistribution, bu: ZoneDistribution, p: ZoneDistribution, t: ZoneDistribution): Record<PhaseName, ZoneDistribution> => ({ base: b, build: bu, peak: p, taper: t });

// --- The 5 SportConfigs ------------------------------------------------------

export const deka_fit: SportConfig = {
  id: "deka_fit", family: "station_hybrid", displayName: "DEKA FIT", programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],
  sessionCounts: { run: { base: [3, 4, 5], build: [4, 5, 5], peak: [3, 4, 4], taper: [2, 3, 3] }, hybrid: { base: 1, build: 2, peak: 3, taper: 1 }, lift: { base: 3, build: 3, peak: 3, taper: 2 } },
  stations: DEKA_MAP, raceStationOrder: FIT_ORDER, stationCatalog: dekaCatalog(FIT_ORDER, 500), interStationRunMeters: 500, totalRaceRunMeters: 5000,
  phaseZoneTargets: ZT({ z1: 22, z2: 58, z3: 11, z4: 6, z5: 3 }, { z1: 18, z2: 54, z3: 15, z4: 9, z5: 4 }, { z1: 14, z2: 48, z3: 17, z4: 13, z5: 8 }, { z1: 16, z2: 54, z3: 15, z4: 10, z5: 5 }),
  needsDomains: DEKA_NEEDS,
  needsStations: DEKA_NEEDS_STATIONS,
  experienceAxes: [
    { key: "running", label: "Running", bands: RUNNING_BANDS, needsWeight: 1.0 },
    { key: "hybrid", label: "HIIT / Hybrid", bands: HYBRID_BANDS, needsWeight: 1.0 },
    { key: "lifting", label: "Lifting", bands: LIFTING_BANDS, needsWeight: 0.9 },
  ],
  volume: { kind: "single_currency", startMileageByExp: { beginner: 8, intermediate: 15, advanced: 24 }, avgMinPerMile: 18 },
  philosophy: dekaPhilosophy("expert DEKA FIT coach", 500, 10, DEKA_STATION_LIBRARY, DEKA_PHASE_CHARACTER),
};

export const deka_mile: SportConfig = {
  id: "deka_mile", family: "station_hybrid", displayName: "DEKA MILE", programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],
  sessionCounts: { run: { base: [3, 3, 4], build: [3, 4, 4], peak: [3, 3, 4], taper: [2, 2, 3] }, hybrid: { base: 1, build: 2, peak: 3, taper: 1 }, lift: { base: 3, build: 3, peak: 3, taper: 2 } },
  stations: DEKA_MAP, raceStationOrder: MILE_ORDER, stationCatalog: dekaCatalog(MILE_ORDER, 160), interStationRunMeters: 160, totalRaceRunMeters: 1600,
  phaseZoneTargets: ZT({ z1: 20, z2: 55, z3: 12, z4: 8, z5: 5 }, { z1: 16, z2: 48, z3: 15, z4: 13, z5: 8 }, { z1: 12, z2: 40, z3: 16, z4: 18, z5: 14 }, { z1: 14, z2: 48, z3: 16, z4: 13, z5: 9 }),
  needsDomains: DEKA_NEEDS,
  needsStations: DEKA_NEEDS_STATIONS,
  experienceAxes: [
    { key: "running", label: "Running (speed)", bands: RUNNING_BANDS, needsWeight: 1.0 },
    { key: "hybrid", label: "HIIT / Hybrid", bands: HYBRID_BANDS, needsWeight: 1.0 },
    { key: "lifting", label: "Lifting", bands: LIFTING_BANDS, needsWeight: 0.9 },
  ],
  volume: { kind: "single_currency", startMileageByExp: { beginner: 5, intermediate: 8, advanced: 12 }, avgMinPerMile: 18 },
  philosophy: dekaPhilosophy("expert DEKA MILE coach", 160, 10, DEKA_STATION_LIBRARY, DEKA_PHASE_CHARACTER),
};

export const deka_strong: SportConfig = {
  id: "deka_strong", family: "station_hybrid", displayName: "DEKA STRONG", programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],
  sessionCounts: { run: { base: [1, 1, 1], build: [1, 1, 1], peak: [0, 1, 1], taper: [0, 0, 1] }, hybrid: { base: 2, build: 3, peak: 4, taper: 2 }, lift: { base: 3, build: 3, peak: 3, taper: 2 } },
  runFloor: 0,
  stations: DEKA_MAP, raceStationOrder: MILE_ORDER, stationCatalog: dekaCatalog(MILE_ORDER, 0), interStationRunMeters: 0, totalRaceRunMeters: 0,
  phaseZoneTargets: ZT({ z1: 18, z2: 47, z3: 20, z4: 11, z5: 4 }, { z1: 14, z2: 40, z3: 22, z4: 16, z5: 8 }, { z1: 12, z2: 33, z3: 22, z4: 21, z5: 12 }, { z1: 14, z2: 40, z3: 21, z4: 17, z5: 8 }),
  needsDomains: DEKA_NEEDS,
  needsStations: DEKA_NEEDS_STATIONS,
  experienceAxes: [
    { key: "lifting", label: "Lifting", bands: LIFTING_BANDS, needsWeight: 1.0 },
    { key: "hybrid", label: "Work Capacity / Hybrid", bands: HYBRID_BANDS, needsWeight: 1.0 },
    { key: "running", label: "Aerobic (maintenance)", bands: RUNNING_BANDS, needsWeight: 0.3 },
  ],
  volume: { kind: "single_currency", startMileageByExp: { beginner: 3, intermediate: 5, advanced: 8 }, avgMinPerMile: 18 },
  philosophy: dekaPhilosophy("expert DEKA STRONG coach", 0, 10, DEKA_STATION_LIBRARY, DEKA_PHASE_CHARACTER),
};

export const deka_atlas: SportConfig = {
  id: "deka_atlas", family: "station_hybrid", displayName: "DEKA ATLAS", programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],
  sessionCounts: { run: { base: [1, 1, 1], build: [0, 1, 1], peak: [0, 0, 1], taper: [0, 0, 0] }, hybrid: { base: 2, build: 3, peak: 3, taper: 1 }, lift: { base: 3, build: 3, peak: 3, taper: 2 } },
  runFloor: 0,
  stations: ATLAS_MAP, raceStationOrder: ATLAS_ORDER, stationCatalog: { stations: ATLAS_MAP, raceOrder: ATLAS_ORDER, interStationRunMeters: 0, matcher: atlasMatcher }, interStationRunMeters: 0, totalRaceRunMeters: 0,
  phaseZoneTargets: ZT({ z1: 18, z2: 45, z3: 22, z4: 11, z5: 4 }, { z1: 15, z2: 40, z3: 23, z4: 15, z5: 7 }, { z1: 13, z2: 35, z3: 23, z4: 19, z5: 10 }, { z1: 15, z2: 42, z3: 22, z4: 15, z5: 6 }),
  needsDomains: ATLAS_NEEDS,
  needsStations: ATLAS_NEEDS_STATIONS,
  experienceAxes: [
    { key: "lifting", label: "Lifting (absolute strength)", bands: ATLAS_LIFTING_BANDS, needsWeight: 1.0 },
    { key: "hybrid", label: "Barbell metcon / capacity", bands: HYBRID_BANDS, needsWeight: 0.8 },
    { key: "running", label: "Aerobic (maintenance)", bands: RUNNING_BANDS, needsWeight: 0.15 },
  ],
  volume: { kind: "single_currency", startMileageByExp: { beginner: 3, intermediate: 5, advanced: 8 }, avgMinPerMile: 18 },
  philosophy: dekaPhilosophy("expert DEKA ATLAS strength-conditioning coach", 0, 10, ATLAS_STATION_LIBRARY, ATLAS_PHASE_CHARACTER),
};

export const deka_ultra: SportConfig = {
  id: "deka_ultra", family: "station_hybrid", displayName: "DEKA ULTRA", programType: "race_peaking",
  modalities: ["run", "lift", "hybrid", "rest", "race"],
  sessionCounts: { run: { base: [4, 5, 6], build: [4, 5, 6], peak: [3, 4, 5], taper: [2, 3, 3] }, hybrid: { base: 1, build: 2, peak: 2, taper: 1 }, lift: { base: 3, build: 3, peak: 3, taper: 2 } },
  stations: DEKA_MAP, raceStationOrder: FIT_ORDER,
  stationCatalog: dekaCatalog(FIT_ORDER, 500, { laps: 5, runNote: "controlled effort (Z2–Z3)" }),
  interStationRunMeters: 500, totalRaceRunMeters: 25000,
  phaseZoneTargets: ZT({ z1: 26, z2: 63, z3: 6, z4: 3, z5: 2 }, { z1: 22, z2: 62, z3: 9, z4: 5, z5: 2 }, { z1: 18, z2: 60, z3: 12, z4: 7, z5: 3 }, { z1: 20, z2: 61, z3: 11, z4: 5, z5: 3 }),
  needsDomains: DEKA_NEEDS,
  needsStations: DEKA_NEEDS_STATIONS,
  experienceAxes: [
    { key: "running", label: "Running / Aerobic base", bands: RUNNING_BANDS, needsWeight: 1.5 },
    { key: "hybrid", label: "Hybrid durability", bands: HYBRID_BANDS, needsWeight: 0.9 },
    { key: "lifting", label: "Lifting", bands: LIFTING_BANDS, needsWeight: 0.7 },
  ],
  volume: { kind: "single_currency", startMileageByExp: { beginner: 20, intermediate: 32, advanced: 45 }, avgMinPerMile: 18 },
  philosophy: dekaPhilosophy("expert DEKA ULTRA / ultra-hybrid coach", 500, 10, DEKA_STATION_LIBRARY, DEKA_PHASE_CHARACTER),
  dutyOfCare: {
    longSessionFlagMinutes: 150,
    fueling: { carbGramsPerHour: [60, 90], hydrationMlPerHour: [500, 1000], sodiumMgPerHour: [300, 1500] },
    warnings: [
      "Rehearse race fueling on long sessions — never debut nutrition on race day.",
      "Multi-hour event: watch cumulative hydration/sodium; carry fuel + a bail-out plan on 4h+ simulations.",
    ],
    gateBeginners: true,
  },
};

export const DEKA_SPORTS = { deka_fit, deka_mile, deka_strong, deka_atlas, deka_ultra };
