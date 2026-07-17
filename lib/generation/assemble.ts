/**
 * Assemble + verify (architecture-plan.md §5 step 4).
 *
 * Merges the deterministic engine skeleton with the AI-filled session content
 * into the final ProgramData. Two guarantees are enforced here, independent of
 * what the AI returned:
 *
 *  1. Weekly summaries (cardio minutes, mileage, zone %) come straight from the
 *     engine's numeric targets — never from AI output — so summary blocks are
 *     always arithmetically correct (spec §7).
 *  2. Every full training week (3 lift sessions) contains all 7 non-negotiable
 *     movement patterns (spec §5b). Missing patterns are patched in.
 */

import {
  ProgramDataSchema,
  REQUIRED_MOVEMENT_PATTERNS,
  type AiChunk,
  type AiWeek,
  type GenerationInput,
  type ProgramData,
  type ProgramDay,
  type ProgramWeek,
  type Session,
} from "@/lib/schemas";
import type { ExperienceLevel, ProgramSkeleton, WeekSkeleton } from "@/lib/engine/types";
import { runDescription } from "@/lib/engine/run-descriptions";
import { reconcileWeekVolume } from "./reconcile";
import { weekCardioMinutes, weekMileage } from "@/lib/session-volume";
import { computePaces, type RaceInput, type RunPaces } from "@/lib/engine/paces";
import { movementScheme, powerElementFor, suggestedWeight } from "@/lib/engine/strength";
import {
  buildSimulationElements,
  stationPrescription,
  HYROX_CATALOG,
  type Division,
  type StationSex,
  type StationCatalog,
} from "@/lib/engine/stations";
import { getSport } from "@/lib/engine/sports";

type MovementPattern = (typeof REQUIRED_MOVEMENT_PATTERNS)[number];

/** Preferred lift split for a pattern, used when patching a missing one in. */
const PATTERN_HOME: Record<MovementPattern, "upper" | "lower" | "full"> = {
  squat: "lower",
  hip_hinge: "lower",
  lunge: "lower",
  horizontal_press: "upper",
  vertical_press: "upper",
  horizontal_pull: "upper",
  vertical_pull: "upper",
};

export interface AssembleResult {
  program: ProgramData;
  /** Non-fatal notes (missing AI days, patched patterns) for logging/audit. */
  issues: string[];
}

function indexAiWeeks(chunks: AiChunk[]): Map<number, AiWeek> {
  const map = new Map<number, AiWeek>();
  for (const chunk of chunks) {
    for (const w of chunk.weeks) map.set(w.weekNumber, w);
  }
  return map;
}

type PlannedSlot = WeekSkeleton["days"][number]["sessions"][number];

/**
 * A minimal, schema-valid placeholder for a planned slot the AI failed to fill,
 * so the assembled day always carries the engine's planned session KINDS. The
 * deterministic downstream passes then populate it: reconcile fully rewrites run
 * distance/pace, applyStrengthSchemes + patchMovementPatterns fill lift content,
 * replaceSimulations/applyStationProgression handle hybrids.
 */
function placeholderFor(slot: PlannedSlot): Session | null {
  switch (slot.kind) {
    case "run":
      return { kind: "run", runType: slot.runType, durationMin: 0, paceMinMile: "", distanceMiles: 0, goalZone: slot.goalZone };
    case "lift":
      return { kind: "lift", liftType: slot.liftType, movements: [] };
    case "hybrid":
      return { kind: "hybrid", goalZone: slot.goalZone, elements: [], ...(slot.simulation ? { simulation: true } : {}) };
    default:
      return null; // rest / race handled by the caller
  }
}

/**
 * Resolve a day's sessions, ENFORCING the engine's planned session kinds
 * (roadmap #2.1 / review E-H1). The schema promises "each returned day's
 * sessions line up with the engine's slot kinds", but nothing checked it: the AI
 * could return a lift where a run was planned, or drop a hybrid, and the week
 * would silently diverge from the periodization. Here we match each planned slot
 * (run/lift/hybrid) to an AI session of the same kind, synthesize a placeholder
 * for any the AI omitted, and drop AI sessions with no corresponding slot —
 * recording an issue for every correction. Race/rest days are engine-owned.
 */
export function daySessions(
  skelDay: WeekSkeleton["days"][number],
  aiWeek: AiWeek | undefined,
  issues: string[],
  weekNumber: number,
): Session[] {
  const race = skelDay.sessions.find((s) => s.kind === "race");
  if (race && race.kind === "race") return [{ kind: "race", priority: race.priority }];

  const planned = skelDay.sessions.filter(
    (s) => s.kind === "run" || s.kind === "lift" || s.kind === "hybrid",
  );
  if (planned.length === 0) return []; // rest day

  const aiDay = aiWeek?.days.find((d) => d.day === skelDay.day);
  const pool = aiDay ? [...aiDay.sessions] : [];

  const out: Session[] = [];
  for (const slot of planned) {
    const idx = pool.findIndex((s) => s.kind === slot.kind);
    if (idx !== -1) {
      out.push(pool.splice(idx, 1)[0]!); // safe: findIndex returned a valid index
    } else {
      const ph = placeholderFor(slot);
      if (ph) out.push(ph);
      issues.push(
        `week ${weekNumber} ${skelDay.day}: AI omitted the planned ${slot.kind} session — inserted a placeholder`,
      );
    }
  }
  if (pool.length > 0) {
    issues.push(
      `week ${weekNumber} ${skelDay.day}: dropped ${pool.length} AI session(s) with no planned slot (${pool
        .map((s) => s.kind)
        .join(", ")})`,
    );
  }
  return out;
}

/**
 * Priority rank of an assembled session within its day (new-additions #5).
 * Mirrors the engine's slot ranking so the final program orders the priority
 * workout first on any day that doubles up, independent of AI output order.
 */
function sessionPriority(session: Session): number {
  switch (session.kind) {
    case "race":
      return 100;
    case "hybrid":
      return 90;
    case "run":
      switch (session.runType) {
        case "long":
          return 80;
        case "interval":
          return 78;
        case "threshold":
          return 76;
        case "tempo":
          return 74;
        case "progression":
          return 72;
        case "fartlek":
          return 60;
        case "hybrid_run":
          return 58;
        case "easy":
          return 30;
        default:
          return 40;
      }
    case "lift":
      return 50;
    case "cardio":
      return 25;
    default:
      return 40;
  }
}

/** Stable sort a day's sessions, highest priority first. */
function orderSessionsByPriority(sessions: Session[]): Session[] {
  if (sessions.length < 2) return sessions;
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => sessionPriority(b.s) - sessionPriority(a.s) || a.i - b.i)
    .map((x) => x.s);
}

/** Attach the canonical run-workout description to every run session (Tasks #2). */
function describeRuns(sessions: Session[], runningExp: ExperienceLevel): Session[] {
  return sessions.map((s) =>
    s.kind === "run" ? { ...s, description: runDescription(s.runType, runningExp) } : s,
  );
}

/**
 * Replace Peak simulation-flagged hybrid slots with an engine-built full race
 * simulation: the 8 race stations in order, each preceded by a 1 km run, at race
 * spec (Review #9). Deterministic — the AI's content for that slot is discarded.
 */
function replaceSimulations(
  days: ProgramDay[],
  skel: WeekSkeleton,
  division: Division,
  sex: StationSex,
  catalog: StationCatalog = HYROX_CATALOG,
): void {
  for (const skelDay of skel.days) {
    const simSlot = skelDay.sessions.find((s) => s.kind === "hybrid" && s.simulation === true);
    if (!simSlot) continue;
    const day = days.find((d) => d.day === skelDay.day);
    if (!day) continue;
    const sim: Session = {
      kind: "hybrid",
      goalZone: 4,
      simulation: true,
      elements: buildSimulationElements(division, sex, catalog),
    };
    const hi = day.sessions.findIndex((s) => s.kind === "hybrid");
    if (hi === -1) day.sessions.push(sim);
    else day.sessions[hi] = sim;
  }
}

function buildWeek(
  skel: WeekSkeleton,
  aiWeek: AiWeek | undefined,
  issues: string[],
  runningExp: ExperienceLevel,
  paces: RunPaces | null,
  division: Division = "open",
  sex: StationSex = "male",
  catalog: StationCatalog = HYROX_CATALOG,
): ProgramWeek {
  const days: ProgramDay[] = skel.days.map((d) => ({
    day: d.day,
    sessions: describeRuns(
      orderSessionsByPriority(daySessions(d, aiWeek, issues, skel.weekNumber)),
      runningExp,
    ),
  }));

  // Review #9: replace any Peak simulation-flagged hybrid with an engine-built
  // full race simulation BEFORE reconciliation, so its runs/stations are counted
  // in the week's mileage + cardio totals.
  replaceSimulations(days, skel, division, sex, catalog);

  // Rewrite the AI-filled run volume so the week's running mileage and cardio
  // time equal the engine's prescribed targets exactly: running is sized to the
  // mileage at fixed formula paces (min 3 mi easy/long, min 45 min per cardio
  // session, 90-min run cap) and a non-running Zone 1–2 cardio block absorbs the
  // remaining cardio time. The summary is then read back from the reconciled
  // sessions, so the header can never disagree with the workouts.
  reconcileWeekVolume(days, skel.targetMileage, skel.targetCardioMinutes, paces, runningExp);

  return {
    weekNumber: skel.weekNumber,
    phase: skel.phase,
    microWeek: skel.microWeek,
    summary: {
      totalCardioMinutes: weekCardioMinutes({ days }),
      totalMileage: weekMileage({ days }),
      zoneDistribution: { ...skel.zoneTargets },
    },
    days,
    raceDay: skel.raceDay ? { priority: skel.raceDay.priority, date: skel.raceDay.date } : undefined,
  };
}

/** Movement patterns present across a week's lift sessions. */
export function weekPatterns(week: ProgramWeek): Set<string> {
  const present = new Set<string>();
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (s.kind === "lift") for (const m of s.movements) present.add(m.pattern);
    }
  }
  return present;
}

/** Count lift sessions in a week (a "full" training week has 3). */
function liftCount(week: ProgramWeek): number {
  return week.days.reduce((n, d) => n + d.sessions.filter((s) => s.kind === "lift").length, 0);
}

/**
 * Ensure a full training week carries all 7 movement patterns; inject any that
 * are missing into an appropriate lift session. Returns the patterns injected.
 */
export function patchMovementPatterns(week: ProgramWeek): MovementPattern[] {
  if (liftCount(week) < 3) return []; // reduced weeks (deload/taper) aren't required to hit all 7
  const present = weekPatterns(week);
  const missing = REQUIRED_MOVEMENT_PATTERNS.filter((p) => !present.has(p));
  if (missing.length === 0) return [];

  const liftSessions = week.days.flatMap((d) => d.sessions).filter((s) => s.kind === "lift");

  for (const pattern of missing) {
    const home = PATTERN_HOME[pattern];
    const target =
      liftSessions.find((s) => s.kind === "lift" && s.liftType === home) ??
      liftSessions.find((s) => s.kind === "lift" && s.liftType === "full") ??
      liftSessions[0];
    if (target && target.kind === "lift") {
      const repRange = target.liftType === "full" ? "5-7" : "12-15";
      target.movements.push({ pattern, sets: 3, repRange });
    }
  }
  return [...missing];
}

/** 5RM benchmarks used to suggest working weights (Review #4). */
export interface StrengthBenchmarks {
  fiveRmSquat?: number;
  fiveRmDeadlift?: number;
  fiveRmBench?: number;
}

/**
 * The full set of individualization arguments `assembleProgram` needs, derived
 * from a stored generation input. Both the initial full generation and the
 * per-week adaptation refill must pass ALL of these so an adapted week keeps the
 * same VDOT paces (best of mile/5K/10K, Review #2), absolute working weights
 * (Review #4), and division/sex-correct station loads (Review #6) as every other
 * week. Threading only a subset here was the source of a silent adaptation
 * regression (a female Pro athlete's refilled week reverting to male/Open loads).
 */
export interface AssembleArgs {
  runningExp: ExperienceLevel;
  raceTimes: RaceInput;
  benchmarks: StrengthBenchmarks;
  weightUnit: "lbs" | "kg";
  division: Division;
  sex: StationSex;
  catalog: StationCatalog;
}

/** Build the complete `assembleProgram` argument set from a generation input.
 *  Single source of truth shared by generate-program.ts and adapt-week.ts. */
export function assembleArgsFromInput(input: GenerationInput): AssembleArgs {
  const b = input.profile.benchmarks;
  return {
    runningExp: input.profile.runningExp,
    // Best of mile / 5K / 10K → VDOT (Review #2).
    raceTimes: { mileTime: b?.mileTime, fiveKTime: b?.fiveKTime, tenKTime: b?.tenKTime },
    // 5RM benchmarks → periodized working weights (Review #4).
    benchmarks: {
      fiveRmSquat: b?.fiveRmSquat,
      fiveRmDeadlift: b?.fiveRmDeadlift,
      fiveRmBench: b?.fiveRmBench,
    },
    weightUnit: input.profile.weightUnit,
    // Division + sex → HYROX station race loads (Review #6).
    division: input.profile.division ?? "open",
    sex: input.profile.sex === "female" ? "female" : "male",
    // Sport's station catalog (P0 rewire) — HYROX by default.
    catalog: getSport(input.sport).stationCatalog ?? HYROX_CATALOG,
  };
}

/**
 * Apply the periodized strength schemes over a week's lift sessions (Review #4):
 * heavy/low-rep max strength on the full-body day, moderate strength on
 * upper/lower, high-rep muscular endurance for the lunge, with load progressing
 * by microcycle and an RIR cue. Adds a plyometric element in Base/Build. Runs
 * AFTER pattern patching so injected movements are prescribed too. Deterministic.
 */
export function applyStrengthSchemes(
  week: ProgramWeek,
  benchmarks?: StrengthBenchmarks,
  weightUnit: "lbs" | "kg" = "lbs",
): void {
  let liftIndex = 0;
  for (const day of week.days) {
    for (const session of day.sessions) {
      if (session.kind !== "lift") continue;
      for (const m of session.movements) {
        const scheme = movementScheme(m.pattern, session.liftType, week.phase, week.microWeek);
        m.sets = scheme.sets;
        m.repRange = scheme.repRange;
        m.intensityPct = scheme.intensityPct;
        m.rir = scheme.rir;
        m.emphasis = scheme.emphasis;
        m.suggestedWeight = suggestedWeight(scheme, m.pattern, benchmarks, weightUnit);
      }
      const power = powerElementFor(week.phase, week.microWeek, liftIndex);
      if (power) session.power = power;
      else delete session.power;
      liftIndex += 1;
    }
  }
}

/**
 * Rewrite hybrid station prescriptions toward HYROX race spec (Review #6):
 * exact race loads by division/sex, with volume (distance/reps) progressing by
 * phase. Run elements are left alone (the reconciler paces them). Unknown
 * exercises keep the AI's text. Deterministic.
 */
export function applyStationProgression(
  week: ProgramWeek,
  division: Division = "open",
  sex: StationSex = "male",
  catalog: StationCatalog = HYROX_CATALOG,
): void {
  for (const day of week.days) {
    for (const session of day.sessions) {
      if (session.kind !== "hybrid") continue;
      for (const el of session.elements) {
        const isRun = /run/i.test(el.exercise) || /run/i.test(el.prescription);
        if (isRun) continue;
        const spec = stationPrescription(el.exercise, week.phase, division, sex, catalog);
        if (spec) el.prescription = spec.prescription;
      }
    }
  }
}

/** Build ProgramData from the skeleton + AI chunks, patching pattern gaps.
 *  `runningExp` selects the experience-appropriate run descriptions (Tasks #2/#4);
 *  it defaults to "intermediate" for callers that don't have the profile handy.
 *  `raceTimes` supplies the mile/5K/10K used to derive VDOT paces (Review #2). */
export function assembleProgram(
  skeleton: ProgramSkeleton,
  chunks: AiChunk[],
  runningExp: ExperienceLevel = "intermediate",
  raceTimes?: string | RaceInput,
  benchmarks?: StrengthBenchmarks,
  weightUnit: "lbs" | "kg" = "lbs",
  division: Division = "open",
  sex: StationSex = "male",
  catalog: StationCatalog = HYROX_CATALOG,
): AssembleResult {
  const issues: string[] = [];
  const aiByWeek = indexAiWeeks(chunks);
  // VDOT paces from the athlete's best of mile / 5K / 10K (Review #2). A bare
  // 5K string is still accepted for backward compatibility.
  const paces = computePaces(raceTimes);

  const weeks = skeleton.weeks.map((skel) => {
    const week = buildWeek(skel, aiByWeek.get(skel.weekNumber), issues, runningExp, paces, division, sex, catalog);
    const patched = patchMovementPatterns(week);
    if (patched.length) issues.push(`week ${week.weekNumber}: patched missing patterns ${patched.join(", ")}`);
    // Review #4: periodized, heavy/low-rep-biased strength with plyometrics,
    // applied deterministically over whatever the AI returned.
    applyStrengthSchemes(week, benchmarks, weightUnit);
    // Review #6: progress hybrid station prescriptions toward race spec.
    applyStationProgression(week, division, sex, catalog);
    return week;
  });

  const program: ProgramData = { generatedAt: new Date().toISOString(), weeks };

  // Final schema gate.
  const parsed = ProgramDataSchema.safeParse(program);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Assembled program failed schema validation: ${first?.path.join(".")} — ${first?.message}`);
  }
  return { program: parsed.data, issues };
}

export interface VerifyResult {
  ok: boolean;
  issues: string[];
}

/**
 * Verify a finished program (architecture-plan.md §5 step 4 exit test):
 * schema-valid and every full training week has all 7 movement patterns.
 */
export function verifyProgram(program: ProgramData): VerifyResult {
  const issues: string[] = [];

  const parsed = ProgramDataSchema.safeParse(program);
  if (!parsed.success) {
    issues.push(`schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return { ok: false, issues };
  }

  for (const week of program.weeks) {
    if (liftCount(week) < 3) continue; // reduced weeks exempt
    const present = weekPatterns(week);
    const missing = REQUIRED_MOVEMENT_PATTERNS.filter((p) => !present.has(p));
    if (missing.length) issues.push(`week ${week.weekNumber}: missing movement patterns ${missing.join(", ")}`);
  }

  return { ok: issues.length === 0, issues };
}
