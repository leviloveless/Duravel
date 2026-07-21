/**
 * Ironman / triathlon engine — the deterministic periodized builder for the
 * two triathlon sports (70.3 + 140.6). This is the engine LOGIC that used to
 * live in `sports/triathlon.ts`; it has been moved here and expanded with:
 *
 *   (A) a phase-gated long-RUN cap + ramp (150/135 for 140.6, 120/105 for 70.3);
 *   (B) the weekly long ride emitted as a discrete bike→run BRICK (short Z2 tail);
 *   (C) periodized full-body STRENGTH (base 2 / build 1 / peak 1 / taper 0 /wk),
 *       placed on the lowest-load day that is not a key aerobic (long) day;
 *   (D) A/B/C race periodization + post-race active-recovery scaling.
 *
 * It receives its `SportConfig` as a parameter (never imports the config objects)
 * so the dependency runs one-way: sports/triathlon.ts → ironman, never back.
 *
 * Pure + deterministic. The only wall-clock read is the `generatedAt` stamp in
 * `buildTriProgramData`, preserved from the original.
 */
import { allocateMesocycles, expandPhases } from "../mesocycles";
import { microcyclePattern } from "../microcycles";
import { parseTimeToSeconds } from "../paces";
import { clampInt } from "../math";
import type {
  EngineInput,
  EngineRace,
  MicroWeekType,
  PhaseName,
  ProgramSkeleton,
  RacePriorityName,
  SessionSlot,
  WeekSkeleton,
  DaySlot,
} from "../types";
import type { SportConfig, PhaseCountTable } from "../sports/types";
import type { ProgramData, ProgramWeek, ProgramDay, Session } from "@/lib/schemas";

/** The lifting movement-pattern union, derived from the Session schema (no value import). */
type MovementPattern = Extract<Session, { kind: "lift" }>["movements"][number]["pattern"];

// --- proficiency <-> volume tier -------------------------------------------

type Level = "beginner" | "intermediate" | "advanced";
const EXP_INDEX: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const INDEX_EXP: Level[] = ["beginner", "intermediate", "advanced"];

/**
 * Blended volume tier across the three disciplines. Each discipline defaults to
 * the athlete's run level when its anchor (CSS / FTP) is missing, so an absent
 * benchmark neither raises nor lowers the tier.
 */
export function triVolumeLevel(input: EngineInput): Level {
  const run = EXP_INDEX[input.runningExp] ?? 1;
  const swim = input.swimLevel ? EXP_INDEX[input.swimLevel]! : run;
  const bike = input.bikeLevel ? EXP_INDEX[input.bikeLevel]! : run;
  const avg = Math.round((run + swim + bike) / 3);
  return INDEX_EXP[Math.min(2, Math.max(0, avg))]!;
}

// --- skeleton tuning constants ---------------------------------------------

const A_TAPER = [0.8, 0.6]; // 2-week end-of-program taper factors from peak
const DELOAD = 0.65;

const SWIM_ZONE: Record<string, number> = { technique: 2, css: 4, threshold: 4, endurance: 2, open_water: 2 };
const BIKE_ZONE: Record<string, number> = { endurance: 2, sweet_spot: 3, threshold: 4, vo2: 5, recovery: 1 };

/** Distance key used to look up per-level hours ("olympic" | "70_3" | "140_6"). */
function distanceKey(sport: string): string {
  if (sport === "tri_140_6") return "140_6";
  if (sport === "tri_olympic") return "olympic";
  return "70_3";
}

// --- long-ride model (75% of race bike distance, phase-gated) ---------------
const RACE_BIKE_MILES: Record<string, number> = { olympic: 24.8, "70_3": 56, "140_6": 112 };
const LONG_RIDE_MPH = 16; // steady Z2 long-ride pace incl. terrain/stops
const LONG_RIDE_STANDARD_MAX_MIN = 210; // 3.5h ceiling through base + build

/** Duration cap (min) for the long ride: 75% of race bike distance, phase-gated. */
function longRideCapMin(cfg: SportConfig, phase: PhaseName): number {
  const miles = RACE_BIKE_MILES[distanceKey(cfg.id)] ?? 112;
  const distanceCapMin = Math.round(((0.75 * miles) / LONG_RIDE_MPH) * 60);
  return phase === "peak" ? distanceCapMin : Math.min(distanceCapMin, LONG_RIDE_STANDARD_MAX_MIN);
}

// --- long-RUN model (feature A): phase-gated duration cap --------------------
// The long run is capped well short of race distance to protect the athlete;
// peak weeks open up a little (≈18mi for 140.6, ≈10mi for 70.3), base/build sit
// in the standard band.
const LONG_RUN_CAP: Record<string, { peak: number; standard: number }> = {
  "140_6": { peak: 150, standard: 135 },
  "70_3": { peak: 120, standard: 105 },
  // Olympic run is 10 km — long runs stay modest (short-course, report §6.5).
  olympic: { peak: 75, standard: 60 },
};
function longRunCapMin(cfg: SportConfig, phase: PhaseName): number {
  const c = LONG_RUN_CAP[distanceKey(cfg.id)] ?? LONG_RUN_CAP["70_3"]!;
  return phase === "peak" ? c.peak : c.standard;
}

// --- periodized strength (feature C) ----------------------------------------
const LIFT_BY_PHASE: Record<PhaseName, number> = { base: 2, build: 1, peak: 1, taper: 0 };

// --- race periodization (feature D) -----------------------------------------
// Race week: keep frequency, cut total DURATION by these factors.
const RACE_FACTOR: Record<RacePriorityName, number> = { A: 0.5, B: 0.6, C: 0.7 };
// Week AFTER a race: active-recovery scale of the normal computed minutes.
const POST_RACE_FACTOR: Record<RacePriorityName, number> = { A: 0.25, B: 0.5, C: 0.75 };
// Active-recovery duration caps (minutes) for the week after a race.
const RECOVERY_CAP = { swim: 45, bike: 90, run: 30 };

// --- session-count helper ---------------------------------------------------

function n(table: PhaseCountTable | undefined, phase: PhaseName, idx: number): number {
  const v = table?.[phase];
  if (v === undefined) return 0;
  return Array.isArray(v) ? (v[idx] ?? 0) : v;
}

/** Discipline time-share for a phase, read from the SportConfig (not imported). */
function balanceFor(cfg: SportConfig, phase: PhaseName): { swim: number; bike: number; run: number } {
  const b =
    cfg.volume.kind === "per_discipline" ? cfg.volume.disciplineBalanceByPhase[phase] : undefined;
  return { swim: b?.["swim"] ?? 0.2, bike: b?.["bike"] ?? 0.5, run: b?.["run"] ?? 0.3 };
}

// --- cardio slot generation -------------------------------------------------

/**
 * Build the swim / bike / run / brick slots for one week's cardio minutes.
 * The long ride is emitted as a discrete Z2 bike→run BRICK (feature B); the long
 * run is a capped ramp (feature A). Strength is placed separately (feature C).
 */
function triCardioSlots(phase: PhaseName, totalMin: number, cfg: SportConfig, idx: number): SessionSlot[] {
  const bal = balanceFor(cfg, phase);
  const swimN = n(cfg.sessionCounts.swim, phase, idx);
  const bikeN = n(cfg.sessionCounts.bike, phase, idx);
  const runN = n(cfg.sessionCounts.run, phase, idx);
  const brickN = n(cfg.sessionCounts.brick, phase, idx);

  const per = (share: number, count: number) =>
    count > 0 ? Math.max(20, Math.round((totalMin * share) / count)) : 0;
  const swimMin = per(bal.swim, swimN);
  const bikeMin = per(bal.bike, bikeN);
  const runMin = per(bal.run, runN);

  const longRideCap = longRideCapMin(cfg, phase);
  const longRunCap = longRunCapMin(cfg, phase);

  const slots: SessionSlot[] = [];

  // Swim
  for (let k = 0; k < swimN; k++) {
    const sessionType = k === 0 && phase !== "base" ? "css" : phase === "base" ? "technique" : "endurance";
    slots.push({ kind: "swim", goalZone: SWIM_ZONE[sessionType]!, durationMin: swimMin, sessionType });
  }

  // Bike — k === 0 is the weekly long ride, now a discrete Z2 brick (feature B).
  for (let k = 0; k < bikeN; k++) {
    if (k === 0) {
      const bikeLongMin = Math.min(Math.round(bikeMin * 1.4), longRideCap);
      const runTail = clampInt(runMin * 0.3, 15, 30); // short Z2 run off the bike
      slots.push({
        kind: "brick",
        goalZone: 2, // Z2 marks this as the aerobic long-ride brick (vs. Z3 race bricks)
        segments: [
          { discipline: "bike", durationMin: bikeLongMin, goalZone: 2 },
          { discipline: "run", durationMin: runTail, goalZone: 2 },
        ],
      });
      continue;
    }
    const sessionType = phase === "build" || phase === "peak" ? "sweet_spot" : "endurance";
    slots.push({ kind: "bike", goalZone: BIKE_ZONE[sessionType]!, durationMin: bikeMin, isLong: false, sessionType });
  }

  // Run — k === 0 is the long run: min(1.4× easy, phase cap) (feature A).
  for (let k = 0; k < runN; k++) {
    const isLong = k === 0;
    const runType = isLong ? "long" : k === 1 && (phase === "build" || phase === "peak") ? "tempo" : "easy";
    const durationMin = isLong ? Math.min(Math.round(runMin * 1.4), longRunCap) : runMin;
    slots.push({ kind: "run", runType, goalZone: runType === "tempo" ? 3 : 2, isLong, durationMin });
  }

  // Dedicated mid-week race-specific bricks (Z3), kept as-is.
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

/**
 * Downgrade a week's cardio slots to active recovery for the week after a race
 * (feature D): cap durations, drop all bricks, and downgrade any hard swim/bike/
 * run to easy endurance. No vo2 / threshold / brick survives.
 */
function toActiveRecovery(slots: SessionSlot[]): SessionSlot[] {
  const out: SessionSlot[] = [];
  for (const s of slots) {
    if (s.kind === "brick") continue; // no bricks in a recovery week
    if (s.kind === "swim") {
      const sessionType = s.sessionType === "threshold" || s.sessionType === "css" ? "endurance" : s.sessionType;
      out.push({ ...s, sessionType, goalZone: SWIM_ZONE[sessionType]!, durationMin: Math.min(s.durationMin, RECOVERY_CAP.swim) });
    } else if (s.kind === "bike") {
      out.push({ kind: "bike", sessionType: "endurance", goalZone: BIKE_ZONE.endurance!, isLong: false, durationMin: Math.min(s.durationMin, RECOVERY_CAP.bike) });
    } else if (s.kind === "run") {
      out.push({ kind: "run", runType: "easy", goalZone: 2, isLong: false, durationMin: Math.min(s.durationMin ?? 40, RECOVERY_CAP.run) });
    } else {
      out.push(s);
    }
  }
  return out;
}

// --- day placement ----------------------------------------------------------

/** Estimated minutes a slot contributes to a training day (for lift placement). */
function slotMinutes(slot: SessionSlot): number {
  switch (slot.kind) {
    case "swim":
    case "bike":
      return slot.durationMin;
    case "run":
      return slot.durationMin ?? 40;
    case "brick":
      return slot.segments.reduce((a, s) => a + s.durationMin, 0);
    case "lift":
      return 60;
    default:
      return 0;
  }
}
function dayMinutes(d: DaySlot): number {
  return d.sessions.reduce((a, s) => a + slotMinutes(s), 0);
}
/** A key aerobic day = holds the long-ride brick (Z2) or the long run. */
function dayHasKeyAerobic(d: DaySlot): boolean {
  return d.sessions.some(
    (s) =>
      (s.kind === "brick" && s.goalZone === 2) ||
      (s.kind === "run" && s.isLong === true) ||
      (s.kind === "bike" && s.isLong === true),
  );
}

/** Round-robin cardio slots across the training days (no rest fill yet). */
function distributeCardio(trainingDays: EngineInput["trainingDays"], slots: SessionSlot[]): DaySlot[] {
  const days: DaySlot[] = trainingDays.map((day) => ({ day, sessions: [] as SessionSlot[] }));
  slots.forEach((s, i) => {
    days[i % days.length]!.sessions.push(s);
  });
  return days;
}

/**
 * Place `liftN` full-body strength slots (feature C): each lands on the
 * lowest-total-minutes day that is NOT a key aerobic (long) day, preferring
 * separate days (a placed lift raises that day's load for the next pick).
 */
function placeLifts(days: DaySlot[], liftN: number): void {
  for (let i = 0; i < liftN; i++) {
    const eligible = days.filter((d) => !dayHasKeyAerobic(d));
    const pool = eligible.length > 0 ? eligible : days; // stack only if unavoidable
    let best = pool[0]!;
    let bestMin = dayMinutes(best);
    for (const d of pool) {
      const m = dayMinutes(d);
      if (m < bestMin) {
        best = d;
        bestMin = m;
      }
    }
    best.sessions.push({ kind: "lift", liftType: "full" });
  }
}

function fillRest(days: DaySlot[]): void {
  for (const d of days) if (d.sessions.length === 0) d.sessions.push({ kind: "rest" });
}

/**
 * Assemble one week's day layout from its cardio minutes + race context. Shared
 * by the full-program builder and the single-week rebuild so both stay in sync.
 */
function assembleTriDays(
  input: EngineInput,
  cfg: SportConfig,
  phase: PhaseName,
  totalMin: number,
  idx: number,
  ctx: { raceThis?: EngineRace; raceLast?: EngineRace },
): DaySlot[] {
  const raceWeek = !!ctx.raceThis;
  const isTaper = phase === "taper";
  const postRace = !ctx.raceThis && !!ctx.raceLast && !isTaper;

  let slots = triCardioSlots(phase, totalMin, cfg, idx);
  if (postRace) slots = toActiveRecovery(slots);

  const days = distributeCardio(input.trainingDays, slots);

  // After an A race: near-complete rest early — clear the first training day.
  if (postRace && ctx.raceLast!.priority === "A" && days.length > 0) days[0]!.sessions = [];

  const liftN = raceWeek || postRace ? 0 : LIFT_BY_PHASE[phase];
  placeLifts(days, liftN);

  // Insert the race on the last training day (frequency preserved).
  if (raceWeek && days.length > 0) {
    days[days.length - 1]!.sessions.push({ kind: "race", priority: ctx.raceThis!.priority });
  }

  fillRest(days);
  return days;
}

// --- full-program skeleton --------------------------------------------------

export function buildTriathlonSkeleton(input: EngineInput, cfg: SportConfig): ProgramSkeleton {
  const D = input.durationWeeks;
  const alloc = allocateMesocycles(input);
  const phases = expandPhases(alloc, D);
  const pattern = microcyclePattern(input.trainingClass, input.age);
  const level = triVolumeLevel(input); // blended swim/bike/run volume tier
  const idx = EXP_INDEX[level] ?? 1;
  const key = `${distanceKey(cfg.id)}:${level}`;
  const hours = cfg.volume.kind === "per_discipline" ? (cfg.volume.hoursPerWeekByLevel[key] ?? [8, 14]) : [8, 14];
  const [baseH, peakH] = hours as [number, number];
  const nonTaper = alloc.base + alloc.build + alloc.peak;

  // Held-level progression: the held (peak-of-cycle) volume steps up only on
  // INCREASE weeks; REBOUND holds it, DELOAD dips WITHOUT lowering it. Sized so
  // the held level climbs baseH → peakH across the working weeks.
  const nonTaperLabels: MicroWeekType[] = [];
  for (let i = 0; i < nonTaper; i++) nonTaperLabels.push(pattern[i % pattern.length]!);
  const increaseCount = nonTaperLabels.filter((l) => l === "increase").length;
  const step = increaseCount > 0 ? (peakH - baseH) / increaseCount : 0;

  const races = input.races;
  const raceAt = (wk: number): EngineRace | undefined => races.find((r) => r.weekNumber === wk);

  const weeks: WeekSkeleton[] = [];
  let held = baseH;
  let taperWeek = 0;
  for (let i = 0; i < D; i++) {
    const phase = phases[i]!;
    const weekNumber = i + 1;
    const raceThis = raceAt(weekNumber);
    const raceLast = raceAt(weekNumber - 1);
    const isTaper = phase === "taper";

    // 1) Normal held-level minutes (progression preserved for every week).
    let micro: MicroWeekType = isTaper ? "taper" : nonTaperLabels[i]!;
    let hoursThis: number;
    if (isTaper) {
      hoursThis = peakH * (A_TAPER[Math.min(taperWeek, A_TAPER.length - 1)] ?? 0.6);
      taperWeek += 1;
    } else if (micro === "increase") {
      held += step;
      hoursThis = held;
    } else if (micro === "deload") {
      hoursThis = held * DELOAD;
    } else {
      hoursThis = held; // rebound
    }

    // 2) Race-aware scaling ON TOP of the normal minutes (non-taper weeks only;
    //    the end-of-program taper owns the final A race's volume). Mid-program
    //    A/B/C races cut duration; the week after a race is active recovery.
    if (raceThis && !isTaper) {
      hoursThis *= RACE_FACTOR[raceThis.priority];
    } else if (raceLast && !raceThis && !isTaper) {
      hoursThis *= POST_RACE_FACTOR[raceLast.priority];
    }
    if (raceThis) micro = "race";

    const totalMin = Math.round(hoursThis * 60);

    weeks.push({
      weekNumber,
      phase,
      microWeek: micro,
      targetMileage: 0,
      targetCardioMinutes: totalMin,
      zoneTargets: { ...cfg.phaseZoneTargets[phase] },
      days: assembleTriDays(input, cfg, phase, totalMin, idx, { raceThis, raceLast }),
      ...(raceThis ? { raceDay: { priority: raceThis.priority, ...(raceThis.date ? { date: raceThis.date } : {}) } } : {}),
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

/**
 * Secondary heart-rate cue for a bike effort (% of lactate-threshold HR). Power
 * is the primary target; HR is a lagging monitor, so it's only a cross-check.
 */
function bikeHr(lo: number, hi: number | null): string {
  if (hi === null) return "HR lags on short reps — ride to power";
  return `secondary HR ${Math.round(lo * 100)}–${Math.round(hi * 100)}% LTHR`;
}

/** Bike set built to the prescribed duration, paced off FTP when known. */
function bikeContent(type: string, durationMin: number, isLong: boolean | undefined, a: TriAnchors): string {
  // The weekly long ride is now a discrete brick; a long steady ride keeps only
  // the fueling/hydration rehearsal cue (the mini-brick sentence moved to the brick).
  const longNote = isLong ? " Rehearse race fuel + hydration on this ride." : "";
  switch (type) {
    case "endurance":
      return `Steady Zone 2 aerobic ride, ${durationMin} min at ${wattRange(a, 0.56, 0.75)} (${bikeHr(0.69, 0.83)}) — the aerobic cornerstone. Keep it conversational and hold aero where you can.${longNote}`;
    case "sweet_spot": {
      const reps = clampInt((durationMin - 25) / 13, 2, 5);
      return `Warm-up 12 min. Main set ${reps}×10 min @ ${wattRange(a, 0.88, 0.94)} (sweet spot, ${bikeHr(0.88, 0.94)}) with 4 min easy between. Cool-down. ${durationMin} min total.${longNote}`;
    }
    case "threshold": {
      const reps = clampInt((durationMin - 25) / 24, 2, 3);
      return `Warm-up 15 min. Main set ${reps}×18 min @ ${wattRange(a, 0.95, 1.05)} (threshold, ${bikeHr(0.95, 1.05)}) with 6 min easy between. Cool-down. ${durationMin} min total.${longNote}`;
    }
    case "vo2": {
      const reps = clampInt((durationMin - 18) / 6, 4, 6);
      return `Warm-up 15 min. Main set ${reps}×3 min @ ${wattRange(a, 1.1, 1.2)} (VO₂max — ${bikeHr(1.1, null)}) with 3 min easy spin between. Cool-down. ${durationMin} min total.`;
    }
    case "recovery":
      return `Easy recovery spin, ${durationMin} min fully aerobic (${wattRange(a, 0, 0.55)}, ${bikeHr(0, 0.68)}), high cadence and light.`;
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

/** Brick content from the ordered segments (long-ride Z2 brick or race Z3 brick). */
function brickContent(segments: { discipline: string; durationMin: number; goalZone: number }[]): string {
  const bike = segments.find((s) => s.discipline === "bike");
  const run = segments.find((s) => s.discipline === "run");
  const long = (run?.goalZone ?? 3) <= 2;
  if (long) {
    const bikePart = bike ? `Ride ${bike.durationMin} min steady Zone 2` : "Ride the long bike";
    const runPart = run ? `run ${run.durationMin} min easy Zone 2 immediately off the bike` : "run easy off the bike";
    return `Long-ride brick — the aerobic cornerstone. ${bikePart}, rehearsing race fuel + hydration, then transition fast and ${runPart} to rehearse race legs. Hold form as your legs come around.`;
  }
  const bikePart = bike ? `Ride ${bike.durationMin} min building to Zone 2–3` : "Ride the bike segment";
  const runPart = run ? `run ${run.durationMin} min immediately off the bike` : "run immediately off the bike";
  return `Brick — bike→run in one session. ${bikePart}, then transition fast and ${runPart} at a controlled Zone 3 effort. Your legs feel heavy the first km — hold target pace through it. The single most race-specific session.`;
}

/** Canonical periodized full-body strength session (feature C). */
function liftSession(phase: PhaseName): Session {
  const strength = phase === "build" || phase === "peak";
  const sets = strength ? 4 : 3;
  const repRange = strength ? "4-6" : "8-12";
  const emphasis: "strength" | "endurance" = strength ? "strength" : "endurance";
  const patterns: MovementPattern[] = ["squat", "hip_hinge", "horizontal_press", "horizontal_pull", "vertical_press"];
  return {
    kind: "lift",
    liftType: "full",
    movements: patterns.map((pattern) => ({ pattern, sets, repRange, emphasis })),
  };
}

// --- deterministic triathlon program-data assembler (no AI) -----------------

function slotToSession(slot: SessionSlot, a: TriAnchors, phase: PhaseName): Session | null {
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
    case "lift":
      return liftSession(phase);
    case "race":
      return { kind: "race", priority: slot.priority };
    case "rest":
      return null;
    default:
      return null; // hybrid never occurs in a triathlon skeleton
  }
}

/** Map one skeleton week (slots already resolved) to a ProgramWeek. */
export function triWeekToProgramWeek(w: WeekSkeleton, anchors: TriAnchors = {}): ProgramWeek {
  const days: ProgramDay[] = w.days.map((d) => ({
    day: d.day,
    sessions: d.sessions.map((s) => slotToSession(s, anchors, w.phase)).filter((s): s is Session => s !== null),
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
 * revised volume, preserving the race context (race week / week-after-race)
 * derived from the input + the week's own race marker.
 */
export function rebuildTriWeek(
  week: WeekSkeleton,
  input: EngineInput,
  cfg: SportConfig,
  anchors: TriAnchors = {},
): { skeletonWeek: WeekSkeleton; programWeek: ProgramWeek } {
  const idx = EXP_INDEX[triVolumeLevel(input)] ?? 1;
  const raceThis = week.raceDay
    ? input.races.find((r) => r.weekNumber === week.weekNumber) ?? { weekNumber: week.weekNumber, priority: week.raceDay.priority, date: week.raceDay.date }
    : undefined;
  const raceLast = input.races.find((r) => r.weekNumber === week.weekNumber - 1);
  const days = assembleTriDays(input, cfg, week.phase, week.targetCardioMinutes, idx, { raceThis, raceLast });
  const skeletonWeek: WeekSkeleton = { ...week, days };
  return { skeletonWeek, programWeek: triWeekToProgramWeek(skeletonWeek, anchors) };
}
