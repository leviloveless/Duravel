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
import {
  effectivePace,
  formatPace,
  paceLabel,
  type RunPaces,
} from "@/lib/engine/paces";
import { hybridRunMiles, runOverhead, sessionTiming, weekMileage } from "@/lib/session-volume";

type RunSession = Extract<Session, { kind: "run" }>;
type CardioSession = Extract<Session, { kind: "cardio" }>;

const MAX_RUN_TOTAL = 90; // cap per run (total minutes incl. warmup/cooldown)
const MIN_CARDIO_TOTAL = 45; // every cardio session ≥ 45 min
const EASY_LONG_MIN_MI = 3;
const MIN_RUN_MILES = 0.3;

/** Relative distance share by run type when spreading remaining miles. */
const TYPE_WEIGHT: Record<RunType, number> = {
  long: 2.0, progression: 1.3, fartlek: 1.2, tempo: 1.1, threshold: 1.1, interval: 1.0, easy: 1.0, hybrid_run: 1.0,
};

/** How readily a run is dropped when a week is too small (lower = dropped first; long never). */
const DROP_RANK: Record<RunType, number> = {
  easy: 0, fartlek: 1, progression: 1, tempo: 2, threshold: 3, interval: 3, hybrid_run: 4, long: 99,
};

const CARDIO_DESCRIPTION =
  "Easy Zone 1–2 non-running cardio (bike, row, ski erg, or elliptical) to complete the week's prescribed cardio volume. Keep it conversational — this is aerobic time, not a hard effort.";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

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

function leastLoadedDay(days: ProgramDay[]): number {
  let best = 0;
  // safe: i is bounded by days.length; best is 0 or a prior in-bounds index.
  for (let i = 1; i < days.length; i++) if (days[i]!.sessions.length < days[best]!.sessions.length) best = i;
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
): void {
  if (!paces) return; // no 5K → can't apply formula paces
  const hasRace = days.some((d) => d.sessions.some((s) => s.kind === "race"));
  if (hasRace) return;

  rewriteHybridPaces(days, paces.threshold);

  // Fixed hybrid contribution.
  let hybridMi = 0;
  let hybridMin = 0;
  for (const d of days) for (const s of d.sessions) {
    if (s.kind === "hybrid") {
      hybridMi += hybridRunMiles(s);
      hybridMin += sessionTiming(s).total;
    }
  }
  const RM = Math.max(0, round1(targetMileage - hybridMi)); // running miles to place

  // Collect run entries.
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
        max: maxMiles(paceMin, overhead),
        miles: 0,
      });
    }
  }

  const added: Session[] = [];

  if (runs.length === 0) {
    if (RM > 0) added.push(...buildEasyRuns(RM, paces, runningExp));
  } else {
    sizeRuns(runs, RM, days, paces, runningExp, added);
    for (const r of runs) writeRun(r, paces);
  }

  // Place added easy runs before the mileage true-up so they count.
  for (const s of added) days[leastLoadedDay(days)]!.sessions.push(s); // safe: leastLoadedDay returns an in-bounds index for a non-empty week
  trueUpMileage(days, targetMileage, paces);

  // Fill the remaining cardio time with a non-running Zone 1–2 block(s).
  let runningCardio = 0;
  for (const d of days) for (const s of d.sessions) {
    if (s.kind === "run" || s.kind === "hybrid") runningCardio += sessionTiming(s).total;
  }
  let gap = Math.round(targetCardioMinutes) - runningCardio;
  if (gap > 0) {
    for (const block of splitCardio(gap)) days[leastLoadedDay(days)]!.sessions.push(block); // safe: leastLoadedDay returns an in-bounds index for a non-empty week
  }
}

function minMiles(type: RunType, paceMin: number, overhead: number): number {
  const base = Math.max(MIN_CARDIO_TOTAL - overhead, 1) / paceMin;
  if (type === "easy" || type === "long") return Math.max(EASY_LONG_MIN_MI, base);
  return base;
}

function maxMiles(paceMin: number, overhead: number): number {
  return (MAX_RUN_TOTAL - overhead) / paceMin;
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
): void {
  // Consolidate: while the minimums don't fit, drop the most-droppable run
  // (never the long run) and remove it from its day.
  while (runs.length > 1 && RM < runs.reduce((a, r) => a + r.min, 0)) {
    // Drop the most-droppable run (easy first; never the long run).
    const victimIdx = runs.reduce(
      (best, r, i) =>
        r.type !== "long" && (best === -1 || DROP_RANK[r.type] < DROP_RANK[runs[best]!.type]) ? i : best, // safe: runs[best] only read when best !== -1, a prior in-bounds index
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
      if (overflow > 0.05) added.push(...buildEasyRuns(overflow, paces, runningExp));
    }
  }
}

function writeRun(r: RunEntry, paces: RunPaces): void {
  const miles = Math.max(MIN_RUN_MILES, round1(r.miles));
  let work = Math.round(miles * r.paceMin);
  // Respect the 45–90 min total band even after rounding.
  work = Math.min(MAX_RUN_TOTAL - r.overhead, Math.max(1, work));
  r.ref.distanceMiles = miles;
  r.ref.durationMin = work;
  r.ref.paceMinMile = paceLabel(r.type, paces);
}

/** Build easy runs to carry `miles`, each within the easy min/max band. */
function buildEasyRuns(miles: number, paces: RunPaces, runningExp: ExperienceLevel): RunSession[] {
  const paceMin = effectivePace("easy", paces) / 60;
  const overhead = runOverhead("easy");
  const max = maxMiles(paceMin, overhead);
  const n = Math.max(1, Math.ceil(miles / max));
  const out: RunSession[] = [];
  for (let i = 0; i < n; i++) {
    const d = Math.max(MIN_RUN_MILES, round1(miles / n));
    const work = Math.min(MAX_RUN_TOTAL - overhead, Math.max(1, Math.round(d * paceMin)));
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

/** Snap the longest run so the week's mileage equals the target exactly. */
function trueUpMileage(days: ProgramDay[], targetMileage: number, paces: RunPaces): void {
  const runRefs: RunSession[] = [];
  for (const d of days) for (const s of d.sessions) if (s.kind === "run") runRefs.push(s);
  if (runRefs.length === 0) return;
  const diff = round1(targetMileage - weekMileage({ days }));
  if (Math.abs(diff) < 0.1) return;
  const anchor = runRefs.reduce((a, b) => (b.distanceMiles > a.distanceMiles ? b : a));
  anchor.distanceMiles = Math.max(MIN_RUN_MILES, round1(anchor.distanceMiles + diff));
  const overhead = runOverhead(anchor.runType);
  const paceMin = effectivePace(anchor.runType, paces) / 60;
  anchor.durationMin = Math.min(MAX_RUN_TOTAL - overhead, Math.max(1, Math.round(anchor.distanceMiles * paceMin)));
}

/** Split leftover cardio minutes into ≤90-min blocks (≥45 where possible). */
function splitCardio(total: number): CardioSession[] {
  if (total <= 0) return [];
  if (total <= MAX_RUN_TOTAL) return [makeCardio(total)];
  const n = Math.ceil(total / MAX_RUN_TOTAL);
  const per = total / n;
  return Array.from({ length: n }, (_, i) =>
    makeCardio(i === n - 1 ? total - Math.round(per) * (n - 1) : Math.round(per)),
  );
}
