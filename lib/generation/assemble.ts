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
  type EquipmentKey,
} from "@/lib/schemas";
import type {
  ExperienceLevel,
  ProgramSkeleton,
  TrainingDayName,
  WeekSkeleton,
} from "@/lib/engine/types";
import type { TrainingCaps } from "@/lib/engine/caps";
import { runDescription, hybridDescription } from "@/lib/engine/run-descriptions";
import { reconcileWeekVolume } from "./reconcile";
import { repsForWorkMiles } from "@/lib/engine/interval-structure";
import { weekCardioMinutes, weekMileage } from "@/lib/session-volume";
import { computePaces, type RaceInput, type RunPaces } from "@/lib/engine/paces";
import {
  movementScheme,
  powerElementFor,
  suggestedWeight,
  pickExercise,
  isBodyweight,
  usesBarbellBenchmark,
  spreadPatternSessions,
  applyWeeklySetVolume,
  PATTERN_HOME,
  acceptsPattern,
  ensurePowerSessionPatterns,
  POWER_REST_SECONDS,
  POWER_CUE,
} from "@/lib/engine/strength";
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
      return {
        kind: "run",
        runType: slot.runType,
        durationMin: 0,
        paceMinMile: "",
        distanceMiles: 0,
        goalZone: slot.goalZone,
      };
    case "lift":
      return { kind: "lift", liftType: slot.liftType, movements: [] };
    case "hybrid":
      return {
        kind: "hybrid",
        goalZone: slot.goalZone,
        elements: [],
        ...(slot.simulation ? { simulation: true } : {}),
      };
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
    // Prefer an exact match (same kind AND same run type) so the AI's content is
    // kept where it already agrees with the plan; fall back to kind-only.
    let idx = pool.findIndex(
      (s) =>
        s.kind === slot.kind &&
        (slot.kind !== "run" || (s.kind === "run" && s.runType === slot.runType)),
    );
    if (idx === -1) idx = pool.findIndex((s) => s.kind === slot.kind);
    if (idx !== -1) {
      const matched = pool.splice(idx, 1)[0]!; // safe: findIndex returned a valid index
      // The engine owns liftType periodization; enforce the planned "power" day
      // even when the AI returned a generic lift (matching here is by kind only).
      if (slot.kind === "lift" && slot.liftType === "power" && matched.kind === "lift") {
        matched.liftType = "power";
      }
      // The engine owns RUN TYPE too — including which day holds the long run.
      // Matching is by kind, so without this an AI that returned an "easy" run on
      // the planned long-run day would silently move the long run to whichever day
      // the AI felt like, defeating the athlete's long-run day preference.
      if (slot.kind === "run" && matched.kind === "run" && matched.runType !== slot.runType) {
        matched.runType = slot.runType;
        matched.goalZone = slot.goalZone;
      }
      out.push(matched);
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

/** Attach the canonical workout description to every run and hybrid session.
 *  Runs get their run-type protocol (Tasks #2); hybrid sessions get the
 *  compromised-running explanation (what it is, why it is programmed, how the
 *  station-to-run format builds it). */
function describeSessions(
  sessions: Session[],
  runningExp: ExperienceLevel,
  paces: RunPaces | null,
): Session[] {
  return sessions.map((s) => {
    if (s.kind === "run")
      return { ...s, description: runDescription(s.runType, runningExp, paces) };
    if (s.kind === "hybrid") return { ...s, description: hybridDescription() };
    return s;
  });
}

/**
 * Rewrite the interval/threshold how-to from each run's FINAL work distance.
 *
 * BUG FIX (Levi 2026-08-04). `describeSessions` runs before the volume
 * reconciler, using the fixed per-experience rep tables. The reconciler then
 * resizes `distanceMiles` to hit the week's mileage target — and nothing put the
 * text back in agreement, so a run stored at 1.8 miles of work still told the
 * athlete to run 3 × 1 mile. In an 87-run audit every single interval/threshold
 * session mismatched, the worst by 3.7 miles.
 *
 * `setRunMiles` now snaps quality runs to a whole number of reps, so the rep
 * count is exact here rather than a rounding of an arbitrary distance.
 */
function redescribeQualityRuns(
  days: ProgramDay[],
  runningExp: ExperienceLevel,
  paces: RunPaces | null,
): void {
  for (const d of days) {
    for (const s of d.sessions) {
      if (s.kind !== "run") continue;
      // A run with no distance is a placeholder the AI never filled (race weeks
      // skip resizing). Telling the athlete to run six reps of a workout the plan
      // has sized at zero is worse than leaving the generic text in place.
      if (!(s.distanceMiles > 0)) continue;
      const reps = repsForWorkMiles(s.runType, s.distanceMiles, runningExp);
      if (reps === null) continue; // not a rep-based run — its text never drifts
      s.description = runDescription(s.runType, runningExp, paces, reps);
    }
  }
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
      description: hybridDescription(),
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
  restDays?: TrainingDayName[],
  caps?: TrainingCaps,
): ProgramWeek {
  const days: ProgramDay[] = skel.days.map((d) => ({
    day: d.day,
    sessions: describeSessions(
      orderSessionsByPriority(daySessions(d, aiWeek, issues, skel.weekNumber)),
      runningExp,
      paces,
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
  // Tell the reconciler where its filler may go: never onto a day the ATHLETE
  // asked to keep clear (otherwise a designated rest day collects the surplus
  // cardio and ends up the biggest day of the week), and prefer the weekend for
  // the rest.
  //
  // This used to read the rest slots back off the skeleton. That conflated two
  // very different things: `assignDays` appends a `rest` slot to any day that ends
  // up empty, so a day the engine merely failed to use was treated as sacred and
  // the reconciler refused to put anything there — guaranteeing it stayed empty
  // while other days doubled up. Only a real preference should block filler.
  const restDayKeys = restDays ?? [];
  // The reconciler hands back the mileage the week can ACTUALLY deliver, and we
  // adopt it as this week's target. It only ever rises, and only where the
  // engine's target was smaller than the smallest real training week for this
  // athlete (the low hours bands). Without this the skeleton keeps a number the
  // plan was never able to honour, and the weekly ADAPTATION then reads the
  // athlete as overshooting a target they were never actually given.
  skel.targetMileage = reconcileWeekVolume(
    days,
    skel.targetMileage,
    skel.targetCardioMinutes,
    paces,
    runningExp,
    skel.weekNumber,
    { avoidDays: restDayKeys, preferDays: ["sat", "sun"] },
    caps,
  );

  // Descriptions were written BEFORE reconciliation, from the experience-level
  // rep defaults. The reconciler has since resized every run to make the week hit
  // its mileage target, so rewrite the rep-based ones from the distance each run
  // actually ended up with — otherwise the text prescribes a workout that is not
  // the workout the headline and the weekly total describe.
  redescribeQualityRuns(days, runningExp, paces);

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
    raceDay: skel.raceDay
      ? { priority: skel.raceDay.priority, date: skel.raceDay.date }
      : undefined,
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
 * Ensure a full training week carries all 8 movement patterns; inject any that
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
      const repRange = target.liftType === "full" || target.liftType === "power" ? "5-7" : "12-15";
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
  /** Drives the WEEKLY working-set target per movement pattern (6/8/10). */
  liftingExp: ExperienceLevel;
  /** The athlete's kit. Drives exercise SUBSTITUTION — an empty/absent list means
   *  "assume a full gym", which keeps every existing program unchanged. */
  equipment?: EquipmentKey[];
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
    // Weekly working sets per movement pattern come from LIFTING experience, not
    // running experience — the two are routinely different for a hybrid athlete.
    liftingExp: input.profile.liftingExp,
    equipment: input.profile.equipment,
    // Best of mile / 5K / 10K → VDOT (Review #2), plus any athlete-entered pace
    // overrides — these must flow through so a manual pace drives the sized
    // mileage and not just the displayed pace.
    raceTimes: {
      mileTime: b?.mileTime,
      fiveKTime: b?.fiveKTime,
      tenKTime: b?.tenKTime,
      easyPace: b?.easyPace,
      thresholdPace: b?.thresholdPace,
      intervalPace: b?.intervalPace,
      tempoPace: b?.tempoPace,
      paceUnit: b?.paceUnit,
    },
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
 *
 * Two rules from Levi (2026-08-04) sit on top of the per-session schemes:
 *   - WEEKLY working sets per movement pattern are set by LIFTING experience
 *     (beginner 6 / intermediate 8 / advanced 10, scaled down on deload+taper),
 *     split across the sessions that train that pattern. The week is the unit
 *     that drives adaptation, so the week is what gets controlled.
 *   - When a week carries more than one FULL-BODY lift, the LATER one runs LIGHT
 *     (12–15 reps, submaximal): heavy first while fresh, and never two maximal
 *     efforts in a week on top of the running.
 */
export function applyStrengthSchemes(
  week: ProgramWeek,
  benchmarks?: StrengthBenchmarks,
  weightUnit: "lbs" | "kg" = "lbs",
  liftingExp: ExperienceLevel = "intermediate",
  /** The athlete's kit. Absent/empty = assume a full gym (existing behaviour). */
  equipment?: readonly EquipmentKey[],
): void {
  // Calendar order — the light full-body day and the weekly set split both depend
  // on which session comes first.
  const liftSessions = week.days
    .flatMap((d) => d.sessions)
    .filter((s): s is Extract<Session, { kind: "lift" }> => s.kind === "lift");

  // Get patterns onto two lift days BEFORE prescribing, so the injected
  // movements are scheme'd like any other and the weekly split has two places to
  // put the volume.
  spreadPatternSessions(liftSessions);

  // Exactly ONE heavy day a week: the first full-body session. Everything
  // full-body after it runs light (Levi's rule from 2026-08-04, generalized
  // 2026-08-05 to the `1 -> strength / 2 -> strength+power / 3 -> strength+power+
  // light` priority). Keying off "the LAST full session" was equivalent for two
  // full days but would have shipped two maximal days at four lift days a week.
  const fullBody = liftSessions.filter((s) => s.liftType === "full");
  const lightSessions = new Set(fullBody.slice(1));

  liftSessions.forEach((session, liftIndex) => {
    const light = lightSessions.has(session);
    const isPower = session.liftType === "power";
    // A power day trains only patterns with a real ballistic expression. Anything
    // the AI (or an older stored program) put there that doesn't belong — chest
    // fly above all — is dropped rather than prescribed explosively.
    if (isPower) {
      session.movements = session.movements.filter((m) => acceptsPattern("power", m.pattern));
      // …and make sure what's left is actually a power session: never empty, and
      // never upper-body-only. See `ensurePowerSessionPatterns`.
      ensurePowerSessionPatterns(session, week.weekNumber);
    }
    for (const m of session.movements) {
      const scheme = movementScheme(m.pattern, session.liftType, week.phase, week.microWeek, light);
      m.sets = scheme.sets;
      m.repRange = scheme.repRange;
      m.intensityPct = scheme.intensityPct;
      m.rir = scheme.rir;
      m.emphasis = scheme.emphasis;
      m.exercise = pickExercise(m.pattern, week.weekNumber, equipment, session.liftType);
      // Power sets are governed by BAR SPEED and full recovery, not by reps in
      // reserve. Say so on the movement, and give it the long rest that makes the
      // difference between training power and training fatigue.
      if (isPower) {
        m.restSeconds = POWER_REST_SECONDS;
        m.note = POWER_CUE;
      }
      // A bodyweight substitution has no load to suggest, and the athlete's 5RM is
      // a BARBELL number — projecting it onto a dumbbell or band variant gave
      // "Goblet Squat — 285 lbs". Non-barbell variants keep the %1RM + RIR cue
      // without an absolute weight.
      m.suggestedWeight = isBodyweight(m.exercise)
        ? undefined
        : suggestedWeight(
            scheme,
            m.pattern,
            usesBarbellBenchmark(m.exercise) ? benchmarks : undefined,
            weightUnit,
          );
    }
    const power = powerElementFor(
      week.phase,
      week.microWeek,
      liftIndex,
      session.liftType === "power",
    );
    if (power) session.power = power;
    else delete session.power;
  });

  applyWeeklySetVolume(liftSessions, liftingExp, week.microWeek);
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
  liftingExp: ExperienceLevel = "intermediate",
  equipment?: readonly EquipmentKey[],
): AssembleResult {
  const issues: string[] = [];
  const aiByWeek = indexAiWeeks(chunks);
  // VDOT paces from the athlete's best of mile / 5K / 10K (Review #2). A bare
  // 5K string is still accepted for backward compatibility.
  const paces = computePaces(raceTimes);

  const weeks = skeleton.weeks.map((skel) => {
    const week = buildWeek(
      skel,
      aiByWeek.get(skel.weekNumber),
      issues,
      runningExp,
      paces,
      division,
      sex,
      catalog,
      skeleton.restDays,
      skeleton.caps,
    );
    const patched = patchMovementPatterns(week);
    if (patched.length)
      issues.push(`week ${week.weekNumber}: patched missing patterns ${patched.join(", ")}`);
    // Review #4: periodized, heavy/low-rep-biased strength with plyometrics,
    // applied deterministically over whatever the AI returned.
    applyStrengthSchemes(week, benchmarks, weightUnit, liftingExp, equipment);
    // Review #6: progress hybrid station prescriptions toward race spec.
    applyStationProgression(week, division, sex, catalog);
    return week;
  });

  const program: ProgramData = { generatedAt: new Date().toISOString(), weeks };

  // Final schema gate.
  const parsed = ProgramDataSchema.safeParse(program);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `Assembled program failed schema validation: ${first?.path.join(".")} — ${first?.message}`,
    );
  }
  return { program: parsed.data, issues };
}

export interface VerifyResult {
  ok: boolean;
  issues: string[];
}

/**
 * Verify a finished program (architecture-plan.md §5 step 4 exit test):
 * schema-valid and every full training week has all 8 movement patterns.
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
    if (missing.length)
      issues.push(`week ${week.weekNumber}: missing movement patterns ${missing.join(", ")}`);
  }

  return { ok: issues.length === 0, issues };
}
