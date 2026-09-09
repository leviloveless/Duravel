/**
 * Deterministic weekly-volume reconciliation (Levi's hard rules).
 *
 * The engine prescribes each week's running mileage and total cardio time; the
 * AI fills session content. This pass rewrites the volume so both totals are
 * exact, using FIXED formula paces (see lib/engine/paces.ts):
 *
 *   1. Running is sized to hit the prescribed weekly MILEAGE exactly, each run
 *      at its formula pace. Minimums: easy/long runs ≥ 3 miles; every cardio
 *      session ≥ 45 min; no run exceeds 90 min.
 *   2. On tight weeks (e.g. deloads) where the minimums don't fit, easy runs are
 *      dropped and their miles folded into the long run (which can grow to the
 *      90-min cap).
 *   3. Whatever CARDIO TIME the running doesn't cover is filled by a
 *      "Non-running Zone 1–2 cardio" block, so the cardio total is exact.
 *   4. Hybrid runs are rewritten to threshold pace.
 *
 * Requires the athlete's formula paces; if none (no 5K on file) the week is
 * left untouched.
 */

import type { ProgramDay, Session } from "@/lib/schemas";
import type { ExperienceLevel, RunType } from "@/lib/engine/types";
import { effectivePace, formatPace, paceLabel, type RunPaces } from "@/lib/engine/paces";
import { hybridWarmupLine, hybridCooldownLine } from "@/lib/engine/run-descriptions";
import {
  runOverhead,
  runOverheadFor,
  runTimeOverheadFor,
  runOverheadMiles,
  runOverheadMilesFor,
  sessionMiles,
  STRENGTH_SESSION_MIN,
  sessionTiming,
  weekMileage,
  hybridRunMiles,
  hybridOverheadMiles,
} from "@/lib/session-volume";
import { round1 } from "@/lib/engine/math";
import {
  recoveryFactor,
  recoveryMinutesForReps,
  repsForWorkMiles,
  REP_DISTANCE_MILES,
} from "@/lib/engine/interval-structure";
import { DEFAULT_CAPS, MAX_SESSIONS_PER_DAY, type TrainingCaps } from "@/lib/engine/caps";

type RunSession = Extract<Session, { kind: "run" }>;
type CardioSession = Extract<Session, { kind: "cardio" }>;

// Longest single session, in minutes, comes from the athlete's caps (90 / 105 / 120
// by experience, keyed off the sport family — see lib/engine/caps.ts). A run and a
// Zone 1–2 block on the same day are two SESSIONS: each is capped on its own, and
// the day cap is what bounds their sum.
const MIN_CARDIO_TOTAL = 45; // every standalone cardio session ≥ 45 min
// A Zone 1–2 block that stands on its own has to be worth the trip: 45 minutes is
// the floor (Levi's rule). The ONE exception is a block that sits beside another
// CARDIO session on the same day — a run or a hybrid — where it reads as a brick /
// second aerobic piece rather than a session of its own. A lift is NOT cardio, so a
// lift day gets the standalone floor: 30-minute spins bolted onto Tue and Wed lift
// days are wrong; 90 surplus minutes become 45 + 45, not 30 + 30 + 30.
const MIN_CARDIO_BLOCK = 45;
const MIN_BRICK_CARDIO = 30;
// Below this, a leftover isn't worth putting on the calendar at all: the week's
// prescribed cardio total is allowed to land a few minutes short rather than ship a
// token block. Every gap at or above it is still filled exactly.
const MIN_MEANINGFUL_CARDIO = 15;
const EASY_LONG_MIN_MI = 3;
/** An easy run still has to be a RUN once its warm-up is taken off the top. */
const MIN_RUN_WORK_MI = 1;
/**
 * The smallest quality session that is still the session it is named after.
 *
 * A rep-based run needs at least two reps — one rep is a stride, and Levi's
 * per-rep HR prescription has nothing to prescribe against. A continuous quality
 * run needs `MIN_QUALITY_WORK_MIN` at pace for the same reason.
 *
 * These replaced a 45-MINUTE floor, which was the wrong currency: it made a
 * threshold session cost 5.8 miles of a week before a single mile of it was
 * useful, so two quality sessions ate a 15-mile week whole and the long run got
 * the crumbs. The 45 minutes is still owed — `writeRun` now pays the balance in
 * Zone 1–2 cross-training instead of in miles the athlete should not be running.
 * Fewer miles per quality session is the point: it is what buys the week MORE of
 * them, which is Levi's ask — *"prioritize more frequent quality sessions rather
 * than longer ones."*
 */
const MIN_QUALITY_REPS = 2;
const MIN_QUALITY_WORK_MIN = 15;
/** Cross-training is prescribed in whole 5-minute blocks. */
const CROSS_CARDIO_STEP = 5;
/**
 * The most of a week's mileage ONE quality session may be (Levi, 2026-09-08).
 *
 * His report: *"the threshold workout is 7 miles while the long run is only 3.5
 * miles. The long run should be the longest by mileage each week. The
 * programming should prioritize more frequent quality sessions rather than
 * extending the duration of an individual session."*
 *
 * Measured across 775 generated weeks that carry a quality run, a threshold or
 * interval session out-measured the long run in **689 of them (89%)** — worst
 * case a 17.1 mi threshold session against a 5.8 mi long run. It was already 78%
 * on pre-August `main`, so this is a long-standing gap that the long-run ceilings
 * (`caps.longRun`, and the +10% jump cap) then made worse: they hold the long run
 * down, and the week's remaining miles had nowhere to go but the quality session.
 *
 * The share comes from Levi's own worked examples, which agree:
 *
 *   15 mi week → 2 × 3 mi easy + **3 mi interval** + 6 mi long  (quality 20%, long 40%)
 *   18 mi week → 3 × 3 mi easy + **3 mi threshold** + 6 mi long (quality 17%, long 33%)
 *
 * A ceiling, never a floor: a week too small to pay for `minMiles` still gets its
 * session at the minimum, because a quality session below its own minimum is not
 * a quality session.
 */
const MAX_QUALITY_RUN_SHARE = 0.2;
/**
 * The share of the week's RUNNING miles the long run is served FIRST
 * (Levi, 2026-09-08: "the long run should be the longest by mileage each week").
 *
 * Sizing spread every mile above the runs' minimums by `TYPE_WEIGHT`, which
 * sounds fair and is not: a quality session's minimum is large (a 45-minute
 * floor, 25 minutes of warm-up and cool-down, and 2:1 recoveries between reps),
 * so in a week with little running left after the hybrids the quality run took
 * its big minimum and the long run took the remainder. Measured: of 604 weeks
 * where a quality run out-measured the long run, **581 had a long run smaller
 * than its own previous weeks** — nothing capped it, it simply came last. Raising
 * the week's RUN COUNT (the 2026-09-08 frequency principle) makes that worse, not
 * better: more runs means a smaller weighted share each, the long run included.
 *
 * A FLOOR, not a ration — the long run still takes its weighted share of what is
 * left afterwards. The base is the week's RUN miles, not its total: with a hybrid
 * taking a third of a HYROX week, a share of the total would ask the long run to
 * be nearly all of the running. 33% matches Levi's worked examples (6 of 15, 6 of
 * 18) and both of his ceilings still win over it.
 */
const LONG_RUN_TARGET_SHARE = 0.33;
/** Quality run types the share ceiling applies to. */
const SHARE_CAPPED_TYPES: ReadonlySet<RunType> = new Set([
  "threshold",
  "tempo",
  "interval",
  "fartlek",
  "progression",
]);
/**
 * Residual the long run may take past its jump ceiling.
 *
 * The convergence loop places training-sized miles and the cap governs those
 * strictly. What is left afterwards is arithmetic — a tenth rounded off each of
 * several runs — and refusing THAT shipped weeks 0.2 mi under their stated
 * target, which breaks the stronger invariant that the plan and the calendar
 * agree. Sized against the worst observed rounding residual; anything bigger is
 * a real training decision and the ceiling wins.
 */
const SNAP_OVERSHOOT_TOLERANCE = 0.25;
/**
 * Smallest remainder worth turning into its own run when the long-run ceiling
 * bites. `buildEasyRuns(…, atLeastOne)` never emits less than a 45-minute
 * session, so anything under this becomes a run far bigger than the miles it was
 * given — which is precisely how the first version of the cap wrecked a program.
 */
const MIN_STANDALONE_RUN_MI = 3.5;
/**
 * Floor for a RECOVERY jog, in total minutes (Levi, 2026-08-19).
 *
 * The 45-minute floor above is an EASY-run floor, and coaching practice is
 * consistent that those are two different sessions: an easy run is 45–75 min,
 * a recovery run is **20–45 min**, and a shakeout is 15–25. Pfitzinger &
 * Douglas, via Tom Schwartz, size a recovery run at 10–15% of weekly distance —
 * which on a 12 mi/week athlete is 15–22 minutes, so a flat 45-minute floor is
 * not a conservative choice there, it is a category error.
 *
 * No trial establishes a minimum useful duration for easy running in either
 * direction — the 45 was never evidence-based either. What evidence exists runs
 * the other way: a volume/intensity meta-regression found frequency and total
 * volume drive mitochondrial content and VO2max, concluding that consistency and
 * frequency matter more than any single session's length, and the running-injury
 * literature finds training FREQUENCY has no independent association with injury
 * once progression and load are accounted for.
 *
 * Used only where the long-run ceiling displaces miles that have nowhere else to
 * go. Everything else in this file still gets the 45-minute floor.
 */
const MIN_RECOVERY_TOTAL = 20;
const MIN_RUN_MILES = 0.3;

// Long-run progression (Tasks addition #5). The long run should be clearly
// longer than the easy runs in the same week and grow week over week toward the
// 90-min cap. These control a redistribution-only pass: miles are pulled from
// the easy runs into the long run (weekly mileage stays exact), so the long run
// reaches a week-ramped duration target without changing the prescribed volume.
const LONG_RUN_BASE_WORK = 50; // week-1 long-run work-minutes target
const LONG_RUN_STEP_WORK = 4; // added work-minutes per subsequent week
const LONG_RUN_DOMINANCE = 1.5; // long run ≥ 1.5× the longest easy run

/** Relative distance share by run type when spreading remaining miles. */
const TYPE_WEIGHT: Record<RunType, number> = {
  long: 2.0,
  progression: 1.3,
  fartlek: 1.2,
  tempo: 1.1,
  threshold: 1.1,
  interval: 1.0,
  easy: 1.0,
  hybrid_run: 1.0,
};

/** How readily a run is dropped when a week is too small (lower = dropped first; long never). */
const DROP_RANK: Record<RunType, number> = {
  easy: 0,
  fartlek: 1,
  progression: 1,
  tempo: 2,
  threshold: 3,
  interval: 3,
  hybrid_run: 4,
  long: 99,
};

const CARDIO_DESCRIPTION =
  "Easy Zone 1–2 non-running cardio (bike, row, ski erg, or elliptical) to complete the week's prescribed cardio volume. Keep it conversational — this is aerobic time, not a hard effort.";

interface RunEntry {
  day: ProgramDay;
  ref: RunSession;
  type: RunType;
  paceMin: number; // minutes per mile
  overhead: number; // warmup + cooldown minutes
  /**
   * Those overhead minutes as MILES, at easy pace — the distance this run costs
   * the week before its main set runs a single step.
   *
   * It is not a rounding term. A beginner's interval session carries 25 minutes
   * of warm-up, cool-down and between-rep jogging: 2.3 miles at 10:33/mi, on a
   * week whose whole target might be 10.5. Sizing against work-only minimums
   * while the week is CHARGED work + overhead is what let three quality runs be
   * kept in a week that could never pay for them.
   */
  overheadMi: number;
  /**
   * Recovery-jog MILES this run adds per WORK mile.
   *
   * A rep-based run jogs between its reps, and that distance is on the athlete's
   * feet and in `sessionMiles` — but the entry model reasoned in `min +
   * overheadMi` and so did not see it. It undercounted an interval session by a
   * quarter of a mile, which is precisely the margin the ordering turns on: the
   * long run's floor was raised to a "3.03-mile" interval that was really 3.3,
   * and the interval stayed the longer run. Zero for continuous runs.
   *
   * The reps are at rep pace and the recovery is at easy pace, so the conversion
   * carries both: work minutes are `miles * paceMin`, recovery minutes are those
   * times the rest ratio, and recovery miles are those over the easy pace.
   */
  recPerMi: number;
  min: number; // min WORK miles
  max: number; // max WORK miles — the athlete's hard session cap
  /**
   * A SOFTER ceiling that applies before `max` — today only the long run's
   * week-to-week jump limit (`lib/engine/long-run-cap.ts`). Sizing respects it,
   * but a remainder too small to become its own session is handed back up to
   * `max` rather than manufacturing a 45-minute filler run. See `sizeRuns`.
   */
  softMax?: number;
  miles: number;
}

function makeCardio(durationMin: number): CardioSession {
  return {
    kind: "cardio",
    durationMin: Math.max(1, Math.round(durationMin)),
    goalZone: 2,
    modality: "Zone 1–2 cross-training (bike / row / ski / elliptical)",
    description: CARDIO_DESCRIPTION,
  };
}

/** A day hosting a race must never receive reconciler-added run/cardio blocks. */
function isRaceDay(day: ProgramDay): boolean {
  return day.sessions.some((s) => s.kind === "race");
}

/**
 * Does this day already carry aerobic work of any kind? Runs, hybrids and the
 * reconciler's own Zone 1–2 blocks all count — a lift-only day does not. Used to
 * spread filler onto the days that have no cardio yet, so a week can't end up
 * with its aerobic work bunched at one end.
 */
function dayHasCardio(day: ProgramDay): boolean {
  return day.sessions.some(
    (s) =>
      s.kind === "run" ||
      s.kind === "hybrid" ||
      s.kind === "cardio" ||
      s.kind === "bike" ||
      s.kind === "swim" ||
      s.kind === "brick",
  );
}

/**
 * Shortest legal Zone 1–2 block on this day.
 *
 * On its own a block must be a real session (45 min — under that the aerobic
 * return doesn't justify a trip to the gym). Beside a run or hybrid it is a brick
 * tail / second aerobic piece and may be shorter. Lifts don't count as cardio, so
 * a lift day gets the standalone floor.
 */
function cardioFloor(day: ProgramDay): number {
  return dayHasCardio(day) ? MIN_BRICK_CARDIO : MIN_CARDIO_BLOCK;
}

/**
 * The most cardio minutes this week's day layout can physically hold.
 *
 * Levi's call (2026-08-04): the prescribed `targetCardioMinutes` used to be set
 * purely from volume progression, with no reference to whether the athlete's
 * chosen days could hold it. In a 480-week audit, 193 weeks (~40%) finished under
 * target — the worst by 626 minutes — because the minutes simply had nowhere to
 * go, and the same cramped shapes emitted 150–490 minute over-cap blocks through
 * the "pile the overflow onto the last block" fallback. `reconcile` then reported
 * the total as exact, which it was not.
 *
 A day holds at most `caps.day` minutes of training. A LIFT is not cardio but
 * still spends `STRENGTH_SESSION_MIN` of that budget, so a lift day offers
 * strictly less cardio room. Race days and the athlete's chosen rest days offer
 * none at all.
 *
 * Verified against the worst case in the audit: an advanced, highly-trained
 * athlete training 3 days a week was prescribed 1116 cardio minutes (18.6 hours
 * across three days) and could place 539. This formula predicts 540.
 *
 * Sizing the target to this makes the prescription honest: the athlete sees the
 * volume their week can actually take, and the reconciler stops silently missing.
 */
export function weekCardioCapacity(
  days: ProgramDay[],
  caps: TrainingCaps,
  avoidDays: readonly string[] = [],
): number {
  let capacity = 0;
  for (const d of days) {
    if (isRaceDay(d)) continue;
    if (avoidDays.includes(d.day)) continue; // the athlete asked to keep this clear
    // SLOTS are the real constraint, not minutes. A day has two, full stop. A lift
    // spends one without contributing any cardio; a run or hybrid spends one and
    // contributes what it already is. Only the slots left over can take a new
    // Zone 1-2 block, and each of those holds at most `cardioSession`.
    let aerobic = 0;
    let lifts = 0;
    for (const s of d.sessions) {
      if (s.kind === "lift") lifts++;
      else if (s.kind !== "race") aerobic += sessionTiming(s).total;
    }
    const freeSlots = Math.max(0, MAX_SESSIONS_PER_DAY - d.sessions.length);
    capacity += Math.min(
      Math.max(0, caps.day - lifts * STRENGTH_SESSION_MIN),
      aerobic + freeSlots * caps.cardioSession,
    );
  }
  return capacity;
}

/**
 * Where the reconciler is allowed to put the filler it adds (the non-running
 * Zone 1–2 blocks and any extra easy runs).
 *   - `avoidDays`: the athlete's preferred rest days. Filler used to land here by
 *     default, because an empty rest day always looks like the "least loaded" one —
 *     which is how a designated rest day could end up the biggest day of the week.
 *   - `preferDays`: the weekend. The athlete asked for Sat/Sun to carry the most
 *     volume, so surplus aerobic time goes there before anywhere else.
 */
export interface FillerPlacement {
  avoidDays?: readonly string[];
  preferDays?: readonly string[];
}

const WEEKEND_DAYS: readonly string[] = ["sat", "sun"];

/**
 * Least-loaded day that still has room under the per-day workout cap (default 2),
 * so reconciler-added cardio/easy-run blocks don't stack a 3rd session on a day.
 * Falls back to the overall least-loaded day only when every day is already at the
 * cap (unavoidable — more sessions than 2 x training days).
 */
function leastLoadedUnderCap(days: ProgramDay[], cap = 2, place: FillerPlacement = {}): number {
  // Rank: weekend first (the athlete wants Sat/Sun biggest), then emptiest.
  //
  // This is the REMAINDER path only. Spreading aerobic work across the week is
  // handled explicitly in phase 1 of the gap fill; putting a cardio-free bonus in
  // here as well double-counted it and let a weekday win the leftover block too,
  // which is how the weekend stopped being the biggest day.
  const score = (d: ProgramDay): number =>
    (place.preferDays?.includes(d.day) ? 100 : 0) - d.sessions.length * 10;
  let best = -1;
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!; // safe: i < days.length
    if (isRaceDay(d)) continue; // never load a race day
    if (place.avoidDays?.includes(d.day)) continue; // never load a rest day
    if (d.sessions.length >= cap) continue;
    if (best === -1 || score(d) > score(days[best]!)) best = i;
  }
  // No day has room. Return -1 rather than falling back to `leastLoadedDay`,
  // which ignores the cap: that fallback is how an added easy run became a THIRD
  // session on a day. Two a day is absolute, so the caller drops the run and the
  // week lands short — the same trade the cardio filler already makes.
  return best;
}

/** Rewrite the pace token in a hybrid session's run elements to threshold pace. */
function rewriteHybridPaces(days: ProgramDay[], thresholdSecPerMile: number): void {
  const th = formatPace(thresholdSecPerMile);
  for (const d of days) {
    for (const s of d.sessions) {
      if (s.kind !== "hybrid") continue;
      for (const el of s.elements) {
        const isRun = /run/i.test(el.exercise) || /run/i.test(el.prescription);
        if (!isRun) continue;
        el.prescription = el.prescription.replace(/@\s*\d{1,2}:\d{2}/, `@ ${th}`);
      }
    }
  }
}

export function reconcileWeekVolume(
  days: ProgramDay[],
  targetMileage: number,
  targetCardioMinutes: number,
  paces: RunPaces | null,
  runningExp: ExperienceLevel,
  weekNumber = 1,
  place: FillerPlacement = { preferDays: WEEKEND_DAYS },
  caps: TrainingCaps = DEFAULT_CAPS,
  /**
   * Ceiling on the LONG RUN's total miles this week — `longRunCapMiles()` of the
   * athlete's trailing four weeks (see `lib/engine/long-run-cap.ts`). Omitted =
   * no ceiling, which is both the start of a program and every legacy caller.
   *
   * A CEILING, not a target: it never grows a long run, and the week's mileage
   * still has to come out exact. When the cap bites, the miles go to the other
   * runs — and if every one of them is already at its own session cap, `sizeRuns`
   * emits another easy run to carry them. Only when the week has nowhere left to
   * put a session does the long run take them anyway; the week's arithmetic wins
   * over the ceiling, and that is the documented trade.
   */
  longRunCap?: number,
  /** Mesocycle phase — sets the long run's share of the week (`LONG_RUN_SHARE`). */
  phase?: string,
): number {
  if (!paces) return targetMileage; // no 5K → can't apply formula paces
  // A and B race weeks are taper/event weeks: their reduced sessions are set by
  // the taper protocol, so leave them exactly as built. A C race "trains through"
  // a normal full week (spec §6), so it MUST still be reconciled to the engine's
  // mileage target — otherwise the AI's unclamped run distances stand and the
  // week reads far over volume. The race day itself carries no run, so it is
  // skipped naturally by the run-sizing below and protected from added blocks.
  const raceSession = days
    .flatMap((d) => d.sessions)
    .find((s): s is Extract<Session, { kind: "race" }> => s.kind === "race");
  if (raceSession && raceSession.priority !== "C") {
    // Taper/event week: the reduced sessions come from the taper protocol and must
    // not be resized. Two things still have to happen.
    //
    // First, a run the AI omitted arrives here as a PLACEHOLDER — zero distance,
    // zero duration, empty pace — and because race weeks skip resizing, nothing
    // ever filled it in. The athlete's final week shipped an "Easy run — 0 min @
    // /mile — 0 miles" on the calendar. Size those (and only those) to the run's
    // own minimum so the session is real; everything the taper actually
    // prescribed is left untouched.
    for (const d of days) {
      if (isRaceDay(d)) continue;
      for (const s of d.sessions) {
        if (s.kind !== "run" || s.distanceMiles > 0) continue;
        const paceMin = effectivePace(s.runType, paces) / 60;
        setRunMiles(
          s,
          minMiles(s.runType, paceMin, runOverhead(s.runType)),
          paceMin,
          caps.session,
          runningExp,
        );
        s.paceMinMile = paceLabel(s.runType, paces);
      }
    }
    // Second, stamp warmup/cooldown and between-rep recovery — without it a race
    // week's runs report WORK miles only, so the final week silently undercounts
    // itself against every other week in the program (the same class of gap as the
    // interval/threshold text drift).
    stampRunOverhead(days, effectivePace("easy", paces) / 60, runningExp, caps.session);
    return round1(weekMileage({ days }));
  }

  // Size the prescription to what these days can actually hold. Anything above
  // this could never be placed — it only produced a week that quietly missed its
  // own stated total, or an over-cap block absorbing the overflow.
  const capacity = weekCardioCapacity(days, caps, place.avoidDays ?? []);
  const cardioTarget = Math.min(targetCardioMinutes, capacity);

  rewriteHybridPaces(days, paces.threshold);
  // The hybrid warm-up/cooldown JOG (Levi, 2026-08-06). Stamped before the run
  // budget is computed so those miles are part of the week's total from the
  // start — the athlete's prescribed mileage does not go up, the runs come down
  // to make room, exactly as a run's own overhead behaves.
  stampHybridOverhead(days, paces);

  // Fixed hybrid contribution.
  let hybridMi = 0;
  let hybridMin = 0;
  for (const d of days)
    for (const s of d.sessions) {
      if (s.kind === "hybrid") {
        // WORK miles only, deliberately. `sessionMiles` now also counts the
        // hybrid warm-up/cooldown jog, but feeding that into the run BUDGET
        // would shrink `RM` enough to trip the consolidation loop below, which
        // DELETES a run outright rather than shortening it. The overhead is
        // still counted — the convergence loop further down converges
        // `weekMileage` (which includes it) onto the target, so the runs give
        // the distance back by getting shorter. Same total, no lost session.
        hybridMi += hybridRunMiles(s) + (s.overheadMiles ?? 0);
        hybridMin += sessionTiming(s).total;
      }
    }
  // Collect run entries.
  const easyPaceMin = effectivePace("easy", paces) / 60;
  const runs: RunEntry[] = [];
  for (const d of days) {
    for (const s of d.sessions) {
      if (s.kind !== "run") continue;
      const paceMin = effectivePace(s.runType, paces) / 60;
      // TIME overhead (`runOverhead`, the whole warm-up) and MILEAGE overhead
      // (`runOverheadMiles`, only the part that was run) are different currencies
      // now that a quality warm-up is part jogged and part biked.
      const overhead = runOverhead(s.runType);
      runs.push({
        day: d,
        ref: s,
        type: s.runType,
        paceMin,
        overhead,
        overheadMi: runOverhead(s.runType) / easyPaceMin,
        recPerMi: (recoveryFactor(s.runType, runningExp) * paceMin) / easyPaceMin,
        min: minMiles(s.runType, paceMin, overhead),
        // The LONG run answers to its own ceiling — 90 min for the station
        // sports, higher for triathlon (Levi, 2026-08-23). See `caps.longRun`.
        max: runMaxMiles(
          s.runType,
          paceMin,
          overhead,
          overhead / easyPaceMin,
          caps,
          runningExp,
          targetMileage,
        ),
        softMax:
          s.runType === "long" && longRunCap !== undefined
            ? Math.max(minMiles(s.runType, paceMin, overhead), longRunCap - overhead / easyPaceMin)
            : undefined,
        miles: 0,
      });
    }
  }
  const RM = Math.max(0, round1(targetMileage - hybridMi)); // running miles to place (work)

  const added: Session[] = [];

  if (runs.length === 0) {
    // The week prescribes mileage but the AI planned no run at all — emit one,
    // and a real one, even if the target is smaller than a session.
    if (RM > 0) added.push(...buildEasyRuns(RM, paces, runningExp, caps.session, true));
  } else {
    sizeRuns(runs, RM, days, paces, runningExp, added, caps.session, place, targetMileage);
    enforceLongRun(runs, weekNumber, caps.longRun);
    for (const r of runs)
      writeRun(r, paces, r.type === "long" ? caps.longRun : caps.session, runningExp);
  }

  // Place added easy runs before the mileage true-up so they count.
  for (const s of added) {
    const target = leastLoadedUnderCap(days, 2, place);
    if (target === -1) break; // every day is at two workouts — nowhere legal left
    days[target]!.sessions.push(s);
  }

  // The prescribed weekly mileage is the athlete's TOTAL on-feet distance:
  // warmup/cooldown AND between-rep recovery jogging all count toward it. Stamp
  // that overhead onto every run, then converge the week to the target by
  // shrinking (or growing) the run distances — re-stamping each pass because a
  // run's recovery distance scales with its (changing) work time.
  for (let iter = 0; iter < 6; iter++) {
    stampRunOverhead(days, easyPaceMin, runningExp, caps.session);
    const diff = round1(targetMileage - weekMileage({ days }));
    if (Math.abs(diff) < 0.05) break;
    adjustRunMilesToTotal(
      days,
      diff,
      paces,
      runningExp,
      caps.session,
      longRunCap,
      caps.longRun,
      targetMileage,
    );
  }
  stampRunOverhead(days, easyPaceMin, runningExp, caps.session);
  // A proportional shrink can leave a sub-tenth residual (a 0.1 remainder spread
  // across many runs rounds away on each), so snap it onto the longest run — its
  // fixed overhead and (for the long run) zero recovery make that exact.
  const residual = round1(targetMileage - weekMileage({ days }));
  if (Math.abs(residual) >= 0.05) {
    const snapRefs: RunSession[] = [];
    for (const d of days) for (const s of d.sessions) if (s.kind === "run") snapRefs.push(s);
    // NEVER below the run's own minimum. This snap is a rounding cleanup — a
    // tenth of a mile the proportional shrink could not place — but it took
    // whatever `residual` said, and on a week whose target is smaller than one
    // real session that is a large NEGATIVE number. It clamped at MIN_RUN_MILES
    // (0.3) and produced the 13-minute "long run" that a 0–5 h beginner was
    // shipped in weeks 13 and 14.
    //
    // When the residual will not fit, the week stays honestly over its stated
    // mileage. That is a number the athlete can read; a 13-minute long run is
    // not a long run.
    //
    // GROWING is anchored differently from shrinking: a long run already at its
    // jump ceiling is not eligible, or this rounding cleanup would hand it back
    // the very miles the cap just took away. When nothing is eligible the week
    // simply lands where it landed.
    const anchor = residual > 0 ? growthAnchor(snapRefs, longRunCap) : longestRun(snapRefs);
    if (anchor) {
      const anchorPace = effectivePace(anchor.runType, paces) / 60;
      const floor = minMiles(anchor.runType, anchorPace, runOverhead(anchor.runType));
      // A residual this small is arithmetic, not training: letting the long run
      // take a tenth of a mile past its ceiling keeps the week's stated mileage
      // exact, and 0.1 mi on a 7-mile long run is 1.4% — nowhere near a "jump".
      // Refusing it instead shipped weeks 0.05 mi UNDER target, which breaks the
      // stronger invariant that the plan and the calendar agree.
      const move =
        residual > 0 && residual > SNAP_OVERSHOOT_TOLERANCE
          ? growthRoom(anchor, residual, longRunCap)
          : residual;
      const want = Math.max(floor, anchor.distanceMiles + move);
      if (Math.abs(want - anchor.distanceMiles) >= 0.05) {
        setRunMiles(
          anchor,
          want,
          anchorPace,
          // The long run answers to its own ceiling here too — this snap is how
          // a 30 mi/week athlete's long run reached 98 minutes under a 90-minute
          // rule (Levi, 2026-08-23).
          anchor.runType === "long" ? caps.longRun : caps.session,
          runningExp,
        );
        stampRunOverhead(days, easyPaceMin, runningExp, caps.session);
      }
    }
  }

  // LAST WORD ON WHICH RUN IS LONGEST. Everything above is free to resize runs to
  // hit the week's total; this makes the long run the week's longest and grows it
  // toward its share. See `anchorLongRun`.
  anchorLongRun(days, {
    targetMileage,
    phase,
    paces,
    exp: runningExp,
    easyPaceMin,
    caps,
    longRunCap,
    days,
    place,
  });

  // ...and only THEN the cross-training top-up, because `anchorLongRun` above is
  // the last pass that resizes a run. This was originally stamped in `writeRun`
  // and went stale behind every resize that followed it: a run shortened from 45
  // minutes to 32 kept the "no top-up needed" answer computed when it was still
  // 45, and shipped as a 32-minute session. Nothing changes a run's length after
  // this line, so nothing can invalidate it.
  stampCrossCardio(days);

  // Fill the remaining cardio time with a non-running Zone 1–2 block(s).
  let runningCardio = 0;
  for (const d of days)
    for (const s of d.sessions) {
      if (s.kind === "run" || s.kind === "hybrid") runningCardio += sessionTiming(s).total;
    }
  let gap = Math.round(cardioTarget) - runningCardio;

  // GIVE THE CROSS-TRAINING BACK WHEN THE WEEK CANNOT AFFORD IT.
  //
  // `writeRun` tops every short run up to `MIN_CARDIO_TOTAL` with a Zone 1–2
  // block inside the session. Normally that costs the week nothing: those
  // minutes are already in `runningCardio`, so the standalone filler below
  // places exactly that many fewer. But a week whose runs and hybrids ALREADY
  // exceed its cardio target has no filler to take it out of, and the top-up
  // became pure addition — measured, an h0_5 week with three hybrids reached 319
  // minutes against a 300-minute band.
  //
  // So the block yields to the athlete's stated hours. Taken back in whole
  // `CROSS_CARDIO_STEP` units, largest first, and only as far as the overrun: a
  // week that is 10 minutes over gives back 10, not all of it. What is left is a
  // run that is honestly shorter than 45 minutes in a week that is already full,
  // which is the right way round — the 45-minute rule exists to stop a session
  // being too small to be worth the trip, not to push a week past its budget.
  if (gap < 0) {
    const withCross = days
      .flatMap((d) => d.sessions)
      .filter((s): s is RunSession => s.kind === "run" && (s.crossCardioMin ?? 0) > 0)
      .sort((a, b) => (b.crossCardioMin ?? 0) - (a.crossCardioMin ?? 0));
    for (const r of withCross) {
      if (gap >= 0) break;
      const have = r.crossCardioMin ?? 0;
      const give = Math.min(have, Math.ceil(-gap / CROSS_CARDIO_STEP) * CROSS_CARDIO_STEP);
      if (give <= 0) continue;
      if (give >= have) delete r.crossCardioMin;
      else r.crossCardioMin = have - give;
      gap += give;
    }
  }
  // A gap this small is rounding, not a training stimulus. When the week's runs
  // already cover almost all the prescribed cardio, the leftover used to be emitted
  // as its own block — a 9-minute "session" on the calendar. Letting the weekly
  // total land a few minutes short is the better trade (Levi, 2026-08-04); every
  // gap big enough to matter is still hit exactly.
  if (gap >= MIN_MEANINGFUL_CARDIO) {
    for (const { day, minutes } of planFiller(days, gap, place, caps)) {
      day.sessions.push(makeCardio(minutes));
    }
  }

  // THE MILEAGE THIS WEEK ACTUALLY DELIVERS.
  //
  // Almost always identical to `targetMileage`. It differs only where the target
  // is smaller than the smallest REAL week the athlete can be given — a 0–5 h
  // beginner whose hybrid alone is 7.8 of a 7.9-mile target, with a long run
  // still to place. There is nothing left to shrink that would not turn a session
  // into a non-session, so the week lands over, and the PRESCRIPTION should say so
  // rather than the plan and the calendar disagreeing (Levi, 2026-08-06).
  //
  // ⚠️ IT REPORTS SHORT WEEKS TOO (Levi, 2026-09-08).
  //
  // This used to be `Math.max(targetMileage, delivered)` with one exception, on
  // the reasoning that a week coming in UNDER its target is a bug and must stay
  // visible as one. It was the right instinct and the wrong mechanism: raising
  // the number did not fix the week, it only made the prescription disagree with
  // the calendar, which is the exact complaint that started this work.
  //
  // Levi's call, asked directly: when an athlete's stated mileage and their
  // stated hours contradict each other, the HOURS win and the week says so. So a
  // week that cannot hold its miles reports the miles it holds. Three things can
  // cause that and all three are honest — the long run on its jump ceiling or
  // its 90-minute cap, every run on its floor in a week too small to pay for
  // them, or a remainder smaller than the last indivisible rep the week has left.
  //
  // Reporting it is also the better-evidenced choice. The reason the ceilings
  // exist at all is a cohort finding that change in WEEKLY VOLUME had little
  // predictive value for injury while a single run exceeding the athlete's
  // recent longest by 10–30% carried 64% higher risk. Given those two numbers,
  // the invariant worth bending is the weekly total.
  //
  // The regression guard moved to where it belongs: the "generous targets" sweep
  // asserts the week lands within one rep of its target wherever it has room, so
  // a real shortfall still fails a test rather than being absorbed here.
  //
  // `assembleProgram` adopts whatever comes back as the week's target, so the
  // prescription and the calendar always agree.
  const delivered = round1(weekMileage({ days }));
  // A week can land short for three reasons and all three are honest: the long
  // run pinned at a ceiling (the trailing-four-week jump cap OR its own 90-minute
  // one), every run sitting on its floor in a week too small to pay for them, or
  // a remainder smaller than the last indivisible rep the week has left — a
  // rep-based run moves in WHOLE reps, so a 0.4 mi remainder is not something an
  // interval session can absorb at all.
  //
  // There is no longer a `Math.max(targetMileage, delivered)` here. Raising the
  // number never fixed the week, it only made the prescription disagree with the
  // calendar, which is the complaint that started this work.
  return delivered;
}

/** One filler block the plan wants: how many minutes, on which day. */
interface FillerAllocation {
  day: ProgramDay;
  minutes: number;
}

/**
 * Decide the whole Zone 1–2 filler layout BEFORE writing any of it.
 *
 * This replaces a place-then-repair design. Previously blocks were pushed onto days
 * in priority order and a follow-up pass mutated them — moving minutes between
 * blocks, deleting some — to satisfy "Sat/Sun are the biggest days". That pass was
 * the source of three separate bugs: it spliced from the wrong day's session list
 * and deleted a lift, it grew a block past the athlete's session cap, and it encoded
 * the priority order implicitly in call sequence. Mutating already-prescribed
 * sessions to satisfy a soft preference is the wrong shape.
 *
 * Now the constraint is checked at planning time: try to spread onto as many days as
 * possible, and back off one day at a time until the weekend still comes out on top.
 * Nothing is written until the layout satisfies every rule, so nothing has to be
 * repaired afterwards.
 *
 * Priority order (the athlete's): use every day → keep the weekend biggest → pair
 * the lift days. Hard limits that outrank all three: the 45-minute floor on a
 * standalone block, the per-session cap, the per-day cap, two workouts a day, and
 * hitting the prescribed cardio total exactly.
 */
function planFiller(
  days: ProgramDay[],
  gap: number,
  place: FillerPlacement,
  caps: TrainingCaps,
): FillerAllocation[] {
  const isPreferred = (d: ProgramDay): boolean => !!place.preferDays?.includes(d.day);
  // These blocks ARE Zone 1-2 cardio, so they are bounded by the cardio cap, not
  // the general session cap (Levi, 2026-08-04: two sessions a day is absolute;
  // high-volume weeks absorb their volume through LONGER easy aerobic blocks).
  const room = (d: ProgramDay): number =>
    Math.min(caps.cardioSession, caps.day - dayTotalMinutes(d));
  const eligible = (d: ProgramDay): boolean =>
    !isRaceDay(d) &&
    !place.avoidDays?.includes(d.day) &&
    d.sessions.length < 2 &&
    room(d) >= cardioFloor(d);

  const hosts = days.filter(eligible);
  if (hosts.length === 0) return [];

  const weekend = hosts.filter(isPreferred);
  // Spread targets, in priority order: days with nothing on them first (use every
  // day), then lift days with no aerobic work (pair the lifts). Taking them in
  // calendar order instead spent the budget on Monday and left Tuesday's lift dry.
  const spreadTargets = [
    ...hosts.filter((d) => !isPreferred(d) && d.sessions.length === 0),
    ...hosts.filter((d) => !isPreferred(d) && d.sessions.length > 0 && !dayHasCardio(d)),
  ];

  const weekdayPeak = (spreadCount: number): number => {
    const spread = new Set(spreadTargets.slice(0, spreadCount));
    return Math.max(
      0,
      ...days
        .filter((d) => !isPreferred(d))
        .map((d) => dayTotalMinutes(d) + (spread.has(d) ? MIN_CARDIO_BLOCK : 0)),
    );
  };

  // Back off one spread day at a time until the weekend still ends up on top. k = 0
  // (everything to the weekend) is always tried last and always terminates. Each
  // spread day takes exactly one minimum block, so the weekend keeps the surplus.
  for (let k = Math.min(spreadTargets.length, Math.floor(gap / MIN_CARDIO_BLOCK)); k >= 0; k--) {
    const spend = k * MIN_CARDIO_BLOCK;
    if (spend > gap) continue;
    const plan: FillerAllocation[] = spreadTargets
      .slice(0, k)
      .map((day) => ({ day, minutes: MIN_CARDIO_BLOCK }));
    const rest = spread(gap - spend, weekend, plan, caps);
    if (rest > 0) continue; // the weekend can't absorb the remainder at this k
    const weekendPeak = Math.max(
      0,
      ...weekend.map((d) => dayTotalMinutes(d) + (plan.find((a) => a.day === d)?.minutes ?? 0)),
    );
    if (weekendPeak >= weekdayPeak(k)) return plan;
  }

  // Nothing satisfied weekend-biggest — the week's shape makes it impossible (both
  // weekend days already at the session cap, say). Fall back to the layout that
  // serves the higher priorities: spread as widely as the minutes allow, remainder
  // wherever it fits. A soft preference yields; the hard caps and the exact total
  // never do.
  const plan: FillerAllocation[] = [];
  let left = gap;
  for (const day of spreadTargets) {
    if (left < MIN_CARDIO_BLOCK * 2) break; // keep something back for the remainder
    plan.push({ day, minutes: MIN_CARDIO_BLOCK });
    left -= MIN_CARDIO_BLOCK;
  }
  let overflow = spread(left, [...weekend, ...hosts.filter((d) => !isPreferred(d))], plan, caps);
  // A remainder too small to be its own block is topped onto blocks already planned
  // (still under the caps) rather than shipped as a 20-minute standalone session.
  overflow = absorb(plan, overflow, caps);
  if (overflow > 0) {
    // Still stranded: park it beside another cardio session, where a short block is
    // legal as a brick tail. Weekend first, so the weekend keeps the volume.
    const brick = hosts
      .filter((d) => dayHasCardio(d) && !plan.some((a) => a.day === d) && room(d) >= overflow)
      .sort((a, b) => Number(isPreferred(b)) - Number(isPreferred(a)))[0];
    if (brick) {
      plan.push({ day: brick, minutes: overflow });
      overflow = 0;
    }
  }
  // Last resort. This used to read `plan[last].minutes += overflow` with the note
  // "unavoidable", which is how a week ended up shipping a SINGLE 1707-minute
  // (28-hour) Zone 1-2 block: whatever could not be placed was simply piled onto
  // one session, unbounded, and the week reported its total as met.
  //
  // Nothing is served by a session no human can do. The remainder is placed only
  // up to the cardio cap; anything still stranded is DROPPED and the week lands
  // honestly short (Levi, 2026-08-04 — two sessions a day is absolute, and a
  // capped block is a real session where a 28-hour one is not).
  if (overflow > 0 && plan.length > 0) {
    const last = plan[plan.length - 1]!;
    const headroom =
      Math.min(caps.cardioSession, caps.day - dayTotalMinutes(last.day)) - last.minutes;
    last.minutes += Math.min(overflow, Math.max(0, headroom));
  } else if (overflow > 0) {
    const host = hosts[0]!;
    plan.push({
      day: host,
      minutes: Math.min(overflow, Math.min(caps.cardioSession, caps.day - dayTotalMinutes(host))),
    });
  }
  return plan.filter((a) => a.minutes > 0);
}

/**
 * Lay `minutes` across `hosts` in as MANY legal blocks as the minutes allow, split
 * as evenly as the caps permit. Frequency beats duration: a Zone 1–2 session stops
 * paying back much past ~45 minutes, so 90 surplus minutes are two 45s on two days,
 * never one 90. Below 2 × the floor there is only one block and it takes the lot.
 *
 * Respects each day's remaining room, the per-day floor (45 standalone, 30 next to a
 * run/hybrid), and never puts two filler blocks on one day. Mutates `plan`; returns
 * whatever could not be placed.
 */
function spread(
  minutes: number,
  hosts: ProgramDay[],
  plan: FillerAllocation[],
  caps: TrainingCaps,
): number {
  let left = minutes;
  const capacity = (d: ProgramDay): number =>
    Math.min(caps.cardioSession, caps.day - dayTotalMinutes(d));
  const open = hosts.filter((d) => !plan.some((a) => a.day === d)); // one block per day
  if (open.length === 0 || left <= 0) return left;

  // How many blocks the minutes can pay for at the standalone floor, bounded by the
  // days available. Always at least one: the total has to land somewhere exact.
  const pieces = Math.max(1, Math.min(open.length, Math.floor(left / MIN_CARDIO_BLOCK)));
  const chosen = open.slice(0, pieces);
  for (let i = 0; i < chosen.length && left > 0; i++) {
    const day = chosen[i]!; // safe: i < chosen.length
    const share = Math.round(left / (chosen.length - i)); // an even cut of what's left
    const give = Math.min(share, left, capacity(day));
    if (give < cardioFloor(day)) continue; // too small to be legal here — rolls onward
    plan.push({ day, minutes: give });
    left -= give;
  }

  // Mop-up: whatever the even split could not seat (a day too small for its share, an
  // awkward remainder) goes onto the next day that can legally take it.
  for (const day of open) {
    if (left <= 0) break;
    if (plan.some((a) => a.day === day)) continue;
    const give = Math.min(left, capacity(day));
    if (give < cardioFloor(day)) continue;
    plan.push({ day, minutes: give });
    left -= give;
  }
  return left;
}

/**
 * Top up blocks the plan already holds with `minutes` that could not stand alone,
 * never past the session or day cap. Returns whatever still would not fit.
 */
function absorb(plan: FillerAllocation[], minutes: number, caps: TrainingCaps): number {
  let left = minutes;
  for (const a of plan) {
    if (left <= 0) break;
    // The block isn't written to the day yet, so its own minutes are not in the total.
    const headroom = Math.min(caps.cardioSession, caps.day - dayTotalMinutes(a.day)) - a.minutes;
    const add = Math.min(left, Math.max(0, headroom));
    a.minutes += add;
    left -= add;
  }
  return left;
}

/** Total prescribed minutes on a day, across every session it holds. */
function dayTotalMinutes(day: ProgramDay): number {
  return day.sessions.reduce((n, s) => n + sessionTiming(s).total, 0);
}

/**
 * The shortest this run may be, in WORK miles.
 *
 * ## Why an easy run's floor is a DISTANCE and not 45 minutes
 *
 * Every standalone cardio session owes `MIN_CARDIO_TOTAL` — 45 minutes, Levi's
 * rule, and it stands. What changed on 2026-09-08 is how a run is allowed to PAY
 * it. Paying in distance alone set the shortest run the engine could write at
 * ~4.6 miles, and that one number was quietly deciding the shape of every week:
 * four runs cost 18.4 miles of minimums, so a 15-mile week could hold three runs
 * at most, and Levi's own worked example — 15 miles as 6 long + 3 + 3 + 3 —
 * could not be built at all. Measured across 1,536 weeks: every run in the
 * program sat on its own floor, the long run's floor was the smallest of them,
 * and so the long run was the SHORTEST run of the week 87% of the time.
 *
 * So the floor becomes `MIN_MILES_PER_RUN` of TOTAL running, and the rest of the
 * 45 minutes is paid in Zone 1–2 cross-training inside the same session — his
 * instruction: *"a one hour easy cardio workout might be 30 minutes on the bike
 * and 30 minutes running."* `writeRun` stamps those minutes; the session is
 * still 45 minutes long, it is just no longer 4.6 miles long.
 *
 * The run's own warm-up and cool-down are at easy pace here, so `overhead /
 * paceMin` converts them exactly — this branch only ever runs for easy and long.
 *
 * ## Why a quality run's floor is still a duration
 *
 * A threshold session is not a distance, it is a dose: reps at a pace, and below
 * a couple of real reps it stops being the session it is named after. Shrinking
 * it to 3 miles the way an easy run shrinks would leave a warm-up, one rep and a
 * cool-down — and the point of buying volume with frequency is that the extra
 * sessions stay real ones. So quality keeps the duration floor, and a week too
 * small to pay for it drops it instead (`sizeRuns`'s consolidation), which is
 * the honest outcome Levi asked for: substitution only where there is no room.
 */
/** A run entry's TOTAL miles for `work` work miles — reps, recovery and overhead. */
function entryTotal(r: RunEntry, work: number): number {
  return work * (1 + r.recPerMi) + r.overheadMi;
}

/** The inverse: WORK miles that would make this run `total` miles long. */
function entryWork(r: RunEntry, total: number): number {
  return (total - r.overheadMi) / (1 + r.recPerMi);
}

function minMiles(type: RunType, paceMin: number, overhead: number): number {
  if (type === "easy" || type === "long")
    return Math.max(MIN_RUN_WORK_MI, EASY_LONG_MIN_MI - overhead / paceMin);
  const repMiles = REP_DISTANCE_MILES[type];
  if (repMiles !== undefined) return MIN_QUALITY_REPS * repMiles;
  return MIN_QUALITY_WORK_MIN / paceMin;
}

/**
 * Longest this run may be, in miles, under the athlete's session cap.
 *
 * A rep-based run adds between-rep recovery ON TOP of the rep time, so the cap has
 * to be shared between them: sizing purely on rep time let a "90 minute" interval
 * session actually run to 105.
 */
/** Total miles a run currently covers — work plus its stamped overhead. */
function runTotalMiles(s: RunSession): number {
  return s.distanceMiles + (s.overheadMiles ?? 0);
}

/**
 * The longest run in the week.
 *
 * By WORK distance, which is what this file has always compared here — the
 * overhead is fixed per run type, so ranking by total would quietly reorder
 * runs whose work distances are close and change which one absorbs a rounding
 * residual. The cap comparisons below use `runTotalMiles`, because the ceiling
 * is a total-mile figure; the two are deliberately different questions.
 */
function longestRun(runs: RunSession[]): RunSession | null {
  return runs.length === 0
    ? null
    : runs.reduce((a, b) => (b.distanceMiles > a.distanceMiles ? b : a));
}

/**
 * The run that should absorb ADDED miles.
 *
 * The longest one, as it has always been — except that a long run already at its
 * week-to-week jump ceiling is skipped, and the next-longest takes the miles
 * instead. `null` when every candidate is capped out, which leaves the week
 * short rather than putting the miles somewhere they were deliberately taken
 * from. See `lib/engine/long-run-cap.ts`.
 */
function growthAnchor(runs: RunSession[], longRunCap?: number): RunSession | null {
  // A REP-BASED RUN IS NEVER THE ANCHOR FOR GROWTH (Levi, 2026-09-08).
  //
  // Its distance snaps to whole reps, so handing an interval or threshold session
  // a rounding residual does not add a tenth of a mile — it adds a whole rep, and
  // the recovery jog that comes with it. Measured: a 17.1-mile week's threshold
  // run went from 3.8 to 5.2 miles, 30% of the week, on a residual of a few
  // tenths. That breaks `MAX_QUALITY_RUN_SHARE` and it breaks the reason the
  // share exists — quality grows by FREQUENCY, not by one session getting longer.
  //
  // Easy, long and the continuous quality runs have no such granularity, so the
  // residual lands where it can actually be a residual. When none of them has
  // room the week keeps the tenth and reports what it delivered.
  const continuous = runs.filter((r) => REP_DISTANCE_MILES[r.runType] === undefined);
  const eligible =
    longRunCap === undefined
      ? continuous
      : continuous.filter((r) => r.runType !== "long" || runTotalMiles(r) < longRunCap - 0.05);
  return longestRun(eligible);
}

/**
 * How many of `add` miles this run may actually take.
 *
 * Eligibility is not enough on its own: a long run sitting a tenth under its
 * ceiling is still the longest run in the week, so it would be handed the WHOLE
 * remaining difference and sail past the cap. Clamping here leaves the rest for
 * the next pass of the convergence loop, which will pick a different anchor now
 * that this one is full.
 */
function growthRoom(run: RunSession, add: number, longRunCap?: number): number {
  if (run.runType !== "long" || longRunCap === undefined) return add;
  return Math.max(0, Math.min(add, longRunCap - runTotalMiles(run)));
}

/**
 * The ceiling on ONE run's work miles, in the run's own currency.
 *
 * Three different ceilings meet here, and which one binds says what kind of
 * session it is:
 *
 *  - the LONG run answers to `caps.longRun` — 90 min for the station sports,
 *    higher for triathlon (Levi, 2026-08-23);
 *  - a QUALITY run answers to `MAX_QUALITY_RUN_SHARE` of the week as well as to
 *    the session cap, so quality grows by FREQUENCY rather than by length
 *    (Levi, 2026-09-08);
 *  - everything else answers to the session cap alone.
 *
 * The share is expressed in TOTAL miles (it is a share of the week's total), so
 * the run's own overhead comes off before it can be compared with a work figure.
 * It never drops below the run's minimum: a week too small to pay for a real
 * quality session gets one at its minimum, or the consolidation pass drops it —
 * shrinking it into a token is the one outcome nobody wants.
 */
function runMaxMiles(
  type: RunType,
  paceMin: number,
  overhead: number,
  overheadMi: number,
  caps: TrainingCaps,
  exp: ExperienceLevel,
  targetMileage: number,
): number {
  const cap = maxMiles(paceMin, overhead, type === "long" ? caps.longRun : caps.session, type, exp);
  if (!SHARE_CAPPED_TYPES.has(type) || targetMileage <= 0) return cap;
  // A quality run's TOTAL is work + overhead + the recovery jogs BETWEEN reps
  // (`recoveryMiles`), and the recovery is what made the first version of this
  // ceiling useless: a threshold session capped at 20% of work still shipped at
  // 26% of the week once its 2:1 recoveries were counted. Divide the share out
  // the same way `workBudget` divides the session cap.
  const shareTotal = targetMileage * MAX_QUALITY_RUN_SHARE - overheadMi;
  const shareWork = shareTotal / (1 + recoveryFactor(type, exp));
  return Math.max(minMiles(type, paceMin, overhead), Math.min(cap, shareWork));
}

function maxMiles(
  paceMin: number,
  overhead: number,
  sessionCap: number,
  runType: RunType = "easy",
  exp: ExperienceLevel = "intermediate",
): number {
  return workBudget(sessionCap, overhead, runType, exp) / paceMin;
}

/**
 * Minutes of REP time a run may carry under the session cap.
 *
 * Every place that clamps work minutes has to go through this. A rep-based run
 * adds recovery on top of its reps, so `sessionCap - overhead` is the budget for
 * reps AND recovery together — using it for reps alone let a 90-minute cap ship
 * 92-minute sessions.
 */
function workBudget(
  sessionCap: number,
  overhead: number,
  runType: RunType,
  exp: ExperienceLevel,
): number {
  // Floored so the reps plus their floored recovery can never round past the cap.
  return Math.floor((sessionCap - overhead) / (1 + recoveryFactor(runType, exp)));
}

/**
 * THE LONG RUN'S FLOOR IS THE WEEK'S BIGGEST FLOOR — AS FAR AS THE WEEK CAN PAY
 * FOR IT (Levi, 2026-09-08).
 *
 * Even with every ceiling in place, the ordering still inverted at the bottom:
 * when a week cannot pay for its runs' minimums, every run sits at its own
 * floor — and a quality session's floor is the largest of them, because it
 * carries 25 minutes of warm-up and cool-down plus the recoveries between reps,
 * against the long run's 10. Measured: an 18 mi week held `threshold 5.9`
 * beside `long 4.6`, both at their minimums.
 *
 * So the long run's floor rises to match the biggest floor in the week — but it
 * is clamped to what is LEFT after every other run's minimum, and it runs AFTER
 * consolidation. Both matter. The first version raised the floor while the run
 * entries were being built, which inflated the week's minimum total, which sent
 * weeks into the consolidation loop that would not otherwise have gone there:
 * a 26.5 mi week lost its threshold run and shipped `easy + long`. Buying the
 * ordering by deleting the quality session is the opposite of the doctrine —
 * volume goes up by ADDING sessions, and more sessions is what keeps their
 * quality. So this floor only ever spends slack. Where a week has none, the
 * ordering yields and the sessions stand.
 */
function raiseLongRunFloor(runs: RunEntry[], RM: number): void {
  const long = runs.find((r) => r.type === "long");
  if (!long) return;
  let biggestOtherFloor = 0;
  let othersMinTotal = 0;
  for (const r of runs) {
    if (r === long) continue;
    const t = entryTotal(r, r.min);
    biggestOtherFloor = Math.max(biggestOtherFloor, t);
    othersMinTotal += t;
  }
  if (biggestOtherFloor === 0) return;
  // The jump ceiling still binds. It looked for a while as though it could not:
  // a week whose long run sat on its 3-mile floor set the next week's ceiling at
  // 3.3, which collapsed again, and the long run stayed the shortest run in the
  // program for all 16 weeks. But the collapse was never the ceiling's doing —
  // it was `recPerMi`, the recovery miles the entry model was not counting, which
  // let a quality run's real size hide from every floor meant to out-rank it.
  // With that fixed the long run starts where it should and the +10% rule has
  // room to work, so it keeps its authority here: it is the one number in this
  // file with a 5,205-runner cohort behind it.
  const ceiling = Math.min(long.max, long.softMax ?? long.max);
  const affordable = entryWork(long, RM - othersMinTotal);
  long.min = Math.max(long.min, Math.min(entryWork(long, biggestOtherFloor), ceiling, affordable));
}

/** Size the run distances to sum to RM, honoring min/max, dropping easy runs
 *  into the long run when the week is too small to fit every minimum. */
function sizeRuns(
  runs: RunEntry[],
  RM: number,
  days: ProgramDay[],
  paces: RunPaces,
  runningExp: ExperienceLevel,
  added: Session[],
  sessionCap: number,
  place: FillerPlacement = {},
  /** The week's TOTAL mileage target — the base for the long run's share. Levi's
   *  worked examples are shares of the WEEK (6 of 15, 6 of 18), not of what is
   *  left after the hybrid, and in a HYROX week those differ by a third. */
  weekTargetMileage = 0,
): void {
  // Consolidate: while the minimums don't fit, drop the most-droppable run
  // (never the long run) and remove it from its day.
  //
  // ⚠️ The comparison must be against TOTAL minimums — work PLUS the run's own
  // warm-up/cool-down/recovery distance. `RM` is a TOTAL-mile budget (it is
  // `targetMileage` less the hybrid's total, overhead included), so testing it
  // against work-only minimums compared two different things and consolidation
  // under-fired badly.
  //
  // Measured 2026-08-06 across 675 non-race weeks: a beginner 0–5 h week kept
  // interval + threshold + long, whose FIXED overhead alone was 6.6 miles of a
  // 10.5-mile target. Nothing could shrink far enough, so the convergence loop
  // drove the long run to 0.3 mi / 13 min — 196 runs (8.3%) shipped below their
  // own documented minimum, and 99 weeks still landed over target anyway.
  const minTotal = (r: RunEntry) => entryTotal(r, r.min);
  // The long run's floor is raised BEFORE consolidation as well as after, so the
  // week pays for the ordering by dropping an easy run rather than by shipping a
  // long run shorter than its quality session. Consolidation drops by
  // `DROP_RANK` — easy first, quality later, the long run never — so this
  // spends the cheapest thing in the week, which is the right thing to spend.
  raiseLongRunFloor(runs, Infinity);
  while (runs.length > 1 && RM < runs.reduce((a, r) => a + minTotal(r), 0)) {
    // Drop the most-droppable run (easy first; never the long run).
    const victimIdx = runs.reduce(
      (best, r, i) =>
        r.type !== "long" && (best === -1 || DROP_RANK[r.type] < DROP_RANK[runs[best]!.type])
          ? i
          : best, // safe: runs[best] only read when best !== -1, a prior in-bounds index
      -1,
    );
    if (victimIdx === -1) break;
    const victim = runs.splice(victimIdx, 1)[0]!; // safe: victimIdx !== -1 and in-bounds, so splice yields exactly one element
    const j = victim.day.sessions.indexOf(victim.ref);
    if (j !== -1) victim.day.sessions.splice(j, 1);
  }

  raiseLongRunFloor(runs, RM);

  const sumMin = runs.reduce((a, r) => a + minTotal(r), 0);
  if (RM <= sumMin) {
    // Nothing droppable is left (the long run is never a victim) and the week
    // still cannot pay for what remains. HOLD THE MINIMUMS.
    //
    // This used to scale below them — `Math.max(MIN_RUN_MILES, r.min * scale)`,
    // with `MIN_RUN_MILES` 0.3 — which is precisely how a "long run" of 0.3 mi /
    // 13 min reached the athlete's calendar. Keeping the week's arithmetic exact
    // was allowed to override the session being a real session, and it bought
    // nothing: the week landed over target regardless, because the overhead it
    // was ignoring does not shrink.
    //
    // A week that lands honestly over its stated mileage is a number the athlete
    // can read. A 13-minute long run is not a long run.
    for (const r of runs) r.miles = r.min;
  } else {
    let remainder = RM - sumMin;
    for (const r of runs) r.miles = r.min;

    // THE LONG RUN IS SERVED FIRST. Its target share comes off the top so it
    // cannot end up as the leftovers of everyone else's minimums; its own
    // ceilings (the session cap, the +10% jump limit) still bound it.
    const longFirst = runs.find((r) => r.type === "long");
    if (longFirst && remainder > 0) {
      const want = Math.min(
        Math.min(longFirst.max, longFirst.softMax ?? longFirst.max),
        Math.max(RM, weekTargetMileage) * LONG_RUN_TARGET_SHARE - longFirst.overheadMi,
      );
      const head = Math.max(0, Math.min(want - longFirst.miles, remainder));
      longFirst.miles += head;
      remainder -= head;
    }

    // What is left divides in the usual proportions across EVERY run, the long
    // one included — the head start is a floor, not a ration.
    const wsum = runs.reduce((a, r) => a + TYPE_WEIGHT[r.type], 0) || runs.length;
    for (const r of runs) r.miles += (remainder * TYPE_WEIGHT[r.type]) / wsum;
    // Clamp to the ceiling, pool overflow, redistribute (long run first), else
    // add easy runs. `ceiling` is the SOFT one wherever a run has one — the long
    // run's jump limit — so the excess is offered to the other runs first.
    //
    // THE LONG RUN IS THE WEEK'S LONGEST RUN (Levi, 2026-09-08). No other run may
    // be sized past what the long run itself could reach this week — its own
    // ceiling, jump limit included. That figure is knowable before any miles are
    // placed, so it can act as a plain ceiling on everything else rather than a
    // correction afterwards, and the miles it displaces flow into the overflow
    // path below: another session, which is what "more frequent quality rather
    // than longer sessions" asks for.
    //
    // Compared in TOTAL miles (each run's own overhead differs), then converted
    // back into the run's own work currency.
    const longEntry = runs.find((r) => r.type === "long");
    // ...against the long run's HARD ceiling, not its jump ceiling. The jump
    // ceiling is a statement about the long run's own recent history; applying it
    // to every OTHER run made one week's small long run throttle the entire next
    // week, and the week then simply came up short — 142 of 1,536 weeks landed
    // under their stated mileage, which is a number the athlete reads and a bug
    // they can see. The long run's floor rising to the week's biggest run (see
    // `raiseLongRunFloor`) is what holds the ordering; this is only the ceiling.
    const longCeilingTotal =
      longEntry === undefined ? Infinity : entryTotal(longEntry, longEntry.max);
    const ceiling = (r: RunEntry) => {
      const own = Math.min(r.max, r.softMax ?? r.max);
      if (r.type === "long" || !Number.isFinite(longCeilingTotal)) return own;
      // Never below the run's own minimum — a week whose long run is tiny still
      // owes its other sessions a real length; the dominance is then restored by
      // `enforceLongRun` pulling the long run up, or the week is simply small.
      return Math.max(r.min, Math.min(own, entryWork(r, longCeilingTotal)));
    };
    let overflow = 0;
    for (const r of runs) {
      const cap = ceiling(r);
      if (r.miles > cap) {
        overflow += r.miles - cap;
        r.miles = cap;
      }
    }
    if (overflow > 0.01) {
      const byRoom = [...runs].sort((a, b) => (a.type === "long" ? -1 : b.type === "long" ? 1 : 0));
      for (const r of byRoom) {
        if (overflow <= 0.01) break;
        const room = ceiling(r) - r.miles;
        const take = Math.min(room, overflow);
        r.miles += take;
        overflow -= take;
      }
      // What is left has nowhere to go under the soft ceilings. Two outcomes,
      // and picking the wrong one wrecks the program:
      //
      //   - smaller than a real session → GIVE IT BACK, up to each run's hard
      //     session cap, long run first. Manufacturing a 4-mile run to rehouse
      //     0.4 of a mile put the week far over target, and the convergence loop
      //     then cut the long run to its MINIMUM to pay for it: a 12 mi/week
      //     beginner's long run collapsed to 4.6 mi and stayed there for all 16
      //     weeks, because each flattened week lowered the next week's ceiling.
      //     The jump ceiling bounds GROWTH; it yields to the week's arithmetic
      //     rather than deforming the week to hold it.
      //   - big enough to BE a session → emit one. `atLeastOne` makes it a real
      //     45-minute run rather than the 0.3-mile stub this used to produce.
      //
      // ⚠️ REVISED 2026-08-19: what is left now becomes a RECOVERY JOG rather
      // than being forced back onto the long run. A recovery run's documented
      // band is 20–45 minutes, so the displaced miles usually ARE a session —
      // just not an easy run. Only a remainder too small even for that goes
      // back, and then the ceiling yields to the week's arithmetic.
      const longCeiling = runs.find((r) => r.type === "long")?.softMax;
      // ⚠️ Only if the week can actually HOLD another session. The placement
      // loop that runs later gives up silently when every day is at two
      // workouts, so a jog emitted into a full week is a jog that vanishes —
      // and the miles vanish with it. Checked here, before the long run gives
      // them away: 178 weeks quietly lost mileage this way in the first cut.
      const canPlace = leastLoadedUnderCap(days, MAX_SESSIONS_PER_DAY, place) !== -1;
      // ⚠️ SMALL remainders only. A recovery jog is ONE session, so handing it a
      // large overflow builds a 9-mile "jog" that the session cap then shrinks —
      // silently losing up to 6 miles of the week (measured, first cut). Anything
      // big enough for a real easy run keeps going to `buildEasyRuns`, which
      // splits across sessions and respects the cap.
      if (
        overflow > 0.05 &&
        overflow < MIN_STANDALONE_RUN_MI &&
        longCeiling !== undefined &&
        canPlace
      ) {
        const recovery = buildRecoveryRun(overflow, paces, sessionCap);
        const jog = recovery[0];
        // Only if the jog it would build is not much bigger than the miles that
        // need a home — otherwise this is the 45-minute-filler trap again, one
        // size down.
        if (jog && jog.distanceMiles <= overflow + 0.6) {
          added.push(...recovery);
          overflow = 0;
        }
      }
      if (overflow > 0.05 && overflow < MIN_STANDALONE_RUN_MI) {
        for (const r of byRoom) {
          if (overflow <= 0.01) break;
          const room = r.max - r.miles;
          const take = Math.min(room, overflow);
          r.miles += take;
          overflow -= take;
        }
      }
      if (overflow > 0.05)
        added.push(...buildEasyRuns(overflow, paces, runningExp, sessionCap, true));
    }
    levelToLongRun(runs);
  }
}

/**
 * THE LONG RUN IS THE WEEK'S LONGEST RUN — after the miles are actually placed.
 *
 * Floors and ceilings get the ordering right at the start and at the top, and
 * the weighted spread in between quietly undid it: every run grows, so a quality
 * session sitting at the same floor as the long run came out a tenth or two
 * ahead of it. Measured: `interval 3.3` beside `long 3.0`, both from the same
 * 3-mile floor. It reads as a small thing and it is exactly the thing Levi
 * reported.
 *
 * So the excess moves onto the long run, which is where it wanted to go. Two
 * rules keep this from being a trap:
 *
 *   - **Miles are never destroyed.** Anything the long run cannot take under its
 *     own ceiling goes straight back to the runs it came from. A week that lands
 *     under its stated mileage is a bug the athlete can see; an inverted week is
 *     a preference the athlete can live with. Mileage wins.
 *   - **No run drops below its own minimum.** Levelling must not turn a session
 *     into a non-session.
 */
function levelToLongRun(runs: RunEntry[]): void {
  const long = runs.find((r) => r.type === "long");
  if (!long) return;
  const others = runs.filter((r) => r !== long);
  if (others.length === 0) return;
  const roof = Math.min(long.max, long.softMax ?? long.max);
  for (let pass = 0; pass < 4; pass++) {
    const longTotal = entryTotal(long, long.miles);
    let excess = 0;
    const trimmed: RunEntry[] = [];
    for (const r of others) {
      const cap = Math.max(r.min, entryWork(r, longTotal));
      if (r.miles > cap + 0.01) {
        excess += r.miles - cap;
        r.miles = cap;
        trimmed.push(r);
      }
    }
    if (excess <= 0.01) return;
    const take = Math.min(Math.max(0, roof - long.miles), excess);
    long.miles += take;
    excess -= take;
    if (excess > 0.01) {
      // The long run is at its ceiling and the miles still have to live
      // somewhere. Back they go, and the week stays honest about its mileage.
      const share = excess / trimmed.length;
      for (const r of trimmed) r.miles += share;
      return;
    }
  }
}

/**
 * Make the week's long run clearly dominant and progressive (Tasks addition #5).
 * Redistribution only: miles are shifted from the easy runs into the long run,
 * so the week's total mileage is unchanged. The long run is grown toward a
 * week-ramped work-minute target (up to the 90-min cap) and to at least
 * LONG_RUN_DOMINANCE× the longest easy run, limited by how much spare distance
 * the easy runs have above their minimums.
 */
function enforceLongRun(runs: RunEntry[], weekNumber: number, sessionCap: number): void {
  const long = runs.find((r) => r.type === "long");
  if (!long || runs.length < 2) return;
  const others = runs.filter((r) => r !== long);
  if (others.length === 0) return;

  // Week-ramped duration target, expressed in miles at the long-run pace, capped
  // by the per-run 90-min ceiling (long.max already encodes the cap).
  const targetWork = Math.min(
    sessionCap - long.overhead,
    LONG_RUN_BASE_WORK + LONG_RUN_STEP_WORK * Math.max(0, weekNumber - 1),
  );
  const targetMiles = targetWork / long.paceMin;
  const maxEasyMiles = others.reduce((m, r) => Math.max(m, r.miles), 0);

  let want = Math.max(long.miles, targetMiles, LONG_RUN_DOMINANCE * maxEasyMiles);
  // Never past the session cap, and never past the week-to-week jump ceiling.
  want = Math.min(want, long.max, long.softMax ?? long.max);
  let need = want - long.miles;
  if (need <= 0.05) return;

  // Pull spare miles from the easy/quality runs (biggest first), never below min.
  for (const r of [...others].sort((a, b) => b.miles - a.miles)) {
    if (need <= 0.05) break;
    const spare = Math.max(0, r.miles - r.min);
    const take = Math.min(spare, need);
    r.miles -= take;
    long.miles += take;
    need -= take;
  }
}

/**
 * THE LONG RUN IS THE WEEK'S LONGEST RUN, AND IT GROWS (Levi, 2026-08-25).
 *
 * "The interval run workout was much too long relative to the distance from my
 * long run. The long run needs to be the longest distance run of the week and it
 * needs to build up in distance over time throughout the course of the program."
 *
 * He was right, and it was not one session. Across 540 generated weeks, 336
 * (62%) shipped another run that matched or beat the long run — interval 306
 * times, threshold 252, easy 135, the worst by 11.2 miles — and a 30 mi/week
 * athlete's long run went 8.3 → 6.5 miles over sixteen weeks while their weekly
 * mileage ramped UP.
 *
 * Two causes, both structural:
 *
 *  1. **The long run was sized last.** `enforceLongRun` runs before the
 *     convergence loop, which then resizes every run to hit the week's total and
 *     erodes what it just built. Whatever the hybrid legs and the quality runs'
 *     minimums did not take became the long run, and as station work and quality
 *     work grow through a program, that residual shrinks.
 *  2. **Dominance was measured in WORK miles.** An interval session's `miles` is
 *     its reps — 3.1 — while the athlete actually covers 6.4 once the warm-up,
 *     the cool-down and 19 minutes of between-rep jogging are counted. The long
 *     run was being made 1.5x longer than a number nobody sees. This is the
 *     work-vs-total shape that has bitten this repo seven times before.
 *
 * So this pass runs LAST — after convergence and after the residual snap — and it
 * works in TOTAL miles (`sessionMiles`), which is the figure on the athlete's
 * card. It is redistribution: miles move between runs, the week's total does not
 * change, unless every ceiling binds at once (see below).
 */

/** Share of the week's mileage the long run should carry, by phase. */
const LONG_RUN_SHARE: Record<string, number> = {
  base: 0.28,
  build: 0.32,
  peak: 0.35,
  taper: 0.3,
};
const LONG_RUN_SHARE_DEFAULT = 0.3;

/**
 * How short a quality run's warm-up and cool-down may be cut.
 *
 * The last resort in a small week, and floored rather than free: ten minutes of
 * easy running before a set of 1 km reps is the difference between a warm-up and
 * an injury, and the cool-down exists so the session does not end at threshold
 * heart rate. Below these the session stops being safe, and the right answer
 * becomes "this week is too small for an interval session" — a different
 * decision, and not one to make silently here.
 */
const MIN_QUALITY_WARMUP = 10;
const MIN_QUALITY_COOLDOWN = 5;

/** A run must beat every other by this much to be unambiguously the longest. */
const LONG_RUN_MARGIN = 0.2;

/**
 * How much work distance one redistribution step moves.
 *
 * A rep-based run has to move in WHOLE reps — `setRunMiles` snaps it, so the text
 * and the stored distance cannot drift — which means a step SMALLER than one rep
 * moves such a run precisely nowhere. Asking for 0.2 mi off a 1 km interval is a
 * no-op that reads as "this run is already at its floor", and it took the
 * invariant from 3% of weeks violated back up to 39%.
 */
const ANCHOR_STEP_MI = 0.2;
function anchorStep(s: RunSession): number {
  return REP_DISTANCE_MILES[s.runType] ?? ANCHOR_STEP_MI;
}

interface AnchorContext {
  targetMileage: number;
  phase?: string;
  paces: RunPaces;
  exp: ExperienceLevel;
  easyPaceMin: number;
  caps: TrainingCaps;
  /** The trailing-four-week ceiling, when the caller has one. */
  longRunCap?: number;
  /** Where a surplus easy run may legally go. */
  days: ProgramDay[];
  place: FillerPlacement;
}

function allRuns(days: ProgramDay[]): RunSession[] {
  const out: RunSession[] = [];
  for (const d of days) for (const s of d.sessions) if (s.kind === "run") out.push(s);
  return out;
}

/** The most total miles this run may carry, under whichever cap governs it. */
function anchorMaxTotal(s: RunSession, ctx: AnchorContext): number {
  const paceMin = effectivePace(s.runType, ctx.paces) / 60;
  const overhead = runOverhead(s.runType);
  const cap = s.runType === "long" ? ctx.caps.longRun : ctx.caps.session;
  const work = maxMiles(paceMin, overhead, cap, s.runType, ctx.exp);
  const ceiling = work + runOverheadMiles(s.runType, ctx.easyPaceMin);
  // The long run also answers to its trailing-four-week jump ceiling.
  return s.runType === "long" && ctx.longRunCap !== undefined
    ? Math.min(ceiling, ctx.longRunCap)
    : ceiling;
}

/** The least work distance this run may be cut to. */
function anchorMinWork(s: RunSession, ctx: AnchorContext): number {
  const paceMin = effectivePace(s.runType, ctx.paces) / 60;
  return minMiles(s.runType, paceMin, runOverhead(s.runType));
}

/**
 * Make the long run the week's longest run, and grow it toward its share of the
 * week's mileage.
 *
 * Runs AFTER the convergence loop on purpose: everything upstream is free to
 * resize runs to hit the week's total, and this has the last word on WHICH run
 * ends up longest. Re-stamps overhead after every move, because a rep-based run's
 * recovery jog scales with its work time — shrinking an interval by a fifth of a
 * mile frees more than a fifth of a mile of total distance.
 */
function anchorLongRun(days: ProgramDay[], ctx: AnchorContext): void {
  const runs = allRuns(days);
  const long = runs.find((r) => r.runType === "long");
  if (!long || runs.length < 2) return;

  const restamp = () => stampRunOverhead(days, ctx.easyPaceMin, ctx.exp, ctx.caps.session);
  const total = (s: RunSession) => sessionMiles(s);
  const rivals = () => runs.filter((r) => r !== long);
  const longCeiling = anchorMaxTotal(long, ctx);

  // The share is of the week's PRESCRIBED mileage, so a deload week — whose target
  // is already lower — gets a shorter long run without anything here knowing what
  // a deload is.
  const share = (ctx.phase && LONG_RUN_SHARE[ctx.phase]) || LONG_RUN_SHARE_DEFAULT;
  const wanted = Math.min(longCeiling, ctx.targetMileage * share);

  restamp();

  // Every distance change goes through `setRunMiles`: it snaps a quality run to a
  // WHOLE number of reps (so the prescription text and the stored distance cannot
  // drift apart) and clamps to the session cap. Writing `distanceMiles` directly
  // here broke both — a "5 x 1km" text against a stored 2.9 mi, and runs past the
  // 90-minute ceiling.
  const write = (r: RunSession, miles: number) =>
    setRunMiles(
      r,
      miles,
      effectivePace(r.runType, ctx.paces) / 60,
      r.runType === "long" ? ctx.caps.longRun : ctx.caps.session,
      ctx.exp,
    );

  /** Move `step` of WORK distance off `from`; return the total miles freed. */
  const takeFrom = (from: RunSession, step: number): number => {
    const want = from.distanceMiles - step;
    if (want < anchorMinWork(from, ctx) - 0.001) return 0;
    const before = weekMileage({ days });
    write(from, want);
    restamp();
    return round1(before - weekMileage({ days }));
  };

  /** Give `miles` of total distance to the long run, within its ceiling. */
  const giveToLong = (miles: number): number => {
    const room = longCeiling - total(long);
    if (miles <= 0.001 || room <= 0.001) return 0;
    const before = weekMileage({ days });
    write(long, long.distanceMiles + Math.min(miles, room));
    restamp();
    return round1(weekMileage({ days }) - before);
  };

  /**
   * Return miles to the run they were taken from — but only as far as the long
   * run allows (Levi, 2026-09-09: "hours should win… but do not exceed the time
   * cap").
   *
   * A bare hand-back was the other half of the overrun problem. When the long run
   * cannot take what a donor gave up, handing ALL of it back puts the donor
   * exactly where it was — above the long run, which is where it was taken from
   * for. Anything that will not fit under the line is simply not placed: the week
   * reports what it delivers, which is the honest number and the one the calendar
   * agrees with.
   */
  /**
   * Grow `r` by up to `miles`, and NEVER past the long run — checked AFTER the
   * write, because a rep-based run does not land where it is asked to.
   *
   * This is the whole-rep snap trap for the third time in this file. Asking a
   * 1 km interval session for another 0.3 mi does not add 0.3: `setRunMiles`
   * snaps to a whole number of reps, so it adds 0.62 — and the between-rep
   * recovery that comes with it, which is another 0.2 on the total. Every guard
   * that tested `total(r) + miles <= limit` BEFORE writing was therefore testing a
   * number the write would not produce. Measured on a 9.6-mile week: an interval
   * session cleared a 3.8-mile bound and landed at 5.6, against a 4.0-mile long
   * run.
   *
   * So: write, measure, and put it back if it overshot. The miles that will not
   * fit are not placed — hours win, and the week reports what it delivers.
   */
  const growUnderLong = (r: RunSession, miles: number): void => {
    const limit = round1(total(long) - LONG_RUN_MARGIN);
    if (miles <= 0.001 || total(r) >= limit) return;
    const before = r.distanceMiles;
    write(r, before + miles);
    restamp();
    if (total(r) > limit) {
      write(r, before); // the snap overshot — leave it where it was
      restamp();
    }
  };

  /** Return miles a donor gave up, bounded the same way. */
  const handBack = (r: RunSession, miles: number): void => growUnderLong(r, miles);

  // PASS 1 — grow the anchor toward its share, biggest donor first.
  for (let i = 0; i < 40 && total(long) < wanted - 0.05; i++) {
    const donor = rivals()
      .filter((r) => r.distanceMiles - anchorMinWork(r, ctx) > 0.001)
      .sort((a, b) => total(b) - total(a))[0];
    if (!donor) break;
    const freed = takeFrom(donor, anchorStep(donor));
    if (freed <= 0.001) break;
    const given = giveToLong(freed);
    // The long run is at its ceiling and cannot take what was freed — hand it
    // back rather than quietly shrinking the week.
    if (given < freed - 0.001) {
      // Through `handBack`, not a bare assignment: a rep-based run's distance has
      // to stay on a whole-rep boundary (`setRunMiles` snaps it), and the return
      // is bounded by the long run so the donor cannot climb back over the line it
      // was just brought under.
      handBack(donor, freed - given);
      restamp();
      break;
    }
  }

  // PASS 2 — no other run may match or beat it. Where the long run is already at
  // its ceiling the rival is cut and the miles go to whichever run still has room,
  // which is what "shrink the quality session" means in practice (Levi's call).
  //
  // Miles that the long run and the existing easy runs cannot take accumulate
  // here until they are enough to be an easy run of their own. That escape is
  // what a high-volume week actually needs: with the long run held at 90 minutes,
  // a 51 mi week across five runs cannot keep every one of them under 9.2 mi —
  // five times 9.2 is 46. The week does not need a longer run, it needs another
  // one. `sizeRuns` takes the same escape when every run is at its cap.
  let homeless = 0;
  const drainHomeless = () => {
    if (homeless < 0.05) return;
    const extra = buildEasyRuns(homeless, ctx.paces, ctx.exp, ctx.caps.session);
    if (!extra.length) return; // too little to be a session — the true-up settles it
    const slot = leastLoadedUnderCap(ctx.days, 2, ctx.place);
    if (slot === -1) return; // every day is at two workouts
    ctx.days[slot]!.sessions.push(...extra);
    homeless = 0;
    restamp();
  };
  for (let i = 0; i < 60; i++) {
    const over = rivals()
      .filter((r) => total(r) > total(long) - LONG_RUN_MARGIN)
      .sort((a, b) => total(b) - total(a))[0];
    if (!over) break;
    let freed = takeFrom(over, anchorStep(over));
    if (freed <= 0.001) {
      // The offender is at its own floor: its reps cannot come down any further
      // without dropping under the session minimum. Fund the long run from
      // somewhere ELSE instead — an easy run with spare distance does just as
      // well, and giving up here is what left a 6.4 mi interval standing over a
      // 5.2 mi long run.
      const donor = rivals()
        .filter((r) => r !== over && r.distanceMiles - anchorMinWork(r, ctx) > 0.001)
        .sort((a, b) => total(b) - total(a))[0];
      if (donor) {
        const moved = takeFrom(donor, anchorStep(donor));
        if (moved > 0.001) {
          if (giveToLong(moved) < moved - 0.001) {
            handBack(donor, moved); // bounded by the long run, for the same reason
            restamp();
            break; // long run is at its ceiling too — nothing left to try
          }
          continue;
        }
      }
      // Every run is at its work floor. The only distance left in the week is the
      // offender's OVERHEAD — and in a small week that is where it was hiding all
      // along: a 6.4 mi interval session whose reps are 2.5 mi is carrying 25
      // minutes of warm-up and cool-down plus a recovery jog. An 11 mi week
      // should not spend a quarter of itself warming up.
      const freedOverhead = trimQualityOverhead(over, ctx);
      if (freedOverhead <= 0.001) break; // already at the safety floors
      if (giveToLong(freedOverhead) <= 0.001) break;
      continue;
    }
    let placed = giveToLong(freed);
    if (placed < freed - 0.001) {
      // Long run full: the freed miles go on the EASY runs (Levi, 2026-09-09),
      // spread across them so none is pushed over the line in turn. Routing this
      // through the same spreader as the true-up matters — re-homing the spare on
      // "the roomiest run" was itself putting easy runs above the long run, which
      // is the bug this rule was meant to end.
      const spare = round1(freed - placed);
      const onto = spreadOntoEasyRuns(
        spare,
        rivals().filter((r) => r !== over),
        total(long),
        write,
        restamp,
        total,
      );
      placed = round1(placed + onto);
      // What no existing run could take waits for a run of its own.
      homeless = round1(homeless + (spare - onto));
      drainHomeless();
    }
  }
  drainHomeless();

  // TRUE UP. This pass MOVES miles; it must not create or destroy them, and the
  // rep snapping inside `setRunMiles` means a move rarely lands exact.
  //
  // **LEFTOVER MILES GO ON THE EASY RUNS** (Levi, 2026-09-09), and that one rule
  // settles what had been the open question here. The conflict was: with the long
  // run at its 90-minute ceiling and every quality run at its floor, a remainder
  // had nowhere to go, so either a quality run stayed longer than the long run or
  // the week silently delivered less than it advertised. Both were wrong. The easy
  // runs are the right home for it — they are the week's aerobic ballast, they
  // take any distance exactly rather than in whole reps, and growing one is the
  // change with the least training consequence of any available.
  restamp();
  // Order of preference for a run that must ABSORB miles:
  //   1. easy runs — Levi's rule, and the least consequential place to put volume;
  //   2. any other continuous run — a rep-based run can only move in WHOLE reps
  //      (0.62 mi for a 1 km interval), so it cannot absorb a 0.4 mi remainder at
  //      all, and asking it to stalls the loop and ships the week short;
  //   3. most headroom first, within each group.
  const absorbRank = (r: RunSession) =>
    r.runType === "easy" ? 0 : REP_DISTANCE_MILES[r.runType] === undefined ? 1 : 2;
  const continuousFirst = (a: RunSession, b: RunSession) => absorbRank(a) - absorbRank(b);
  for (let i = 0; i < 12; i++) {
    const drift = round1(ctx.targetMileage - weekMileage({ days }));
    if (Math.abs(drift) < 0.05) break;
    const beforeStep = weekMileage({ days });
    if (drift > 0) {
      // Try each home in Levi's order and stop at the first that MOVES something.
      // Checking "is there room" and then discovering `setRunMiles` clamps it
      // anyway is what let a week land short: the guard below saw no progress and
      // broke out before the later options had a turn.
      const byRoom = rivals().sort(
        (a, b) =>
          continuousFirst(a, b) ||
          anchorMaxTotal(b, ctx) - total(b) - (anchorMaxTotal(a, ctx) - total(a)),
      );
      const grew = () => weekMileage({ days }) - beforeStep > 0.01;

      // 1. The long run itself, the run this pass exists to make biggest.
      if (longCeiling - total(long) > 0.05) write(long, long.distanceMiles + drift);

      // 2. The easy runs (Levi, 2026-09-09) — spread so none overtakes the long run.
      if (!grew()) spreadOntoEasyRuns(drift, rivals(), total(long), write, restamp, total);

      // 3. Any other run that will not overtake it — verified AFTER the write,
      //    because a rep-based run lands on a whole rep rather than where it was
      //    asked to. See `growUnderLong`.
      if (!grew()) {
        const taker = byRoom.find((r) => total(r) < total(long) - LONG_RUN_MARGIN);
        if (taker) growUnderLong(taker, drift);
      }

      // 4. An easy run of its own, where the remainder is enough to be one.
      if (!grew()) {
        const extra = buildEasyRuns(drift, ctx.paces, ctx.exp, ctx.caps.session);
        const slot = extra.length ? leastLoadedUnderCap(ctx.days, 2, ctx.place) : -1;
        if (slot !== -1) ctx.days[slot]!.sessions.push(...extra);
      }

      // 5. THERE IS NO FIFTH. HOURS WIN (Levi, 2026-09-09).
      //
      // His words, settling this: *"Hours should win; the extra miles going onto
      // easy runs means that if a long run and other quality run workouts are
      // already capped, extra miles should go to the easy runs; but do not exceed
      // the time cap."*
      //
      // There used to be a last resort here that handed the remainder to the
      // roomiest run **even though that left it longer than the long run**, on the
      // reasoning that losing miles is worse than an overrun. That was the right
      // call against the numbers it was measured on. It stopped being the right
      // call once `recPerMi` fixed the reconciler's own accounting: with the sizing
      // correct, this branch was no longer rescuing weeks that could not be
      // placed — it was creating overruns out of its own redistribution churn.
      // Measured, it accounted for the entire regression from 4 to 17 weeks
      // (0.5% → 2%) with a worst case of 1.06× → 1.74×.
      //
      // So a remainder that will not fit inside the time caps, under the long run,
      // simply is not placed. That is not a lost mile — `reconcileWeekVolume`
      // returns what the week DELIVERS and `assembleProgram` adopts it as the
      // week's target, so the prescription and the calendar still agree. The
      // athlete reads a smaller honest number instead of a bigger one their
      // calendar contradicts.
      restamp();
    } else {
      const donor = [long, ...rivals()]
        .filter((r) => r.distanceMiles - anchorMinWork(r, ctx) > 0.001)
        .sort((a, b) => continuousFirst(a, b) || total(b) - total(a))[0];
      if (!donor) break;
      write(donor, donor.distanceMiles + drift);
    }
    restamp();
    // No candidate could absorb the remainder — stop rather than spin.
    if (Math.abs(weekMileage({ days }) - beforeStep) < 0.01) break;
  }
  restamp();
}

/**
 * Cut a quality run's warm-up and cool-down toward the safety floors, returning
 * the total miles that frees. Proportional, so a 15/10 session keeps its 3:2
 * shape rather than losing the whole cool-down first.
 */
function trimQualityOverhead(s: RunSession, ctx: AnchorContext): number {
  if (s.runType === "long" || s.runType === "easy") return 0;
  const [wu, cd] = runOverheadFor(s);
  if (wu <= MIN_QUALITY_WARMUP && cd <= MIN_QUALITY_COOLDOWN) return 0;
  const before = sessionMiles(s);
  s.warmupMin = Math.max(MIN_QUALITY_WARMUP, wu - 5);
  s.cooldownMin = Math.max(MIN_QUALITY_COOLDOWN, cd - 5);
  s.overheadMiles = runOverheadMilesFor(s, ctx.easyPaceMin);
  return round1(before - sessionMiles(s));
}

/**
 * Spread `miles` across the week's EASY runs, giving each only as much as keeps
 * it under the long run. Returns how much was actually placed.
 *
 * Levi's rule (2026-09-09) for where leftover miles go. Easy runs are the week's
 * aerobic ballast: growing one has the least training consequence of any run in
 * the week, and unlike a quality run it takes any distance exactly instead of in
 * whole reps.
 */
function spreadOntoEasyRuns(
  miles: number,
  runs: RunSession[],
  longTotal: number,
  write: (r: RunSession, miles: number) => void,
  restamp: () => void,
  total: (r: RunSession) => number,
): number {
  let left = miles;
  let placed = 0;
  // Smallest first, so the week's easy running stays even rather than one run
  // swallowing the whole remainder.
  const easy = runs.filter((r) => r.runType === "easy").sort((a, b) => total(a) - total(b));
  for (const r of easy) {
    if (left < 0.05) break;
    const room = round1(longTotal - LONG_RUN_MARGIN - total(r));
    const take = Math.min(left, room);
    if (take < 0.05) continue;
    const before = total(r);
    write(r, r.distanceMiles + take);
    restamp();
    const got = round1(total(r) - before);
    placed = round1(placed + got);
    left = round1(left - got);
  }
  return placed;
}

function writeRun(r: RunEntry, paces: RunPaces, sessionCap: number, exp: ExperienceLevel): void {
  const miles = Math.max(MIN_RUN_MILES, round1(r.miles));
  let work = Math.round(miles * r.paceMin);
  // Respect the 45–90 min total band even after rounding.
  work = Math.min(workBudget(sessionCap, r.overhead, r.type, exp), Math.max(1, work));
  r.ref.distanceMiles = miles;
  r.ref.durationMin = work;
  r.ref.paceMinMile = paceLabel(r.type, paces);
  // A run shorter than `MIN_CARDIO_TOTAL` buys the rest of the session in Zone
  // 1–2 cross-training rather than in miles it should not be running (Levi,
  // 2026-09-08). Cleared, not left stale, when the run is long enough on its own.
}

/**
 * Top every run that is under `MIN_CARDIO_TOTAL` up to it with Zone 1–2
 * cross-training inside the session (Levi, 2026-09-08).
 *
 * Runs LAST, after the convergence loop, and that placement is the whole point:
 * this was originally stamped in `writeRun`, but `setRunMiles` rewrites run
 * durations afterwards to converge the week's mileage, and the stamp went stale
 * behind it — a run shortened from 45 minutes to 32 kept the "no top-up needed"
 * answer computed when it was still 45, and shipped as a 32-minute session.
 * Nothing changes a run's length after this point, so nothing can invalidate it.
 *
 * Rounded UP to `CROSS_CARDIO_STEP`, and never skipped for being small: the 45
 * minutes is a floor the session has to clear, so a 3-minute shortfall becomes a
 * 5-minute spin and a 47-minute session, not a 42-minute one. Prescribing "3
 * minutes on the bike" would be worse than either.
 */
function stampCrossCardio(days: ProgramDay[]): void {
  for (const d of days)
    for (const s of d.sessions) {
      if (s.kind !== "run") continue;
      // A RECOVERY JOG IS EXEMPT. Its documented band is 20–45 minutes and being
      // short is the entire prescription — topping one up to the 45-minute floor
      // turns it into the easy run it exists not to be. Zone 1 is what marks it;
      // every other run is Zone 2 or harder.
      if (s.goalZone <= 1) continue;
      const t = sessionTiming(s);
      const ran = t.total - (s.crossCardioMin ?? 0);
      const short = MIN_CARDIO_TOTAL - ran;
      if (short > 0) s.crossCardioMin = Math.ceil(short / CROSS_CARDIO_STEP) * CROSS_CARDIO_STEP;
      else delete s.crossCardioMin;
    }
}

/** Build easy runs to carry `miles`, each within the easy min/max band. */
/**
 * `atLeastOne` — emit a run even when the leftover is too small to be one.
 *
 * Only the "this week has no runs at all" caller sets it. For OVERFLOW, a
 * leftover below a real session's minimum must NOT become a session: it used to
 * floor at `MIN_RUN_MILES` (0.3) and put "Easy run — 3 min — 0.3 miles" on the
 * calendar. The convergence loop absorbs those miles into the runs that already
 * exist instead. This mirrors the Zone 1–2 rule that a sub-15-minute gap is
 * DROPPED rather than shipped as a block.
 */
function buildEasyRuns(
  miles: number,
  paces: RunPaces,
  runningExp: ExperienceLevel,
  sessionCap: number,
  atLeastOne = false,
): RunSession[] {
  const paceMin = effectivePace("easy", paces) / 60;
  const overhead = runOverhead("easy");
  const max = maxMiles(paceMin, overhead, sessionCap, "easy", runningExp);
  const min = minMiles("easy", paceMin, overhead);
  if (miles < min) {
    if (!atLeastOne) return [];
    miles = min; // a week that runs at all runs a REAL session
  }
  // Never split into slices that would each fall under the minimum.
  const n = Math.min(Math.max(1, Math.ceil(miles / max)), Math.max(1, Math.floor(miles / min)));
  const out: RunSession[] = [];
  for (let i = 0; i < n; i++) {
    const d = Math.max(min, round1(miles / n));
    const work = Math.min(sessionCap - overhead, Math.max(1, Math.round(d * paceMin)));
    out.push({
      kind: "run",
      runType: "easy",
      distanceMiles: d,
      durationMin: work,
      paceMinMile: formatPace(paces.easy),
      goalZone: 2,
      description: runDescriptionEasy(runningExp),
    });
  }
  return out;
}

/**
 * A short RECOVERY jog, for miles the long-run ceiling displaced.
 *
 * Deliberately not `buildEasyRuns` with a smaller floor. A 25-minute session
 * prescribed as an "easy run" mislabels it — easy runs are 45–75 minutes in
 * every coaching source, and the athlete reading "easy run, 25 min" is being
 * told to do a session type that does not exist. Prescribed as a RECOVERY jog it
 * is a normal, well-documented session sitting mid-band (20–45 min).
 *
 * `runType` stays `easy`: the schema's enum has no `recovery`, and adding one
 * reaches the AI prompt, the labels, the zone tables and every stored program.
 * The pace and the description carry the distinction instead — and the pace is
 * the part that matters physiologically, since a recovery run is defined by
 * being slower than easy, not by being shorter.
 */
function buildRecoveryRun(miles: number, paces: RunPaces, sessionCap: number): RunSession[] {
  const paceMin = effectivePace("easy", paces) / 60;
  const overhead = runOverhead("easy");
  const floorMiles = Math.max(MIN_RECOVERY_TOTAL - overhead, 1) / paceMin;
  // Bounded at both ends: never under the recovery floor, never over the session
  // cap — an unclamped distance here ships a run the reconciler has to shrink.
  const capMiles = maxMiles(paceMin, overhead, sessionCap, "easy", "intermediate");
  const d = round1(Math.min(capMiles, Math.max(floorMiles, miles)));
  const work = Math.min(sessionCap - overhead, Math.max(1, Math.round(d * paceMin)));
  return [
    {
      kind: "run",
      runType: "easy",
      distanceMiles: d,
      durationMin: work,
      paceMinMile: formatPace(paces.easy),
      goalZone: 1,
      description:
        "Recovery jog — easier and shorter than an easy run, at a pace you could hold a " +
        "conversation through without thinking about it. This is here to keep the week's " +
        "volume on your feet without adding to the long run.",
    },
  ];
}

// Local easy description to avoid a circular import with run-descriptions.
function runDescriptionEasy(_exp: ExperienceLevel): string {
  return "Easy, conversational-pace aerobic running in Zone 1–2. Keep it relaxed enough to talk in full sentences the whole way.";
}

/** Stamp each run's warmup/cooldown + between-rep recovery distance from its fixed
 *  overhead minutes and recovery minutes at easy pace. Both are miles on the feet,
 *  so — now that the weekly target is a TOTAL — they count toward it. */
/**
 * Stamp a hybrid session's warm-up/cooldown jog — the distance AND the two lines
 * that tell the athlete to run it (Levi, 2026-08-06).
 *
 * Fixed per session (10 + 5 minutes at easy pace), so unlike `stampRunOverhead`
 * this does not need re-running as distances converge — it is applied once,
 * before the run budget is computed.
 */
function stampHybridOverhead(days: ProgramDay[], paces: RunPaces): void {
  const easyPaceMin = paces.easy / 60;
  for (const d of days) {
    for (const s of d.sessions) {
      if (s.kind !== "hybrid") continue;
      s.overheadMiles = hybridOverheadMiles(easyPaceMin);
      s.warmup = hybridWarmupLine(paces);
      s.cooldown = hybridCooldownLine(paces);
    }
  }
}

function stampRunOverhead(
  days: ProgramDay[],
  easyPaceMin: number,
  exp: ExperienceLevel,
  sessionCap = Number.POSITIVE_INFINITY,
): void {
  for (const d of days) {
    for (const s of d.sessions) {
      if (s.kind !== "run") continue;
      s.overheadMiles = runOverheadMilesFor(s, easyPaceMin);
      // Recovery follows the run's ACTUAL rep count (derived from the distance it
      // was resized to), not the experience default — so the jog the athlete is
      // told to run is the jog counted in the week's mileage.
      const reps = repsForWorkMiles(s.runType, s.distanceMiles, exp);
      let rec = reps === null ? 0 : recoveryMinutesForReps(s.runType, reps, s.durationMin);
      // `workBudget` reserves room for recovery using the EXPERIENCE-default rep
      // count, but recovery is now derived from the run's ACTUAL reps — more reps
      // means a higher fraction (N-1 gaps over N), so a resized run could end up a
      // couple of minutes past its session cap. Keep the whole session legal.
      const room = sessionCap - runOverhead(s.runType) - s.durationMin;
      if (Number.isFinite(room)) rec = Math.max(0, Math.min(rec, Math.floor(room)));
      if (rec > 0) {
        s.recoveryMin = rec;
        s.recoveryMiles = round1(rec / easyPaceMin);
      } else {
        delete s.recoveryMin;
        delete s.recoveryMiles;
      }
    }
  }
}

/** Resize a run to `miles`, clamped to its min floor and the session cap, and
 *  rewrite its work duration to match (pace label is fixed per type). */
function setRunMiles(
  s: RunSession,
  miles: number,
  paceMin: number,
  sessionCap: number,
  exp: ExperienceLevel,
): void {
  // The FULL time overhead — the biked half of a quality warm-up costs the
  // session clock even though it costs the week no distance. Budgeting against
  // the jogged minutes alone shipped every quality run its cross minutes over the
  // cap (a 126-minute threshold run under a 120-minute ceiling).
  const maxWorkMin = workBudget(sessionCap, runTimeOverheadFor(s), s.runType, exp);
  const maxMi = maxWorkMin / paceMin;
  let work = Math.max(MIN_RUN_MILES, Math.min(round1(miles), round1(maxMi)));

  // A quality run is a WHOLE number of reps — 1 km intervals, 1-mile threshold
  // reps — and its prescription text is written from that rep count. Leaving the
  // distance off a rep boundary is what let the text say "3 x 1 mile" while the
  // stored distance (and therefore the headline and the weekly total) said 1.8.
  // Snap here, at the single place run distances are written, so text and number
  // can never drift apart again. The leftover fraction is picked up by the
  // residual pass, which lands it on the long run — not rep-based, so exact.
  const repMiles = REP_DISTANCE_MILES[s.runType];
  if (repMiles !== undefined) {
    let reps = Math.max(1, Math.round(work / repMiles));
    const repsUnderCap = Math.floor(round1(maxMi) / repMiles);
    if (repsUnderCap >= 1) reps = Math.min(reps, repsUnderCap);
    work = round1(reps * repMiles);
  }

  s.distanceMiles = work;
  s.durationMin = Math.min(maxWorkMin, Math.max(1, Math.round(s.distanceMiles * paceMin)));
}

/**
 * Nudge the week's TOTAL on-feet mileage toward the target by `diff` miles.
 * Shrink (diff < 0) proportionally to each run's headroom above its minimum — so
 * the week stays balanced and the long run keeps its dominance — or grow (diff > 0)
 * the longest run toward the session cap. Best-effort: a week already at its run
 * minimums (or the cap) simply can't move further.
 */
function adjustRunMilesToTotal(
  days: ProgramDay[],
  diff: number,
  paces: RunPaces,
  exp: ExperienceLevel,
  sessionCap: number,
  longRunCap?: number,
  /** The LONG run's own minute ceiling — 90 for the station sports (Levi,
   *  2026-08-23). Defaults to the session cap, which is the legacy behaviour. */
  longRunSessionCap = sessionCap,
  /** The week's TOTAL mileage target — the base for a quality run's share cap
   *  while growth is being spread. 0 = unknown, and the share does not apply. */
  weekTarget = 0,
): void {
  const capFor = (s: RunSession) => (s.runType === "long" ? longRunSessionCap : sessionCap);
  const runRefs: RunSession[] = [];
  for (const d of days) for (const s of d.sessions) if (s.kind === "run") runRefs.push(s);
  if (runRefs.length === 0) return;

  if (diff < 0) {
    const cut = -diff;
    const entries = runRefs.map((s) => {
      const paceMin = effectivePace(s.runType, paces) / 60;
      const min = minMiles(s.runType, paceMin, runOverhead(s.runType));
      return { s, paceMin, min, head: Math.max(0, s.distanceMiles - min) };
    });
    // THE LONG RUN SHRINKS LAST (Levi, 2026-09-08). Cutting proportionally to
    // headroom sounds even-handed and is not: the long run is the run with the
    // most room above its minimum, so a proportional cut takes the most from the
    // session that is supposed to be the week's longest. Traced on an 18 mi week —
    // sizing produced long 6.7 / interval 2.7 and this loop handed back a 2.5 mile
    // overshoot mostly out of the long run, inverting the two.
    const others = entries.filter((e) => e.s.runType !== "long");
    const otherHead = others.reduce((a, e) => a + e.head, 0);
    let left = cut;
    if (otherHead > 0.05) {
      const factor = Math.min(1, left / otherHead);
      for (const e of others) {
        setRunMiles(e.s, e.s.distanceMiles - e.head * factor, e.paceMin, capFor(e.s), exp);
      }
      left -= otherHead * factor;
    }
    // Only what the rest of the week could not give comes off the long run.
    const long = entries.find((e) => e.s.runType === "long");
    if (left > 0.05 && long && long.head > 0.05) {
      setRunMiles(
        long.s,
        long.s.distanceMiles - Math.min(left, long.head),
        long.paceMin,
        capFor(long.s),
        exp,
      );
    }
  } else {
    // ADDING MILES GOES TO EVERY RUN THAT HAS ROOM, not to "the longest run".
    //
    // It used to hand the whole difference to `growthAnchor` — the longest run
    // still under its JUMP ceiling. In a big week that is the long run, and a
    // long run sitting on its 90-minute cap has no room at all: it was picked
    // every pass of the convergence loop, absorbed nothing, and the week simply
    // came up short while seven other runs had five miles of headroom each.
    // Measured: an h5_10 athlete on a 40.1-mile week delivered 37.0, with every
    // other run parked on its 3-mile floor.
    //
    // It is also the wrong shape for the doctrine. "The longest run takes the
    // remainder" is growth by session LENGTH, which is the half of volume that
    // carries injury risk. Spreading it is growth by session SIZE across the
    // week, which is the half that does not — and the ceilings below keep it
    // honest: no run passes the long run's total, no quality run passes its
    // share of the week, nobody passes their own session cap.
    let left = diff;
    for (let pass = 0; pass < 4 && left > 0.05; pass++) {
      const longRef = runRefs.find((r) => r.runType === "long");
      const longTotal = longRef ? runTotalMiles(longRef) : Number.POSITIVE_INFINITY;
      const room = new Map<RunSession, number>();
      let total = 0;
      for (const r of runRefs) {
        const paceMin = effectivePace(r.runType, paces) / 60;
        const overhead = runOverhead(r.runType);
        let capMi = workBudget(capFor(r), overhead, r.runType, exp) / paceMin;
        if (r.runType === "long") {
          if (longRunCap !== undefined)
            capMi = Math.min(capMi, entryWorkFor(r, longRunCap, paces, exp));
        } else {
          // Never past the long run — the week's longest run stays the long run.
          capMi = Math.min(capMi, entryWorkFor(r, longTotal, paces, exp));
          if (weekTarget > 0 && SHARE_CAPPED_TYPES.has(r.runType))
            capMi = Math.min(
              capMi,
              entryWorkFor(r, weekTarget * MAX_QUALITY_RUN_SHARE, paces, exp),
            );
        }
        const have = Math.max(0, capMi - r.distanceMiles);
        if (have > 0.05) {
          room.set(r, have);
          total += have;
        }
      }
      if (total < 0.05) return;
      const factor = Math.min(1, left / total);
      let placed = 0;
      for (const [r, have] of room) {
        const before = r.distanceMiles;
        const paceMin = effectivePace(r.runType, paces) / 60;
        setRunMiles(r, before + have * factor, paceMin, capFor(r), exp);
        placed += r.distanceMiles - before;
      }
      if (placed < 0.05) break; // rep snapping absorbed it all — spreading is done
      left -= placed;
    }

    // THE LAST TENTH GOES ON A CONTINUOUS RUN. A rep-based run's distance is
    // snapped to whole reps (`setRunMiles`), so asking an interval session for
    // another 0.1 of a mile either moves it a whole kilometre or moves it not at
    // all — and "not at all" left the week a tenth short of a target it could
    // otherwise hit exactly. An easy or long run has no such granularity.
    if (left > 0.05) {
      const longRef = runRefs.find((r) => r.runType === "long");
      const longTotal = longRef ? runTotalMiles(longRef) : Number.POSITIVE_INFINITY;
      const continuous = runRefs
        .filter((r) => REP_DISTANCE_MILES[r.runType] === undefined)
        .sort((a, b) => b.distanceMiles - a.distanceMiles);
      for (const r of continuous) {
        if (left <= 0.05) break;
        const paceMin = effectivePace(r.runType, paces) / 60;
        let capMi = workBudget(capFor(r), runOverhead(r.runType), r.runType, exp) / paceMin;
        if (r.runType === "long") {
          if (longRunCap !== undefined)
            capMi = Math.min(capMi, entryWorkFor(r, longRunCap, paces, exp));
        } else {
          capMi = Math.min(capMi, entryWorkFor(r, longTotal, paces, exp));
        }
        const before = r.distanceMiles;
        setRunMiles(r, Math.min(capMi, before + left), paceMin, capFor(r), exp);
        left -= r.distanceMiles - before;
      }
    }
  }
}

/** WORK miles that make run `s` `total` miles long, recovery and overhead included. */
function entryWorkFor(s: RunSession, total: number, paces: RunPaces, exp: ExperienceLevel): number {
  const paceMin = effectivePace(s.runType, paces) / 60;
  const easyPaceMin = effectivePace("easy", paces) / 60;
  const overheadMi = runOverheadMiles(s.runType, easyPaceMin);
  const recPerMi = (recoveryFactor(s.runType, exp) * paceMin) / easyPaceMin;
  return Math.max(0, (total - overheadMi) / (1 + recPerMi));
}
