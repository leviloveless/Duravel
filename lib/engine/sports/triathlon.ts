/**
 * Triathlon — Ironman 70.3 and 140.6.
 *
 * The one Family-B sport: swim/bike/run + bricks, per-discipline volume (hours,
 * not miles). buildSkeleton routes a triathlon sport to buildTriathlonSkeleton
 * (below), which reuses the shared phase allocation + microcycle cadence but
 * distributes weekly time across the disciplines by a phase-dependent balance
 * and emits swim/bike/run/brick session slots with prescribed durations.
 *
 * SCOPE (this pass): the deterministic periodized skeleton. The AI session-content
 * fill, unified TSS load + adaptation, CSS/FTP onboarding, and per-discipline
 * zone display are the remaining integration (see docs/future-phases/17 + 01).
 *
 * Values from docs/future-phases/17 + research-triathlon (Friel/MyProCoach/
 * TrainingPeaks/Seiler). Distinguishes 70.3 from 140.6 throughout.
 */
import { allocateMesocycles, expandPhases } from "../mesocycles";
import { microcyclePattern } from "../microcycles";
import { parseTimeToSeconds } from "../paces";
import type {
  EngineInput,
  MicroWeekType,
  PhaseName,
  ProgramSkeleton,
  SessionSlot,
  WeekSkeleton,
  DaySlot,
  ZoneDistribution,
} from "../types";
import type { SportConfig, ExperienceBand, NeedsDomainConfig, PhaseCountTable } from "./types";
import type { ProgramData, ProgramWeek, ProgramDay, Session } from "@/lib/schemas";

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

export const TRI_SPORTS = { tri_70_3, tri_140_6 };

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

// --- deterministic triathlon skeleton builder -------------------------------

const EXP_INDEX: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const INDEX_EXP: Level[] = ["beginner", "intermediate", "advanced"];
const A_TAPER = [0.8, 0.6]; // 2-week taper factors from peak

/**
 * Blended volume tier across the three disciplines. Each discipline defaults to
 * the athlete's run level when its anchor (CSS / FTP) is missing, so an absent
 * benchmark neither raises nor lowers the tier. The rounded average lets a
 * strong cyclist or swimmer carry more volume than run experience alone implies.
 */
export function triVolumeLevel(input: EngineInput): Level {
  const run = EXP_INDEX[input.runningExp] ?? 1;
  const swim = input.swimLevel ? EXP_INDEX[input.swimLevel]! : run;
  const bike = input.bikeLevel ? EXP_INDEX[input.bikeLevel]! : run;
  const avg = Math.round((run + swim + bike) / 3);
  return INDEX_EXP[Math.min(2, Math.max(0, avg))]!;
}

function n(table: PhaseCountTable | undefined, phase: PhaseName, idx: number): number {
  const v = table?.[phase];
  if (v === undefined) return 0;
  return Array.isArray(v) ? (v[idx] ?? 0) : v;
}

const SWIM_ZONE: Record<string, number> = { technique: 2, css: 4, threshold: 4, endurance: 2, open_water: 2 };
const BIKE_ZONE: Record<string, number> = { endurance: 2, sweet_spot: 3, threshold: 4, vo2: 5, recovery: 1 };

/** Distance key used to look up per-level hours ("70_3" | "140_6"). */
function distanceKey(sport: string): string {
  return sport === "tri_140_6" ? "140_6" : "70_3";
}

function triSessions(phase: PhaseName, totalMin: number, cfg: SportConfig, idx: number): SessionSlot[] {
  const bal = BALANCE[phase];
  const swimN = n(cfg.sessionCounts.swim, phase, idx);
  const bikeN = n(cfg.sessionCounts.bike, phase, idx);
  const runN = n(cfg.sessionCounts.run, phase, idx);
  const brickN = n(cfg.sessionCounts.brick, phase, idx);

  const per = (share: number, count: number) => (count > 0 ? Math.max(20, Math.round((totalMin * share) / count)) : 0);
  const swimMin = per(bal.swim, swimN);
  const bikeMin = per(bal.bike, bikeN);
  const runMin = per(bal.run, runN);

  const slots: SessionSlot[] = [];

  for (let k = 0; k < swimN; k++) {
    const sessionType = k === 0 && phase !== "base" ? "css" : phase === "base" ? "technique" : "endurance";
    slots.push({ kind: "swim", goalZone: SWIM_ZONE[sessionType]!, durationMin: swimMin, sessionType });
  }
  for (let k = 0; k < bikeN; k++) {
    const isLong = k === 0;
    const sessionType = isLong ? "endurance" : phase === "build" || phase === "peak" ? "sweet_spot" : "endurance";
    slots.push({ kind: "bike", goalZone: BIKE_ZONE[sessionType]!, durationMin: isLong ? Math.round(bikeMin * 1.4) : bikeMin, isLong, sessionType });
  }
  for (let k = 0; k < runN; k++) {
    const isLong = k === 0;
    const runType = isLong ? "long" : k === 1 && (phase === "build" || phase === "peak") ? "tempo" : "easy";
    slots.push({ kind: "run", runType, goalZone: runType === "tempo" ? 3 : 2, isLong, durationMin: isLong ? Math.round(runMin * 1.4) : runMin });
  }
  for (let k = 0; k < brickN; k++) {
    const bikeSeg = Math.round(bikeMin * (phase === "peak" ? 1.6 : 1.2));
    const runSeg = Math.min(90, Math.round(runMin * 0.7));
    slots.push({
      kind: "brick",
      goalZone: 3,
      segments: [
        { discipline: "bike", durationMin: bikeSeg, goalZone: 2 },
        { discipline: "run", durationMin: runSeg, goalZone: 3 },
      ],
    });
  }
  return slots;
}

/** Round-robin the sessions across the training days; empty days become rest. */
function distributeTri(trainingDays: EngineInput["trainingDays"], slots: SessionSlot[]): DaySlot[] {
  const days: DaySlot[] = trainingDays.map((day) => ({ day, sessions: [] as SessionSlot[] }));
  slots.forEach((s, i) => {
    days[i % days.length]!.sessions.push(s);
  });
  for (const d of days) if (d.sessions.length === 0) d.sessions.push({ kind: "rest" });
  return days;
}

export function buildTriathlonSkeleton(input: EngineInput, cfg: SportConfig): ProgramSkeleton {
  const D = input.durationWeeks;
  const alloc = allocateMesocycles(input);
  const phases = expandPhases(alloc, D);
  const pattern = microcyclePattern(input.trainingClass, input.age);
  const level = triVolumeLevel(input); // blended swim/bike/run volume tier
  const idx = EXP_INDEX[level] ?? 1;
  const key = `${distanceKey(cfg.id)}:${level}`;
  const hours =
    cfg.volume.kind === "per_discipline" ? (cfg.volume.hoursPerWeekByLevel[key] ?? [8, 14]) : [8, 14];
  const [baseH, peakH] = hours as [number, number];
  const nonTaper = alloc.base + alloc.build + alloc.peak;

  const weeks: WeekSkeleton[] = [];
  let taperWeek = 0;
  for (let i = 0; i < D; i++) {
    const phase = phases[i]!;
    let micro: MicroWeekType = phase === "taper" ? "taper" : pattern[i % pattern.length]!;
    // Ramp base→peak across the working weeks.
    const progress = nonTaper > 1 ? Math.min(1, i / (nonTaper - 1)) : 1;
    let hoursThis = baseH + (peakH - baseH) * progress;
    if (micro === "deload") hoursThis *= 0.65;
    if (phase === "taper") {
      hoursThis = peakH * (A_TAPER[Math.min(taperWeek, A_TAPER.length - 1)] ?? 0.6);
      taperWeek += 1;
      if (i === D - 1 && input.races.length > 0) micro = "race";
    }
    const totalMin = Math.round(hoursThis * 60);

    weeks.push({
      weekNumber: i + 1,
      phase,
      microWeek: micro,
      targetMileage: 0, // triathlon volume is tracked in per-discipline minutes, not miles
      targetCardioMinutes: totalMin,
      zoneTargets: { ...cfg.phaseZoneTargets[phase] },
      days: distributeTri(input.trainingDays, triSessions(phase, totalMin, cfg, idx)),
    });
  }

  return { durationWeeks: D, trainingClass: input.trainingClass, allocation: alloc, weeks, needs: input.needs };
}

// --- deterministic session content builders (individualized by anchors) -----

/** Athlete anchors that make session content specific (target pace / watts). */
export interface TriAnchors {
  /** Swim CSS in seconds per 100 m. */
  cssSec?: number;
  /** Bike FTP in watts. */
  ftpWatts?: number;
}

/** Pull swim CSS (sec/100 m) + bike FTP from the athlete's benchmarks. */
export function triAnchorsFromBenchmarks(b?: { cssPace?: string; ftpWatts?: number }): TriAnchors {
  const cssSec = b?.cssPace ? parseTimeToSeconds(b.cssPace) : null;
  return {
    cssSec: cssSec && cssSec > 0 ? cssSec : undefined,
    ftpWatts: b?.ftpWatts && b.ftpWatts > 0 ? b.ftpWatts : undefined,
  };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function fmtCssPace(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/100m`;
}
/** Coggan-band watt (or % FTP fallback) range label. */
function wattRange(a: TriAnchors, lo: number, hi: number): string {
  if (!a.ftpWatts) return `${Math.round(lo * 100)}–${Math.round(hi * 100)}% FTP`;
  return `${Math.round(a.ftpWatts * lo)}–${Math.round(a.ftpWatts * hi)}W`;
}

/** Swim set built to the prescribed duration, paced off CSS when known. */
function swimContent(type: string, durationMin: number, a: TriAnchors): string {
  const cssLabel = a.cssSec ? fmtCssPace(a.cssSec) : "CSS pace";
  const mPerMin = a.cssSec ? 6000 / (a.cssSec + 12) : 46; // includes rest/turns
  const dist = Math.max(400, Math.round((durationMin * mPerMin) / 50) * 50);
  switch (type) {
    case "technique": {
      const drills = clampInt((dist * 0.3) / 50, 4, 12);
      return `Warm-up 200m easy. Drill set ${drills}×50m (catch-up, single-arm, scull) on 15s rest, then ${Math.round(dist * 0.35)}m aerobic swim focusing on stroke length. Cool-down 100m. ~${dist}m total.`;
    }
    case "css": {
      const reps = clampInt((dist * 0.55) / 100, 6, 24);
      return `Warm-up 300m mixed. Main set ${reps}×100m @ ${cssLabel} on ~15s rest — hold pace even, not a fade. Cool-down 200m. ~${dist}m total.`;
    }
    case "threshold": {
      const reps = clampInt((dist * 0.5) / 200, 3, 8);
      return `Warm-up 300m. Main set ${reps}×200m at threshold (~${cssLabel}) on 20s rest. Cool-down 200m. ~${dist}m total.`;
    }
    case "endurance":
      return `Continuous ~${dist}m at an easy, steady aerobic effort (Zone 2) — smooth, relaxed, long stroke.`;
    case "open_water":
      return `Open-water skills over ~${dist}m: sight every 6–8 strokes, practise drafting on feet, and 3–4 race-pace surges off simulated starts.`;
    default:
      return `~${dist}m aerobic swim.`;
  }
}

/** Bike set built to the prescribed duration, paced off FTP when known. */
function bikeContent(type: string, durationMin: number, isLong: boolean | undefined, a: TriAnchors): string {
  const longNote = isLong ? " Rehearse race fuel + hydration on this ride." : "";
  switch (type) {
    case "endurance":
      return `Steady Zone 2 aerobic ride, ${durationMin} min at ${wattRange(a, 0.56, 0.75)} — the aerobic cornerstone. Keep it conversational and hold aero where you can.${longNote}`;
    case "sweet_spot": {
      const reps = clampInt((durationMin - 25) / 13, 2, 5);
      return `Warm-up 12 min. Main set ${reps}×10 min @ ${wattRange(a, 0.88, 0.94)} (sweet spot) with 4 min easy between. Cool-down. ${durationMin} min total.${longNote}`;
    }
    case "threshold": {
      const reps = clampInt((durationMin - 25) / 24, 2, 3);
      return `Warm-up 15 min. Main set ${reps}×18 min @ ${wattRange(a, 0.95, 1.05)} (threshold) with 6 min easy between. Cool-down. ${durationMin} min total.${longNote}`;
    }
    case "vo2": {
      const reps = clampInt((durationMin - 18) / 6, 4, 6);
      return `Warm-up 15 min. Main set ${reps}×3 min @ ${wattRange(a, 1.1, 1.2)} (VO₂max) with 3 min easy spin between. Cool-down. ${durationMin} min total.`;
    }
    case "recovery":
      return `Easy recovery spin, ${durationMin} min fully aerobic (${wattRange(a, 0, 0.55)}), high cadence and light.`;
    default:
      return `${durationMin} min aerobic ride.`;
  }
}

/** Triathlon run content (effort-based; triathlon runs are paced off HR/feel). */
function runContentTri(runType: string, durationMin: number): string {
  switch (runType) {
    case "long":
      return `Long aerobic run, ${durationMin} min at an easy, steady Zone 2 effort — hold form and cadence as fatigue builds.`;
    case "tempo":
      return `Warm-up 10 min easy, then a sustained tempo block at Zone 3 race effort, cool-down. ${durationMin} min total.`;
    case "easy":
    default:
      return `Easy Zone 2 aerobic run, ${durationMin} min — conversational and relaxed.`;
  }
}

/** Brick content from the ordered segments. */
function brickContent(segments: { discipline: string; durationMin: number }[]): string {
  const bike = segments.find((s) => s.discipline === "bike");
  const run = segments.find((s) => s.discipline === "run");
  const bikePart = bike ? `Ride ${bike.durationMin} min building to Zone 2–3` : "Ride the bike segment";
  const runPart = run ? `run ${run.durationMin} min immediately off the bike` : "run immediately off the bike";
  return `Brick — bike→run in one session. ${bikePart}, then transition fast and ${runPart} at a controlled Zone 3 effort. Your legs feel heavy the first km — hold target pace through it. The single most race-specific session.`;
}

// --- deterministic triathlon program-data assembler (no AI) -----------------

function slotToSession(slot: SessionSlot, a: TriAnchors): Session | null {
  switch (slot.kind) {
    case "swim":
      return {
        kind: "swim",
        durationMin: slot.durationMin,
        goalZone: slot.goalZone,
        sessionType: slot.sessionType,
        description: swimContent(slot.sessionType, slot.durationMin, a),
      };
    case "bike":
      return {
        kind: "bike",
        durationMin: slot.durationMin,
        goalZone: slot.goalZone,
        sessionType: slot.sessionType,
        isLong: slot.isLong,
        description: bikeContent(slot.sessionType, slot.durationMin, slot.isLong, a),
      };
    case "brick":
      return {
        kind: "brick",
        goalZone: slot.goalZone,
        segments: slot.segments.map((s) => ({
          discipline: s.discipline,
          durationMin: s.durationMin,
          goalZone: s.goalZone,
          note: s.discipline === "run" ? "Off the bike — controlled effort, quick cadence." : undefined,
        })),
        description: brickContent(slot.segments),
      };
    case "run":
      return {
        kind: "run",
        runType: slot.runType,
        durationMin: slot.durationMin ?? 40,
        paceMinMile: "by effort",
        distanceMiles: 0,
        goalZone: slot.goalZone,
        description: runContentTri(slot.runType, slot.durationMin ?? 40),
      };
    case "race":
      return { kind: "race", priority: slot.priority };
    case "rest":
      return null;
    default:
      return null; // lift/hybrid never occur in a triathlon skeleton
  }
}

/**
 * Deterministically assemble a triathlon ProgramData directly from the skeleton —
 * no AI. The skeleton slots already carry per-session durations, zones, and types;
 * this maps each to a session whose content (sets, target pace/watts) is computed
 * from its duration and individualized by the athlete's CSS / FTP anchors.
 */
/** Map one skeleton week (slots already resolved) to a ProgramWeek. */
export function triWeekToProgramWeek(w: WeekSkeleton, anchors: TriAnchors = {}): ProgramWeek {
  const days: ProgramDay[] = w.days.map((d) => ({
    day: d.day,
    sessions: d.sessions.map((s) => slotToSession(s, anchors)).filter((s): s is Session => s !== null),
  }));
  return {
    weekNumber: w.weekNumber,
    phase: w.phase,
    microWeek: w.microWeek,
    summary: {
      totalCardioMinutes: w.targetCardioMinutes,
      totalMileage: 0,
      zoneDistribution: { ...w.zoneTargets },
    },
    days,
    ...(w.raceDay ? { raceDay: w.raceDay } : {}),
  };
}

export function buildTriProgramData(skeleton: ProgramSkeleton, anchors: TriAnchors = {}): ProgramData {
  return {
    generatedAt: new Date().toISOString(),
    weeks: skeleton.weeks.map((w) => triWeekToProgramWeek(w, anchors)),
  };
}

/**
 * Deterministically rebuild ONE triathlon week at a revised cardio-minute total
 * (the adaptation engine's output). Regenerates the day/session layout from the
 * revised volume — the tri analog of the AI mini-refill, but deterministic —
 * returning both the updated skeleton week and its ProgramWeek. Preserves any
 * race-day marker on the week.
 */
export function rebuildTriWeek(
  week: WeekSkeleton,
  input: EngineInput,
  cfg: SportConfig,
  anchors: TriAnchors = {},
): { skeletonWeek: WeekSkeleton; programWeek: ProgramWeek } {
  const idx = EXP_INDEX[triVolumeLevel(input)] ?? 1;
  const slots = triSessions(week.phase, week.targetCardioMinutes, cfg, idx);
  const days = distributeTri(input.trainingDays, slots);
  const skeletonWeek: WeekSkeleton = { ...week, days };
  return { skeletonWeek, programWeek: triWeekToProgramWeek(skeletonWeek, anchors) };
}
