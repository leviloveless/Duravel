/**
 * Periodization Engine orchestrator (architecture-plan.md section 5, step 2).
 *
 * Deterministic, no AI. Composes the sibling modules into a full
 * ProgramSkeleton: mesocycle allocation, per-week phases, continuous
 * microcycle volume progression, peak-phase volume drop, race tapers,
 * per-day session slots, and weekly zone targets.
 *
 * The output feeds the AI Session Generator (Milestone 5), which fills the
 * concrete sessions the numeric targets here call for.
 */

import type { GenerationInput } from "@/lib/schemas";
import type {
  EngineInput,
  EngineRace,
  MicroWeekType,
  PhaseName,
  ProgramSkeleton,
  SessionSlot,
  TrainingDayName,
  WeekSkeleton,
} from "./types";
import { allocateMesocycles, expandPhases } from "./mesocycles";
import { sequenceMicrocycles } from "./microcycles";
import { applyTapers } from "./taper";
import { PEAK_VOLUME_FACTOR, startingCardioMinutes, startingMileage } from "./volume";
import {
  assignDays,
  normalizeLongRunDays,
  slotPriority,
  DEFAULT_COUNTS,
  type SessionCountTables,
} from "./slots";
import { spreadFullLiftTypes, isLongRunSlot } from "./sequencing";
import { trainingCaps } from "./caps";
import { STRENGTH_SESSION_MIN } from "@/lib/session-volume";
import type { WeeklyHoursBand } from "@/lib/schemas";
import { getSport, type SportConfig } from "./sports";
import {
  applyBandZoneShift,
  bandPhaseZoneTargets,
  bandStartMileage,
  bandStartCardioMinutes,
  bandSessionCap,
  bandMaxWeeklyMinutes,
  clampBandToFamily,
  clampTrainingDaysToBand,
  bandAnchorRunFloor,
  runImpactFactor,
  startVolumeReadiness,
  inferBandFromStartCardio,
  maxBandForTrainingDays,
  minBand,
} from "./time-budget";
import { buildTriathlonSkeleton, swimLevelFromCss, bikeLevelFromFtp } from "./sports/triathlon";
import { analyzeNeedsForSport } from "./needs-atlas";
import { clamp, round1 } from "./math";

/**
 * Build the full deterministic program skeleton from a normalized EngineInput.
 */
/**
 * Hold a stored program to the bands its sport actually offers. Only ever lowers
 * the band, and only for families with a ceiling (`MAX_BAND_BY_FAMILY`).
 */
function normalizeBandForSport(input: EngineInput, cfg: SportConfig): EngineInput {
  if (!input.weeklyHours) return input;
  const clamped = clampBandToFamily(cfg.family, input.weeklyHours);
  return clamped === input.weeklyHours ? input : { ...input, weeklyHours: clamped };
}

export function buildSkeleton(input: EngineInput): ProgramSkeleton {
  const D = input.durationWeeks;
  // Resolve the sport config (P0 rewire). For HYROX these values are the same
  // references as the module constants, so output is byte-identical; a different
  // sport supplies different counts / zone targets / starting volume.
  const cfg = getSport(input.sport);
  // 30-40 hours is not a HYROX/DEKA band (Levi, 2026-08-04). Onboarding no longer
  // offers it for those sports, but a program SAVED before this rule would still
  // carry it and would regenerate a 40-hour station-hybrid week on recalculate —
  // so the engine normalizes it here, once, at the single entry point.
  input = normalizeBandForSport(input, cfg);
  const counts: SessionCountTables = {
    run: (cfg.sessionCounts.run as SessionCountTables["run"] | undefined) ?? DEFAULT_COUNTS.run,
    hybrid:
      (cfg.sessionCounts.hybrid as SessionCountTables["hybrid"] | undefined) ??
      DEFAULT_COUNTS.hybrid,
    lift: (cfg.sessionCounts.lift as SessionCountTables["lift"] | undefined) ?? DEFAULT_COUNTS.lift,
    // Station-only sports (totalRaceRunMeters 0) floor runs to 0 and keep them easy.
    runFloor: cfg.runFloor ?? (cfg.totalRaceRunMeters === 0 ? 0 : undefined),
    runCharacter: cfg.totalRaceRunMeters === 0 ? "maintenance" : "full",
    // Research anchors: with an hours budget and a sport that has a research
    // band table, guarantee a threshold + VO2 run every quality week.
    guaranteeQuality: !!input.weeklyHours && !!cfg.bandZone3Z,
  };

  // Research strength dose: at a given budget HYROX wants ~1-3 quality lifts
  // (heavy + power), not a fixed 3-day upper/lower/full split. Override the lift
  // counts and switch to the heavy/power split for a band athlete.
  if (input.weeklyHours && cfg.bandLiftCounts) {
    const [lo, hi] = cfg.bandLiftCounts[input.weeklyHours];
    // Scale within the range by lifting experience: beginner -> min, advanced -> max.
    const expIdx =
      input.liftingExp === "advanced" ? 2 : input.liftingExp === "intermediate" ? 1 : 0;
    const n = Math.round(lo + ((hi - lo) * expIdx) / 2);
    counts.lift = { base: n, build: n, peak: n, taper: Math.max(1, n - 1) };
    counts.researchLifts = true;
  }

  // Research session budget (Finding 4): cap total weekly sessions to the band's
  // Section 6 shape (~5–6 anchors) so a low-budget athlete isn't over-fractionated.
  if (input.weeklyHours && cfg.bandZone3Z) {
    counts.weeklySessionCap = bandSessionCap(input.weeklyHours);
    counts.anchorRunFloor = bandAnchorRunFloor(input.weeklyHours);
  }

  // General fitness has no race to peak toward: a rotating-emphasis macro-arc
  // (strength → aerobic → mixed) with no taper, instead of Base/Build/Peak/Taper.
  if (cfg.programType === "general_fitness") {
    return buildRotationSkeleton(input, cfg, counts);
  }

  // Triathlon (Family B) uses per-discipline swim/bike/run/brick volume — its own
  // deterministic skeleton path (see sports/triathlon.ts).
  if (cfg.family === "triathlon") {
    return buildTriathlonSkeleton(input, cfg);
  }

  const alloc = allocateMesocycles(input);
  const phases = expandPhases(alloc, D);
  const nonTaperWeeks = alloc.base + alloc.build + alloc.peak;

  // 1. Continuous microcycle progression across the non-taper weeks.
  //    User-supplied starting volume overrides the experience-derived defaults.
  const { startMi, startCa } = seedStartVolume(input, cfg);
  const seq = sequenceMicrocycles(nonTaperWeeks, input.trainingClass, startMi, startCa, input.age);

  // 2. Assemble full-length base arrays; apply the peak-phase volume drop.
  const baseMileage: number[] = new Array(D).fill(0);
  const baseCardio: number[] = new Array(D).fill(0);
  const basisMileage: number[] = new Array(D).fill(0); // held peak reference
  const basisCardio: number[] = new Array(D).fill(0);
  const labels: MicroWeekType[] = new Array(D).fill("rebound");

  for (let i = 0; i < nonTaperWeeks; i++) {
    const peakFactor = phases[i] === "peak" ? PEAK_VOLUME_FACTOR : 1;
    // safe: seq arrays all have length nonTaperWeeks, and i < nonTaperWeeks
    baseMileage[i] = round1(seq.mileage[i]! * peakFactor);
    baseCardio[i] = Math.round(seq.cardioMinutes[i]! * peakFactor);
    basisMileage[i] = round1(seq.heldMileage[i]! * peakFactor);
    basisCardio[i] = Math.round(seq.heldCardio[i]! * peakFactor);
    labels[i] = seq.labels[i]!;
  }

  // Seed the trailing Taper-mesocycle weeks with the last held peak level;
  // applyTapers overrides them from the race protocol.
  // safe: guarded by nonTaperWeeks > 0, so nonTaperWeeks - 1 is in-bounds of the length-D arrays
  const lastHeldMi = nonTaperWeeks > 0 ? basisMileage[nonTaperWeeks - 1]! : startMi;
  const lastHeldCa = nonTaperWeeks > 0 ? basisCardio[nonTaperWeeks - 1]! : startCa;
  for (let i = nonTaperWeeks; i < D; i++) {
    baseMileage[i] = lastHeldMi;
    baseCardio[i] = lastHeldCa;
    basisMileage[i] = lastHeldMi;
    basisCardio[i] = lastHeldCa;
    labels[i] = "taper";
  }

  // 3. Insert race tapers (working backward from each race).
  const tapered = applyTapers(
    { mileage: baseMileage, cardioMinutes: baseCardio, microLabels: labels },
    input.races,
    { mileage: basisMileage, cardioMinutes: basisCardio },
  );

  // Contiguous mesocycles start at fixed offsets (Base→Build→Peak→Taper), used
  // to tell the slot builder where a week sits inside its phase (Tasks #5).
  const phaseStart: Record<string, number> = {
    base: 0,
    build: alloc.base,
    peak: alloc.base + alloc.build,
    taper: alloc.base + alloc.build + alloc.peak,
  };
  const phaseLength: Record<string, number> = {
    base: alloc.base,
    build: alloc.build,
    peak: alloc.peak,
    taper: alloc.taper,
  };

  // 4. Build week objects with slots + zone targets.
  const weeks: WeekSkeleton[] = [];
  for (let i = 0; i < D; i++) {
    const weekNumber = i + 1;
    // safe: phases and tapered arrays all have length D, and i < D
    const phase = phases[i]!;
    const microWeek = tapered.microLabels[i]!;
    const race = tapered.raceWeeks.get(weekNumber);
    // safe: phaseStart/phaseLength have an entry for every PhaseName
    const pos = { index: i - phaseStart[phase]!, length: phaseLength[phase]! };

    weeks.push({
      weekNumber,
      phase,
      microWeek,
      targetMileage: tapered.mileage[i]!,
      targetCardioMinutes: tapered.cardioMinutes[i]!,
      zoneTargets: input.weeklyHours
        ? cfg.bandZone3Z
          ? bandPhaseZoneTargets(phase, input.weeklyHours, cfg.bandZone3Z)
          : applyBandZoneShift(cfg.phaseZoneTargets[phase], input.weeklyHours)
        : { ...cfg.phaseZoneTargets[phase] },
      days: assignDays(
        input.trainingDays,
        phase,
        microWeek,
        input.runningExp,
        input.hybridExp,
        race,
        {
          longRunDays: input.longRunDays,
          restDays: input.restDays,
          liftDays: input.liftDays,
          hybridDays: input.hybridDays,
        },
        pos,
        input.needs?.bias,
        counts,
        tapered.mileage[i]!,
      ),
      raceDay: race ? { priority: race.priority, date: race.date } : undefined,
    });
  }

  // After a B race, open the following week with a full rest day then two
  // easy days (48–72h recovery) before resuming normal training.
  applyPostBRaceRecovery(weeks, input.races, input.restDays);
  clampCardioToBand(weeks, input.weeklyHours);

  return {
    durationWeeks: D,
    trainingClass: input.trainingClass,
    allocation: alloc,
    weeks,
    needs: input.needs,
    restDays: input.restDays,
    caps: input.caps,
  };
}

/**
 * Hold every week inside the band's own hours (Levi, 2026-08-04).
 *
 * The volume progression is driven by experience, training class and week number,
 * and never checked itself against the budget the athlete selected. `h20_30`
 * peaked at 32 hours and `h30_40` at 46 — a "30-40 hours" athlete was prescribed
 * 46. Lifts are part of the athlete's time too, so the cardio target is clamped to
 * `bandMax - liftMinutes` and the whole week stays inside the budget.
 *
 * Only ever REDUCES a target. Weeks already inside their band are untouched, so
 * the no-band (legacy) path is completely unaffected.
 */
function clampCardioToBand(weeks: WeekSkeleton[], band: WeeklyHoursBand | undefined): void {
  if (!band) return;
  const budget = bandMaxWeeklyMinutes(band);
  for (const w of weeks) {
    const liftMinutes =
      w.days.reduce((n, d) => n + d.sessions.filter((s) => s.kind === "lift").length, 0) *
      STRENGTH_SESSION_MIN;
    const ceiling = Math.max(0, budget - liftMinutes);
    if (w.targetCardioMinutes > ceiling) w.targetCardioMinutes = ceiling;
  }
}

/** Non-rest workouts on a day. */
function workoutCount(day: WeekSkeleton["days"][number]): number {
  return day.sessions.filter((s) => s.kind !== "rest").length;
}

/**
 * B-race post-race recovery: rest day + two easy days at the start of the week
 * following each B race (spec addition — B post-race protocol).
 *
 * The first three training days are overwritten by the protocol. Anything that
 * was scheduled there used to be silently DELETED, which is how the week after a
 * B race could end up with **zero strength work** for an entire Build week (an
 * athlete who pins their lifts to early-week days lost all of them at once).
 *
 * Displaced LIFT, HYBRID and LONG-RUN sessions are re-homed onto the later days
 * of the same week — 4+ days after the race, so recovery is untouched. Other
 * displaced RUNS are deliberately NOT carried over: `reconcileWeekVolume`
 * re-sizes whatever runs remain to hit the week's prescribed mileage exactly, so
 * a dropped easy run loses no volume, while a dropped lift, hybrid or long run
 * is simply gone.
 *
 * ⚠️ This pass runs LAST — after every guard inside `assignDays` — so whatever it
 * does is final. It is the only mover in the engine that used to receive no day
 * preferences at all (Levi, 2026-08-06). Three consequences, all now fixed:
 *
 *   1. It wrote an easy run onto a **preferred rest day** whenever one fell in
 *      the first three training days. Every other pass takes a `protectedDays`
 *      set precisely to prevent that, and `day-balance.test.ts` asserts a rest
 *      day "stays empty by design". A protected day in the recovery window now
 *      simply stays rest — which serves recovery better than an easy run anyway.
 *   2. It **destroyed the long run** if it was pinned to one of those days. Only
 *      lifts and hybrids were rescued; an athlete who runs long on Monday lost it
 *      outright, and the week shipped with no long run at all.
 *   3. The re-home loop could drop a lift or hybrid **onto** a preferred rest day.
 */
function applyPostBRaceRecovery(
  weeks: WeekSkeleton[],
  races: EngineRace[],
  restDays?: TrainingDayName[],
): void {
  const protectedDays = new Set(restDays ?? []);
  for (const race of races) {
    if (race.priority !== "B") continue;
    const nextWeek = weeks[race.weekNumber]; // weekNumber is 1-based → index = the next week
    if (!nextWeek) continue;
    const d = nextWeek.days;

    const displaced: SessionSlot[] = [];
    for (const idx of [0, 1, 2]) {
      const day = d[idx];
      if (!day) continue;
      for (const s of day.sessions) {
        if (s.kind === "lift" || s.kind === "hybrid" || isLongRunSlot(s)) displaced.push(s);
      }
    }

    // A protected rest day inside the window keeps resting; it does not get an
    // easy run written onto it, and it does not consume one of the two easy slots.
    const setDay = (idx: number, sessions: SessionSlot[]): void => {
      const day = d[idx];
      if (!day) return;
      day.sessions = protectedDays.has(day.day) ? [{ kind: "rest" }] : sessions;
    };
    setDay(0, [{ kind: "rest" }]);
    setDay(1, [{ kind: "run", runType: "easy", goalZone: 2 }]);
    setDay(2, [{ kind: "run", runType: "easy", goalZone: 2 }]);

    // Re-home onto the emptiest later day, keeping the engine's standing rules:
    // at most 2 workouts a day, never two lifts on the same day, and never onto a
    // day the athlete asked to keep clear.
    for (const sess of displaced) {
      let best = -1;
      for (let i = 3; i < d.length; i++) {
        const day = d[i]!; // safe: i < d.length
        if (protectedDays.has(day.day)) continue;
        if (workoutCount(day) >= 2) continue;
        if (sess.kind === "lift" && day.sessions.some((x) => x.kind === "lift")) continue;
        // Two long runs in a week is not a week anyone should train.
        if (isLongRunSlot(sess) && day.sessions.some(isLongRunSlot)) continue;
        if (best === -1 || workoutCount(day) < workoutCount(d[best]!)) best = i;
      }
      if (best === -1) continue; // genuinely no room left — drop, as before
      const target = d[best]!; // safe: best is a valid index
      const restIdx = target.sessions.findIndex((x) => x.kind === "rest");
      if (restIdx !== -1) target.sessions.splice(restIdx, 1); // a rest slot yields
      target.sessions.push(sess);
      // Keep the priority workout first on any day that now doubles up.
      target.sessions.sort((a, b) => slotPriority(b) - slotPriority(a));
    }
    // Re-homing packs lifts onto the emptiest later days without regard to the
    // full-body-lift spacing rule, so two full lifts can land on consecutive days
    // (e.g. Fri+Sat). Re-spread which of these days carries the heavy "full"
    // session so full lifts are never consecutive.
    spreadFullLiftTypes(d);
  }
}

// --- General-fitness rotating-emphasis macro-arc (no race, no taper) ---

/** Emphasis block → synthetic phase, so strength schemes + zone targets + run-type
 *  selection all reuse the existing phase machinery unchanged. */
const EMPHASIS_PHASE: Record<string, PhaseName> = {
  aerobic: "base",
  mixed: "build",
  strength: "peak",
};

/** Sub-goal → the block rotation. Balanced cycles evenly; the others weight the loop. */
const SUBGOAL_ROTATION: Record<string, string[]> = {
  balanced: ["aerobic", "strength", "mixed"],
  recomp: ["strength", "aerobic", "mixed"],
  general_strength: ["strength", "mixed", "aerobic", "strength"],
  general_endurance: ["aerobic", "mixed", "aerobic", "strength"],
};

const BLOCK_WEEKS = 4;

/**
 * Where the microcycle progression STARTS — one place, shared by the race-block
 * and general-fitness paths (they were duplicate blocks that had to be kept in
 * sync by hand).
 *
 * Order of precedence:
 *   1. An explicit `startMileage` / `startCardioMinutes` the athlete typed. Their
 *      own number is a measurement, not an estimate — it is never adjusted.
 *   2. The band tables, scaled by run-impact (experience + bodyweight).
 *   3. The legacy experience defaults, when there is no band.
 *
 * Then `startVolumeReadiness` pitches the DERIVED seed toward how many days the
 * athlete trains today. Note the legacy branch derives cardio FROM mileage, so
 * the factor is applied to mileage only there — applying it to both would
 * discount the same signal twice.
 */
function seedStartVolume(
  input: EngineInput,
  cfg: SportConfig,
): { startMi: number; startCa: number } {
  const readiness = startVolumeReadiness(input.currentDaysPerWeek, input.trainingDays.length);

  const derivedMi = input.weeklyHours
    ? bandStartMileage(input.weeklyHours) * runImpactFactor(input.runningExp, input.bodyWeightLbs)
    : cfg.volume.kind === "single_currency"
      ? cfg.volume.startMileageByExp[input.runningExp]
      : startingMileage(input.runningExp);

  const startMi = input.startMileage ?? round1(derivedMi * readiness);

  const startCa =
    input.startCardioMinutes ??
    (input.weeklyHours
      ? Math.round(bandStartCardioMinutes(input.weeklyHours) * readiness)
      : // already carries `readiness` through startMi — do not apply it twice
        startingCardioMinutes(startMi));

  return { startMi, startCa };
}

/**
 * Build a general-fitness skeleton: repeating ~4-week emphasis blocks
 * (strength/aerobic/mixed) instead of Base→Build→Peak→Taper. Microcycles run
 * continuously across all weeks (rising baseline), there is no taper, and each
 * week carries its `emphasis` for the UI/AI. The sub-goal chooses the rotation.
 */
function buildRotationSkeleton(
  input: EngineInput,
  cfg: SportConfig,
  counts: SessionCountTables,
): ProgramSkeleton {
  const D = input.durationWeeks;
  const { startMi, startCa } = seedStartVolume(input, cfg);
  // Continuous progression across ALL weeks (no taper carve-out) → rising baseline.
  const seq = sequenceMicrocycles(D, input.trainingClass, startMi, startCa, input.age);

  const rotation = SUBGOAL_ROTATION[input.subGoal ?? "balanced"] ?? SUBGOAL_ROTATION.balanced!;

  const weeks: WeekSkeleton[] = [];
  for (let i = 0; i < D; i++) {
    const blockIdx = Math.floor(i / BLOCK_WEEKS);
    const emphasis = rotation[blockIdx % rotation.length]!;
    const phase = EMPHASIS_PHASE[emphasis]!;
    const microWeek = seq.labels[i]!;
    const posIndex = i % BLOCK_WEEKS;
    const posLen = Math.min(BLOCK_WEEKS, D - blockIdx * BLOCK_WEEKS);
    // Strength-emphasis blocks (mapped to "peak") carry slightly less cardio volume.
    const peakFactor = phase === "peak" ? PEAK_VOLUME_FACTOR : 1;

    weeks.push({
      weekNumber: i + 1,
      phase,
      microWeek,
      targetMileage: round1(seq.mileage[i]! * peakFactor),
      targetCardioMinutes: Math.round(seq.cardioMinutes[i]! * peakFactor),
      zoneTargets: input.weeklyHours
        ? cfg.bandZone3Z
          ? bandPhaseZoneTargets(phase, input.weeklyHours, cfg.bandZone3Z)
          : applyBandZoneShift(cfg.phaseZoneTargets[phase], input.weeklyHours)
        : { ...cfg.phaseZoneTargets[phase] },
      days: assignDays(
        input.trainingDays,
        phase,
        microWeek,
        input.runningExp,
        input.hybridExp,
        undefined, // no race
        {
          longRunDays: input.longRunDays,
          restDays: input.restDays,
          liftDays: input.liftDays,
          hybridDays: input.hybridDays,
        },
        { index: posIndex, length: posLen },
        input.needs?.bias,
        counts,
        round1(seq.mileage[i]! * peakFactor),
      ),
      emphasis,
    });
  }

  // Allocation is informational for general fitness — report block-phase counts.
  const alloc = { base: 0, build: 0, peak: 0, taper: 0 };
  for (const w of weeks) alloc[w.phase] += 1;

  clampCardioToBand(weeks, input.weeklyHours);

  return {
    durationWeeks: D,
    trainingClass: input.trainingClass,
    allocation: alloc,
    weeks,
    needs: input.needs,
    restDays: input.restDays,
    caps: input.caps,
  };
}

// --- Adapter: GenerationInput (spec section 2 shape) -> EngineInput (week-space) ---

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Convert a validated GenerationInput into the engine's week-space input.
 *
 * `startDate` is required for goal_event programs (to place races by week and,
 * when durationWeeks is omitted, to derive the program length from the final
 * race). For fixed_duration / general_fitness, durationWeeks drives length and
 * any races are positioned relative to the start.
 */
/** Body weight in kilograms (bike W/kg needs kg regardless of the athlete's unit). */
function toLbs(weight: number | undefined, unit: "lbs" | "kg" | undefined): number | undefined {
  if (weight === undefined || !(weight > 0)) return undefined;
  return unit === "kg" ? weight * 2.2046226218 : weight;
}

function toKg(weight: number | undefined, unit: "lbs" | "kg" | undefined): number | undefined {
  if (!weight || weight <= 0) return undefined;
  return unit === "lbs" ? weight * 0.453592 : weight;
}

/**
 * The band a pre-`weeklyHours` program should be treated as having, reconstructed
 * from the volume it was actually built with.
 *
 * Uses the SAME start-volume derivation the legacy engine path uses, so the
 * inferred band describes the program the athlete really has rather than a guess:
 * an explicit `startCardioMinutes` if they typed one, else their stored
 * `startMileage` x `AVG_MIN_PER_MILE`, else the sport's own experience default.
 *
 * Then bounded by the athlete's TRAINING-DAY COUNT. This bound is the important
 * half. A band is not just a volume label — `trainingCaps` takes the MAX of the
 * experience tier and the band, so a band RAISES the session and day caps. That is
 * the right direction for the problem being solved (legacy weeks were landing
 * short because 90-minute sessions couldn't hold the prescription), but only if
 * there are days to spend it on. An athlete training 3 days a week must not
 * inherit 10-20 hour caps, so the inference is capped at what their week can hold.
 */
function legacyStartVolume(
  input: GenerationInput,
  cfg: SportConfig,
): { startMi: number; startCa: number } {
  const startMi =
    input.startMileage ??
    (cfg.volume.kind === "single_currency"
      ? cfg.volume.startMileageByExp[input.profile.runningExp]
      : startingMileage(input.profile.runningExp));
  const startCa = input.startCardioMinutes ?? startingCardioMinutes(startMi);
  return { startMi, startCa };
}

function inferBandForLegacy(input: GenerationInput, cfg: SportConfig): WeeklyHoursBand {
  const { startCa } = legacyStartVolume(input, cfg);
  const fromVolume = inferBandFromStartCardio(startCa);
  const fromDays = maxBandForTrainingDays(input.profile.trainingDays.length);
  return minBand(fromVolume, fromDays);
}

export function toEngineInput(input: GenerationInput, startDate?: string): EngineInput {
  const start = startDate ? new Date(startDate) : undefined;
  const sportCfg = getSport(input.sport);
  // 30-40 h is not a HYROX/DEKA band (Levi, 2026-08-04). Onboarding no longer
  // offers it there, but a program SAVED before this rule still carries it — and
  // this is the single door every generation and recalculate comes through, so
  // the band is normalized here, BEFORE it reaches the caps or the volume tables.
  //
  // A program from BEFORE `weeklyHours` existed carries no band at all, and a
  // bandless program bypasses every band rule on recalculate — session cap, day
  // cap, hour ceiling, session budget, zone shift. So when the band is missing it
  // is INFERRED from the volume the program already had (Levi, 2026-08-05 —
  // "yes back fill").
  //
  // ⚠️ SCOPE: the inferred band feeds the CAPS ONLY. It is deliberately not
  // written to `weeklyHours`, so nothing else in the engine sees it.
  //
  // The wider version — treating a legacy program as a full band program — was
  // built and measured first, and it is too big a change to apply to someone
  // mid-program. Volume stayed correct, but the training CHARACTER did not: on a
  // real 5-day legacy HYROX week the zone mix went Z1 25%->19%, Z5 3%->11%
  // (nearly 4x the VO2 work), the week lost a training day to the band session
  // budget, and easy/fartlek runs became interval and threshold runs. Nobody
  // signed up for that by clicking "recalculate".
  //
  // Caps alone fix the problem that was actually reported. A bandless program
  // took its session cap from the lowest experience tier — 90 minutes — which is
  // why legacy triathlon weeks landed an average of 476 minutes under their
  // prescription: a 70.3 build needs three-hour rides and had a 90-minute
  // ceiling. Raising the ceiling to what the athlete's own volume implies keeps
  // every other aspect of their program exactly as it is.
  const weeklyHours = input.profile.weeklyHours
    ? clampBandToFamily(sportCfg.family, input.profile.weeklyHours)
    : undefined;
  const capBand =
    weeklyHours ?? clampBandToFamily(sportCfg.family, inferBandForLegacy(input, sportCfg));

  const rawRaces = input.races ?? [];
  let races: EngineRace[] = [];

  if (start && rawRaces.length > 0) {
    races = rawRaces
      .map((r) => ({
        weekNumber: Math.max(
          1,
          Math.ceil((new Date(r.raceDate).getTime() - start.getTime()) / MS_PER_WEEK),
        ),
        priority: r.priority,
        date: r.raceDate,
      }))
      .sort((a, b) => a.weekNumber - b.weekNumber);
  }

  // Determine duration.
  let durationWeeks = input.durationWeeks ?? 0;
  if (!durationWeeks) {
    if (races.length > 0) {
      durationWeeks = Math.max(...races.map((r) => r.weekNumber));
    } else {
      durationWeeks = 12; // sensible default; onboarding should always supply one
    }
  }
  durationWeeks = clamp(durationWeeks, 4, 24);

  races = races
    .map((r) => ({ ...r, weekNumber: clamp(r.weekNumber, 1, durationWeeks) }))
    .filter((r, idx, arr) => arr.findIndex((x) => x.weekNumber === r.weekNumber) === idx);

  return {
    sport: input.sport ?? "hyrox",
    // Carried through at P0 (unconsumed) so the band reaches the engine when
    // volume/zone scaling is wired in a later phase. buildSkeleton ignores it
    // today, so HYROX output stays byte-identical.
    weeklyHours,
    subGoal: input.subGoal,
    trainingClass: input.profile.trainingClass,
    age: input.profile.age,
    runningExp: input.profile.runningExp,
    hybridExp: input.profile.hybridExp,
    liftingExp: input.profile.liftingExp,
    // Explicit per-discipline experience wins; else derive from CSS / FTP anchors.
    swimLevel: input.profile.swimExp ?? swimLevelFromCss(input.profile.benchmarks?.cssPace),
    bikeLevel:
      input.profile.bikeExp ??
      bikeLevelFromFtp(
        input.profile.benchmarks?.ftpWatts,
        toKg(input.profile.bodyWeight, input.profile.weightUnit),
        input.profile.sex,
      ),
    programType: input.programType,
    durationWeeks,
    // The day count follows the band, the same way the band follows the family
    // twenty lines up. Onboarding has validated this since 2026-08-04, but a
    // program SAVED before that rule came back through here every recalculate
    // with a week the band could not physically fit — 504 audited days shipped
    // two lifts, every one of them an h20_30 band on 4 days.
    //
    // ⚠️ SCOPE: only when the athlete EXPLICITLY chose a band. `capBand` (the
    // legacy back-fill) is deliberately not used — inferring a band from volume
    // and then adding training days off that inference would rewrite the week of
    // every bandless program in the system, including the golden fixtures.
    trainingDays: weeklyHours
      ? clampTrainingDaysToBand(
          input.profile.trainingDays,
          weeklyHours,
          input.profile.dayPreferences?.restDays,
        )
      : input.profile.trainingDays,
    races,
    startMileage: input.startMileage,
    startCardioMinutes: input.startCardioMinutes,
    currentDaysPerWeek: input.profile.currentDaysPerWeek,
    bodyWeightLbs: toLbs(input.profile.bodyWeight, input.profile.weightUnit),
    longRunDays: normalizeLongRunDays(input.profile.dayPreferences),
    restDays: input.profile.dayPreferences?.restDays,
    caps: trainingCaps(
      getSport(input.sport).family,
      {
        runningExp: input.profile.runningExp,
        hybridExp: input.profile.hybridExp,
        liftingExp: input.profile.liftingExp,
      },
      // `capBand`, not `weeklyHours` — a legacy program gets the caps its own
      // volume implies without becoming a band program in any other respect.
      capBand,
    ),
    liftDays: input.profile.dayPreferences?.liftDays,
    hybridDays: input.profile.dayPreferences?.hybridDays,
    needs: analyzeNeedsForSport(input.profile, input.sport, {
      ergStations: sportCfg.needsStations?.erg,
      strengthStations: sportCfg.needsStations?.strength,
    }),
  };
}
