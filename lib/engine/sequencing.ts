/**
 * Concurrent-training sequencing guards (Review #8) — split out of slots.ts
 * (roadmap #2.6).
 *
 * Endurance and strength adaptations interfere (AMPK vs mTOR), and heavy leg
 * work leaves residual fatigue that compromises a quality run the next day. So
 * we keep heavy-leg lifts (lower / full body) off the day BEFORE a key run
 * (long / interval / threshold / tempo). Best-effort + count-preserving: it only
 * relocates onto unprotected days and never onto (or the day before) another key
 * run, and only pushes a "light" session back to the vacated day.
 */

import type { DaySlot, RunType, SessionSlot, SlotPredicate, TrainingDayName } from "./types";

const KEY_RUN_TYPES: ReadonlySet<RunType> = new Set(["long", "interval", "threshold", "tempo"]);
export const isKeyRun: SlotPredicate = (s) => s.kind === "run" && KEY_RUN_TYPES.has(s.runType);
export const isHardLegLift: SlotPredicate = (s) =>
  s.kind === "lift" && (s.liftType === "lower" || s.liftType === "full");

/** A session light enough to sit the day before a key run (no leg fatigue). */
function isLightSlot(s: SessionSlot): boolean {
  if (s.kind === "rest") return true;
  if (s.kind === "run") return !isKeyRun(s);
  if (s.kind === "lift") return s.liftType === "upper";
  return false; // hybrid / race are not "light"
}

function dayHas(day: DaySlot, pred: SlotPredicate): boolean {
  return day.sessions.some(pred);
}

/** Index of a movable "light" session on a day, or -1. */
function lightIndex(day: DaySlot): number {
  return day.sessions.findIndex(isLightSlot);
}

/**
 * Pick a day to relocate a heavy-leg lift to: unprotected, not a key-run day,
 * not the day before a key run, and able to give back a light session (or empty).
 * Empty days are strongly preferred. Returns the day index, or -1.
 */
function pickSequencingTarget(
  days: DaySlot[],
  keyRunIdx: number,
  protectedDays: Set<TrainingDayName>,
): number {
  const beforeKeyRun = (t: number) => t + 1 < days.length && dayHas(days[t + 1]!, isKeyRun); // safe: t + 1 < days.length
  let best = -1;
  let bestScore = -Infinity;
  for (let t = 0; t < days.length; t++) {
    if (t === keyRunIdx || t === keyRunIdx - 1) continue;
    const day = days[t]!; // safe: t < days.length
    if (protectedDays.has(day.day)) continue;
    if (dayHas(day, isKeyRun)) continue;
    if (beforeKeyRun(t)) continue;
    const empty = day.sessions.length === 0;
    if (!empty && lightIndex(day) === -1) continue; // nothing safe to swap back
    const load = day.sessions.filter((x) => x.kind !== "rest").length;
    const score = (empty ? 100 : 0) - load;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Relocate heavy-leg lifts that sit the day before a key run. */
export function applySequencingGuards(days: DaySlot[], protectedDays: Set<TrainingDayName>): void {
  for (let i = 1; i < days.length; i++) {
    const day = days[i]!; // safe: i < days.length
    if (!dayHas(day, isKeyRun)) continue;
    const prev = days[i - 1]!; // safe: i >= 1
    if (protectedDays.has(prev.day)) continue;
    const j = prev.sessions.findIndex(isHardLegLift);
    if (j === -1) continue;
    const target = pickSequencingTarget(days, i, protectedDays);
    if (target === -1) continue;

    const lift = prev.sessions.splice(j, 1)[0]!; // safe: j is a valid index (!== -1)
    const tgt = days[target]!; // safe: pickSequencingTarget returns a valid index or -1
    if (tgt.sessions.length === 0) {
      tgt.sessions.push(lift);
    } else {
      const di = lightIndex(tgt); // guaranteed ≥ 0 by pickSequencingTarget
      const back = tgt.sessions.splice(di, 1)[0]!; // safe: di ≥ 0 (a light session exists)
      prev.sessions.push(back);
      tgt.sessions.push(lift);
    }
  }
}
