/**
 * Single source of truth for how a session's cardio TIME and running MILEAGE
 * are measured. Both the display layer (components/program/format.ts) and the
 * deterministic volume reconciler (lib/generation/reconcile.ts) import from
 * here, so "what the week sums to" is computed the same way everywhere.
 *
 * Weightlifting is excluded from cardio time (spec). Running mileage counts
 * every run's distance plus the runs inside hybrid sessions.
 */

import type { Session } from "@/lib/schemas";
import { clamp, METERS_PER_MILE } from "@/lib/engine/math";
export { METERS_PER_MILE };

type RunSession = Extract<Session, { kind: "run" }>;
type HybridSession = Extract<Session, { kind: "hybrid" }>;

/** Warmup/cooldown minutes by run type (quality runs need a longer warmup). */
export const RUN_WARMUP_COOLDOWN: Record<RunSession["runType"], [number, number]> = {
  easy: [5, 5],
  long: [5, 5],
  fartlek: [8, 5],
  progression: [10, 5],
  tempo: [12, 8],
  threshold: [12, 8],
  interval: [15, 10],
  hybrid_run: [8, 5],
};

/**
 * Hybrid work-time bounds.
 *
 * The ceiling was 60, which was the whole spec when a hybrid was 4–6 AI-chosen
 * elements. A race-structure session is 8 runs + 8 stations, and 8 km at race
 * pace alone is 40–56 minutes depending on the athlete — so 60 truncated the
 * estimate for everyone and hid the real cost of the session. Raised to 110
 * (Levi, 2026-08-12); the athlete's own `caps.session` is the real constraint
 * and `fitHybridToCap` drops stations before this ever binds.
 */
export const HYBRID_MIN_WORK = 25;
export const HYBRID_MAX_WORK = 110;

/**
 * Warmup / cooldown MINUTES on a hybrid session (Levi, 2026-08-06).
 *
 * These numbers are not new — `sessionTiming` has always budgeted 10 + 5 around
 * the hybrid work. What was missing is that nobody told the athlete what to DO
 * with them, and the jogging in them counted toward no mileage at all. Both are
 * now derived from these two constants, so the prescription, the session length
 * and the weekly mileage can never disagree.
 */
export const HYBRID_WARMUP = 10;
export const HYBRID_COOLDOWN = 5;

/**
 * Fixed total length of a strength session (Tasks addition #4: all strength
 * workouts are 60 minutes). Split into a 10-min warmup, 45-min working block,
 * and 5-min cooldown so the displayed estimate and the weekly time tracker both
 * read a flat 60 minutes regardless of set count.
 */
export const STRENGTH_SESSION_MIN = 60;
const STRENGTH_WARMUP = 10;
const STRENGTH_COOLDOWN = 5;

const DEFAULT_HYBRID_RUN_MILES = 1000 / METERS_PER_MILE; // 1000 m per hybrid run

/** Parse a distance ("1000m", "1 km", "0.6 mi") to miles, or null. */
export function parseDistanceMiles(text: string): number | null {
  const t = text.toLowerCase();
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:miles|mile|mi)\b/);
  if (m) return parseFloat(m[1]!); // safe: group 1 is present whenever the match succeeds
  m = t.match(/(\d+(?:\.\d+)?)\s*km\b/);
  if (m) return parseFloat(m[1]!) * 0.621371; // safe: group 1 is present whenever the match succeeds
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:meters|metres|meter|metre|m)\b/);
  if (m) return parseFloat(m[1]!) / METERS_PER_MILE; // safe: group 1 is present whenever the match succeeds
  return null;
}

/** Running miles contained in a hybrid session's run elements. */
export function hybridRunMiles(hybrid: HybridSession): number {
  let miles = 0;
  for (const el of hybrid.elements) {
    const isRun = /run/i.test(el.exercise) || /run/i.test(el.prescription);
    if (!isRun) continue;
    miles += parseDistanceMiles(el.prescription) ?? DEFAULT_HYBRID_RUN_MILES;
  }
  return miles;
}

export interface SessionTiming {
  warmup: number;
  work: number;
  cooldown: number;
  total: number;
}

/**
 * Estimated session length, split into warmup / work / cooldown / total.
 * Deterministic (no AI). A race session returns zeros (event day).
 */
export function sessionTiming(session: Session): SessionTiming {
  if (session.kind === "run") {
    const [warmup, cooldown] = RUN_WARMUP_COOLDOWN[session.runType];
    // The between-rep recovery is part of the main set — you are on your feet for
    // it — so it belongs in `work`. Leaving it out made a 45-minute interval
    // session really take 60 and under-counted the week's cardio every time.
    const work = Math.max(1, Math.round(session.durationMin + (session.recoveryMin ?? 0)));
    return { warmup, work, cooldown, total: warmup + work + cooldown };
  }
  if (session.kind === "lift") {
    // Strength sessions are a fixed 60 minutes (Tasks addition #4).
    const work = STRENGTH_SESSION_MIN - STRENGTH_WARMUP - STRENGTH_COOLDOWN;
    return {
      warmup: STRENGTH_WARMUP,
      work,
      cooldown: STRENGTH_COOLDOWN,
      total: STRENGTH_SESSION_MIN,
    };
  }
  if (session.kind === "hybrid") {
    // `workMin` is the engine's pace-aware estimate, stamped during assembly.
    // The element-count proxy behind it is what programs built before that rule
    // still read on, so they render exactly as they always did.
    const raw = session.workMin ?? session.elements.length * 5;
    const work = clamp(Math.round(raw), HYBRID_MIN_WORK, HYBRID_MAX_WORK);
    return {
      warmup: HYBRID_WARMUP,
      work,
      cooldown: HYBRID_COOLDOWN,
      total: HYBRID_WARMUP + work + HYBRID_COOLDOWN,
    };
  }
  if (session.kind === "cardio") {
    // The block IS the cardio work; its duration is the whole session.
    const work = Math.max(1, Math.round(session.durationMin));
    return { warmup: 0, work, cooldown: 0, total: work };
  }
  if (session.kind === "swim" || session.kind === "bike") {
    // Triathlon endurance session: the prescribed duration IS the work.
    const work = Math.max(1, Math.round(session.durationMin));
    return { warmup: 0, work, cooldown: 0, total: work };
  }
  if (session.kind === "brick") {
    // Bike→run in one session: total is the sum of the segment durations.
    const work = Math.max(1, Math.round(session.segments.reduce((a, s) => a + s.durationMin, 0)));
    return { warmup: 0, work, cooldown: 0, total: work };
  }
  return { warmup: 0, work: 0, cooldown: 0, total: 0 };
}

/**
 * WORK miles in a single session — the reps / main set, excluding warmup and
 * cooldown. This is what the engine's weekly mileage target is set against, so a
 * long warmup never eats into the quality volume.
 */
export function sessionWorkMiles(session: Session): number {
  if (session.kind === "run") return session.distanceMiles;
  if (session.kind === "hybrid") return hybridRunMiles(session);
  return 0;
}

/**
 * TOTAL miles on the feet in a single session — work plus the warmup/cooldown
 * distance. This is what the athlete actually runs, so it is what the weekly
 * summary reports.
 */
export function sessionMiles(session: Session): number {
  const work = sessionWorkMiles(session);
  if (session.kind === "run") {
    return round1(work + (session.overheadMiles ?? 0) + (session.recoveryMiles ?? 0));
  }
  // A hybrid's warmup/cooldown jog is on-feet distance exactly like a run's, so
  // it counts (Levi, 2026-08-06). `overheadMiles` is absent on a program built
  // before this rule, which then reads as it always did.
  if (session.kind === "hybrid") return round1(work + (session.overheadMiles ?? 0));
  return work;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Warmup + cooldown distance for a run, from its fixed overhead MINUTES at easy
 * pace. Minutes are the source of truth — session timing has always been built on
 * them — and the distance is derived so both can be shown in the prescription.
 */
export function runOverheadMiles(runType: RunSession["runType"], easyPaceMinPerMile: number): number {
  if (!Number.isFinite(easyPaceMinPerMile) || easyPaceMinPerMile <= 0) return 0;
  // Round each leg separately and sum, so this equals the two figures printed in
  // the prescription ("15 min easy (~1.4 mi)" + "10 min easy (~0.9 mi)" = 2.3).
  // Rounding the combined minutes instead gave 2.4 and left the counted mileage
  // disagreeing with the workout text by a tenth.
  const [w, c] = RUN_WARMUP_COOLDOWN[runType];
  const leg = (min: number) => Math.round((min / easyPaceMinPerMile) * 10) / 10;
  return Math.round((leg(w) + leg(c)) * 10) / 10;
}

/**
 * Warmup + cooldown distance for a HYBRID session, from its fixed overhead
 * MINUTES at easy pace. Same construction as `runOverheadMiles`, including
 * rounding each leg SEPARATELY so the two figures printed in the prescription
 * add up to the number counted in the week's mileage.
 */
export function hybridOverheadMiles(easyPaceMinPerMile: number): number {
  if (!Number.isFinite(easyPaceMinPerMile) || easyPaceMinPerMile <= 0) return 0;
  const leg = (min: number) => Math.round((min / easyPaceMinPerMile) * 10) / 10;
  return Math.round((leg(HYBRID_WARMUP) + leg(HYBRID_COOLDOWN)) * 10) / 10;
}

/** Warmup + cooldown minutes for a run type (fixed overhead not counted as work). */
export function runOverhead(runType: RunSession["runType"]): number {
  const [w, c] = RUN_WARMUP_COOLDOWN[runType];
  return w + c;
}

/** Total weekly cardio minutes = run + hybrid session totals (weightlifting excluded). */
export function weekCardioMinutes(week: { days: { sessions: Session[] }[] }): number {
  let total = 0;
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (
        s.kind === "run" ||
        s.kind === "hybrid" ||
        s.kind === "cardio" ||
        s.kind === "swim" ||
        s.kind === "bike" ||
        s.kind === "brick"
      )
        total += sessionTiming(s).total;
    }
  }
  return total;
}

/** Total weekly running mileage = every run's distance + hybrid run distances. */
export function weekMileage(week: { days: { sessions: Session[] }[] }): number {
  let miles = 0;
  for (const day of week.days) {
    for (const s of day.sessions) miles += sessionMiles(s);
  }
  return Math.round(miles * 10) / 10;
}

/** Weekly WORK mileage — what the engine's target is reconciled against. */
export function weekWorkMileage(week: { days: { sessions: Session[] }[] }): number {
  let miles = 0;
  for (const day of week.days) {
    for (const s of day.sessions) miles += sessionWorkMiles(s);
  }
  return Math.round(miles * 10) / 10;
}

/**
 * Weekly training-time breakdown in minutes (Tasks addition #3).
 *   - metcon: hybrid ("HYROX/DEKA-style") workout time
 *   - strength: weightlifting time
 *   - running: run time
 *   - nonRunningCardio: everything else aerobic (cardio blocks, swim, bike, brick)
 *   - total: sum of the four above (strength + metcon + running + non-running cardio)
 * Race days contribute nothing (event day).
 */
export interface WeekTimeBreakdown {
  metcon: number;
  strength: number;
  running: number;
  nonRunningCardio: number;
  total: number;
}

export function weekTimeByCategory(week: { days: { sessions: Session[] }[] }): WeekTimeBreakdown {
  const out: WeekTimeBreakdown = {
    metcon: 0,
    strength: 0,
    running: 0,
    nonRunningCardio: 0,
    total: 0,
  };
  for (const day of week.days) {
    for (const s of day.sessions) {
      const t = sessionTiming(s).total;
      if (t <= 0) continue;
      switch (s.kind) {
        case "hybrid":
          out.metcon += t;
          break;
        case "lift":
          out.strength += t;
          break;
        case "run":
          out.running += t;
          break;
        case "cardio":
        case "swim":
        case "bike":
        case "brick":
          out.nonRunningCardio += t;
          break;
        default:
          break;
      }
    }
  }
  out.total = out.metcon + out.strength + out.running + out.nonRunningCardio;
  return out;
}

/**
 * Weekly Ironman/triathlon training time by discipline, in minutes.
 *
 *   - swim     : swim session totals + any brick swim segments
 *   - bike     : bike session totals + brick BIKE segments
 *   - run      : run session totals + brick RUN segments
 *   - lift     : strength time (a flat 60 min per lift via `sessionTiming`)
 *   - total    : swim + bike + run + lift
 *
 * A brick is split across its disciplines: the bike segment counts toward bike,
 * the run segment toward run (using the segment durations, exactly as
 * `sessionTiming` sums a brick). Race days contribute nothing. Additive helper
 * for the triathlon views — it does not affect any existing volume computation.
 */
export interface WeekIronmanTime {
  swim: number;
  bike: number;
  run: number;
  lift: number;
  total: number;
}

export function weekIronmanTime(week: { days: { sessions: Session[] }[] }): WeekIronmanTime {
  let swim = 0;
  let bike = 0;
  let run = 0;
  let lift = 0;
  for (const day of week.days) {
    for (const s of day.sessions) {
      if (s.kind === "swim") {
        swim += sessionTiming(s).total;
      } else if (s.kind === "bike") {
        bike += sessionTiming(s).total;
      } else if (s.kind === "run") {
        run += sessionTiming(s).total;
      } else if (s.kind === "lift") {
        lift += sessionTiming(s).total;
      } else if (s.kind === "brick") {
        for (const seg of s.segments) {
          if (seg.discipline === "bike") bike += seg.durationMin;
          else if (seg.discipline === "run") run += seg.durationMin;
          else if (seg.discipline === "swim") swim += seg.durationMin;
        }
      }
    }
  }
  return { swim, bike, run, lift, total: swim + bike + run + lift };
}
