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
  runOverheadMiles,
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
  min: number; // min miles
  max: number; // max miles
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
): void {
  if (!paces) return; // no 5K → can't apply formula paces
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
    return;
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
      const overhead = runOverhead(s.runType);
      runs.push({
        day: d,
        ref: s,
        type: s.runType,
        paceMin,
        overhead,
        min: minMiles(s.runType, paceMin, overhead),
        max: maxMiles(paceMin, overhead, caps.session, s.runType, runningExp),
        miles: 0,
      });
    }
  }
  const RM = Math.max(0, round1(targetMileage - hybridMi)); // running miles to place (work)

  const added: Session[] = [];

  if (runs.length === 0) {
    if (RM > 0) added.push(...buildEasyRuns(RM, paces, runningExp, caps.session));
  } else {
    sizeRuns(runs, RM, days, paces, runningExp, added, caps.session);
    enforceLongRun(runs, weekNumber, caps.session);
    for (const r of runs) writeRun(r, paces, caps.session, runningExp);
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
    adjustRunMilesToTotal(days, diff, paces, runningExp, caps.session);
  }
  stampRunOverhead(days, easyPaceMin, runningExp, caps.session);
  // A proportional shrink can leave a sub-tenth residual (a 0.1 remainder spread
  // across many runs rounds away on each), so snap it onto the longest run — its
  // fixed overhead and (for the long run) zero recovery make that exact.
  const residual = round1(targetMileage - weekMileage({ days }));
  if (Math.abs(residual) >= 0.05) {
    const snapRefs: RunSession[] = [];
    for (const d of days) for (const s of d.sessions) if (s.kind === "run") snapRefs.push(s);
    if (snapRefs.length > 0) {
      const anchor = snapRefs.reduce((a, b) => (b.distanceMiles > a.distanceMiles ? b : a));
      setRunMiles(
        anchor,
        anchor.distanceMiles + residual,
        effectivePace(anchor.runType, paces) / 60,
        caps.session,
        runningExp,
      );
      stampRunOverhead(days, easyPaceMin, runningExp, caps.session);
    }
  }

  // Fill the remaining cardio time with a non-running Zone 1–2 block(s).
  let runningCardio = 0;
  for (const d of days)
    for (const s of d.sessions) {
      if (s.kind === "run" || s.kind === "hybrid") runningCardio += sessionTiming(s).total;
    }
  const gap = Math.round(cardioTarget) - runningCardio;
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

function minMiles(type: RunType, paceMin: number, overhead: number): number {
  const base = Math.max(MIN_CARDIO_TOTAL - overhead, 1) / paceMin;
  if (type === "easy" || type === "long") return Math.max(EASY_LONG_MIN_MI, base);
  return base;
}

/**
 * Longest this run may be, in miles, under the athlete's session cap.
 *
 * A rep-based run adds between-rep recovery ON TOP of the rep time, so the cap has
 * to be shared between them: sizing purely on rep time let a "90 minute" interval
 * session actually run to 105.
 */
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

/** Size the run distances to sum to RM, honoring min/max, dropping easy runs
 *  into the long run when the week is too small to fit every minimum. */
function sizeRuns(
  runs: RunEntry[],
  RM: number,
  _days: ProgramDay[],
  paces: RunPaces,
  runningExp: ExperienceLevel,
  added: Session[],
  sessionCap: number,
): void {
  // Consolidate: while the minimums don't fit, drop the most-droppable run
  // (never the long run) and remove it from its day.
  while (runs.length > 1 && RM < runs.reduce((a, r) => a + r.min, 0)) {
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

  const sumMin = runs.reduce((a, r) => a + r.min, 0);
  if (RM <= sumMin) {
    // Even minimums overshoot (tiny week). Scale everything down proportionally
    // to the minimums so mileage stays exact; long run keeps the remainder.
    const scale = sumMin > 0 ? RM / sumMin : 0;
    for (const r of runs) r.miles = Math.max(MIN_RUN_MILES, r.min * scale);
  } else {
    let remainder = RM - sumMin;
    const wsum = runs.reduce((a, r) => a + TYPE_WEIGHT[r.type], 0) || runs.length;
    for (const r of runs) r.miles = r.min + (remainder * TYPE_WEIGHT[r.type]) / wsum;
    // Clamp to max, pool overflow, redistribute (long run first), else add easy runs.
    let overflow = 0;
    for (const r of runs) {
      if (r.miles > r.max) {
        overflow += r.miles - r.max;
        r.miles = r.max;
      }
    }
    if (overflow > 0.01) {
      const byRoom = [...runs].sort((a, b) => (a.type === "long" ? -1 : b.type === "long" ? 1 : 0));
      for (const r of byRoom) {
        if (overflow <= 0.01) break;
        const room = r.max - r.miles;
        const take = Math.min(room, overflow);
        r.miles += take;
        overflow -= take;
      }
      if (overflow > 0.05) added.push(...buildEasyRuns(overflow, paces, runningExp, sessionCap));
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
  want = Math.min(want, long.max); // never exceed the 90-min cap
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

function writeRun(r: RunEntry, paces: RunPaces, sessionCap: number, exp: ExperienceLevel): void {
  const miles = Math.max(MIN_RUN_MILES, round1(r.miles));
  let work = Math.round(miles * r.paceMin);
  // Respect the 45–90 min total band even after rounding.
  work = Math.min(workBudget(sessionCap, r.overhead, r.type, exp), Math.max(1, work));
  r.ref.distanceMiles = miles;
  r.ref.durationMin = work;
  r.ref.paceMinMile = paceLabel(r.type, paces);
}

/** Build easy runs to carry `miles`, each within the easy min/max band. */
function buildEasyRuns(
  miles: number,
  paces: RunPaces,
  runningExp: ExperienceLevel,
  sessionCap: number,
): RunSession[] {
  const paceMin = effectivePace("easy", paces) / 60;
  const overhead = runOverhead("easy");
  const max = maxMiles(paceMin, overhead, sessionCap, "easy", runningExp);
  const n = Math.max(1, Math.ceil(miles / max));
  const out: RunSession[] = [];
  for (let i = 0; i < n; i++) {
    const d = Math.max(MIN_RUN_MILES, round1(miles / n));
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
      s.overheadMiles = runOverheadMiles(s.runType, easyPaceMin);
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
  const overhead = runOverhead(s.runType);
  const maxWorkMin = workBudget(sessionCap, overhead, s.runType, exp);
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
): void {
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
    const totalHead = entries.reduce((a, e) => a + e.head, 0);
    if (totalHead < 0.05) return; // every run already at its floor
    const factor = Math.min(1, cut / totalHead);
    for (const e of entries) {
      setRunMiles(e.s, e.s.distanceMiles - e.head * factor, e.paceMin, sessionCap, exp);
    }
  } else {
    const anchor = runRefs.reduce((a, b) => (b.distanceMiles > a.distanceMiles ? b : a));
    const paceMin = effectivePace(anchor.runType, paces) / 60;
    setRunMiles(anchor, anchor.distanceMiles + diff, paceMin, sessionCap, exp);
  }
}
