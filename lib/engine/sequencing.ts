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

/** Two sessions a day is absolute (mirrors `MAX_WORKOUTS_PER_DAY` in slots.ts). */
const MAX_WORKOUTS_PER_DAY = 2;

const KEY_RUN_TYPES: ReadonlySet<RunType> = new Set(["long", "interval", "threshold", "tempo"]);
export const isKeyRun: SlotPredicate = (s) => s.kind === "run" && KEY_RUN_TYPES.has(s.runType);
export const isHardLegLift: SlotPredicate = (s) =>
  s.kind === "lift" && (s.liftType === "lower" || s.liftType === "full" || s.liftType === "power");

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

/**
 * Keep hard running off the day AFTER the long run.
 *
 * The long run is the week's biggest aerobic stress; stacking an interval /
 * threshold / tempo session on the very next day gives two hard days back to
 * back with no recovery between them. This swaps such a run with an easy run (or
 * a rest/empty day) elsewhere in the week — count-preserving and best-effort, and
 * it never touches a protected day or creates a new key-run adjacency.
 */
export function spaceHardRunAfterLongRun(
  days: DaySlot[],
  protectedDays: Set<TrainingDayName>,
): void {
  const longIdx = days.findIndex((d) =>
    d.sessions.some((s) => s.kind === "run" && (s.isLong === true || s.runType === "long")),
  );
  if (longIdx === -1) return;
  const nextIdx = longIdx + 1;
  if (nextIdx >= days.length) return; // long run is the last training day — nothing follows
  const next = days[nextIdx]!; // safe: nextIdx < days.length
  if (protectedDays.has(next.day)) return;
  const hardIdx = next.sessions.findIndex(
    (s) => s.kind === "run" && !(s.isLong === true || s.runType === "long") && isKeyRun(s),
  );
  if (hardIdx === -1) return;

  // Prefer swapping with an easy run; otherwise move onto the emptiest free day.
  for (let t = 0; t < days.length; t++) {
    if (t === nextIdx || t === longIdx || protectedDays.has(days[t]!.day)) continue;
    const day = days[t]!; // safe: t < days.length
    if (t + 1 === longIdx) continue; // don't create a hard day right before the long run
    const easyIdx = day.sessions.findIndex(isEasyRun);
    if (easyIdx === -1) continue;
    const hard = next.sessions.splice(hardIdx, 1)[0]!; // safe: hardIdx !== -1
    const easy = day.sessions.splice(easyIdx, 1)[0]!; // safe: easyIdx !== -1
    day.sessions.push(hard);
    next.sessions.push(easy);
    return;
  }
  // No easy run to trade with: relocate onto a run-free, unprotected day.
  for (let t = 0; t < days.length; t++) {
    if (t === nextIdx || t === longIdx || protectedDays.has(days[t]!.day)) continue;
    if (t + 1 === longIdx) continue;
    const day = days[t]!; // safe: t < days.length
    if (day.sessions.some(isKeyRun)) continue;
    if (day.sessions.filter((x) => x.kind !== "rest").length >= 2) continue;
    const hard = next.sessions.splice(hardIdx, 1)[0]!; // safe: hardIdx !== -1
    day.sessions.push(hard);
    return;
  }
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

// --- Research-aligned scheduling guards (engine-vs-research batch 3) ----------
//
// Two rules from the engine-vs-research gap analysis, applied ONLY for
// research-lift programs (gated at the call site on counts.researchLifts, so the
// golden oracle — which has no weeklyHours — is untouched):
//   1. No two lifts on the same day. A second weight session is relocated to a
//      lift-free day (the research separates concurrent strength sessions).
//   2. Every hard-leg lift day (lower / full / power) is paired with easy Z1–Z2
//      cardio on the SAME day. An easy run is pulled onto it from another day.
// Both are best-effort and session-count-preserving: they only relocate existing
// sessions onto unprotected days and never create or drop a session.

/** Any endurance session that counts as "cardio" for same-day leg-lift pairing. */
function isCardio(s: SessionSlot): boolean {
  return (
    s.kind === "run" ||
    s.kind === "hybrid" ||
    s.kind === "bike" ||
    s.kind === "swim" ||
    s.kind === "brick"
  );
}

/** A movable easy Z1–Z2 run (never the long run or any quality run). */
const isEasyRun: SlotPredicate = (s) => s.kind === "run" && s.runType === "easy";

/** True if placing a hard-leg lift on day `t` would sit it on — or the day
 *  before — a key run, breaking the applySequencingGuards invariant. */
function conflictsWithKeyRun(days: DaySlot[], t: number): boolean {
  if (dayHas(days[t]!, isKeyRun)) return true; // safe: t is a valid index in the caller loop
  return t + 1 < days.length && dayHas(days[t + 1]!, isKeyRun); // safe: t + 1 < days.length
}

/**
 * The session `separateLifts` would hand BACK to the source day when the chosen
 * destination is already at the 2-a-day ceiling, or -1 if there is none.
 *
 * Constraints on what may travel back: never a rest slot, never a race, never
 * the long run (pinned), and never a lift — the source day is keeping a lift of
 * its own, so sending one back would recreate the very two-lift day we are here
 * to break up. And when the lift moving IN is a hard-leg lift, the destination's
 * last cardio session may not leave: `pairLegLiftWithCardio` runs next and that
 * cardio is the reason this day scored well in the first place.
 *
 * Ties break to the most movable session (`sessionMovability`), so what gets
 * displaced is the week's lightest work.
 */
function giveBackIndex(
  days: DaySlot[],
  srcIdx: number,
  destIdx: number,
  incomingIsLegLift: boolean,
): number {
  const dest = days[destIdx]!; // safe: caller passes a valid index
  const src = days[srcIdx]!; // safe: caller passes a valid index
  const cardioCount = dest.sessions.filter(isCardio).length;
  // What arriving on the SOURCE day would cost. The source keeps a lift, so a
  // key run landing there can stack two hard runs on one day, or sit the day
  // after a heavy-leg lift — the two things `applySequencingGuards` and
  // `spreadRuns` exist to prevent. Penalize rather than veto: the no-two-lifts
  // rule still has to win when nothing else is available.
  const srcHasKeyRun = dayHas(src, isKeyRun);
  const prevHasLegLift = srcIdx > 0 && dayHas(days[srcIdx - 1]!, isHardLegLift);
  const cost = (s: SessionSlot): number => {
    let c = sessionMovability(s);
    if (isKeyRun(s)) {
      if (srcHasKeyRun) c += 100; // two quality runs on one day
      if (prevHasLegLift) c += 50; // quality run the day after heavy legs
    }
    return c;
  };
  const cands = dest.sessions
    .map((s, i) => ({ s, i }))
    .filter(
      (x) =>
        x.s.kind !== "rest" &&
        x.s.kind !== "race" &&
        x.s.kind !== "lift" &&
        !isLongRunSlot(x.s) &&
        !(incomingIsLegLift && isCardio(x.s) && cardioCount <= 1),
    )
    .sort((a, b) => cost(a.s) - cost(b.s));
  return cands[0]?.i ?? -1;
}

/**
 * Pick a lift-free day to relocate an extra lift onto: unprotected, holding no
 * existing lift, and — for hard-leg lifts — clear of key-run fatigue. A day that
 * already has easy cardio is ideal (the moved leg lift auto-pairs); otherwise an
 * empty/light day is preferred. Returns the day index, or -1.
 *
 * A day already at the 2-a-day ceiling is eligible only if it has a session it
 * can hand back to the source day (see `giveBackIndex`) — this pass used to push
 * a third session on and leave `capSessionsPerDay` to sweep up after it, which
 * made the 2-a-day rule true by cleanup rather than by construction. It was the
 * ONLY pass in the pipeline that did so: an audit over 47,040 generated weeks
 * found 10,675 over-cap days created here and none anywhere else.
 */
function pickNoLiftDay(
  days: DaySlot[],
  fromIdx: number,
  lift: SessionSlot,
  protectedDays: Set<TrainingDayName>,
): number {
  const legLift = isHardLegLift(lift);
  let best = -1;
  let bestScore = -Infinity;
  for (let t = 0; t < days.length; t++) {
    if (t === fromIdx) continue;
    const day = days[t]!; // safe: t < days.length
    if (protectedDays.has(day.day)) continue;
    if (dayHas(day, (s) => s.kind === "lift")) continue; // HARD: never two lifts on a day
    const load = day.sessions.filter((x) => x.kind !== "rest").length;
    // HARD: never a third session on a day. A full day may still take the lift,
    // but only as a SWAP — it has to have something legal to send back.
    const full = load >= MAX_WORKOUTS_PER_DAY;
    if (full && giveBackIndex(days, fromIdx, t, legLift) === -1) continue;
    const pairs = legLift && dayHas(day, isCardio) ? 1 : 0; // leg lift onto easy cardio = ideal
    // Key-run adjacency is a strong PREFERENCE, not a veto: the no-two-lifts rule
    // must always win, so we penalize a conflicting day rather than skip it (in a
    // dense peak week nearly every day is key-run-adjacent — skipping stranded the
    // extra lift and left two on one day).
    const conflict = legLift && conflictsWithKeyRun(days, t) ? 1 : 0;
    // A day with room beats a day that has to displace something, all else equal:
    // a swap is churn, and the displaced session lands back on a day that is
    // already carrying a lift.
    const score = pairs * 200 + (load === 0 ? 50 : 0) - load - conflict * 500 - (full ? 25 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Rule 1: no two lifts on the same day (relocate the extras, keep the first). */
export function separateLifts(days: DaySlot[], protectedDays: Set<TrainingDayName>): void {
  const liftIdxs = (day: DaySlot): number[] =>
    day.sessions.map((s, k) => (s.kind === "lift" ? k : -1)).filter((k) => k >= 0);
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!; // safe: i < days.length
    let idxs = liftIdxs(day);
    while (idxs.length > 1) {
      const moveIdx = idxs[idxs.length - 1]!; // relocate the last lift on the day
      const lift = day.sessions[moveIdx]!; // safe: moveIdx is a valid session index
      const target = pickNoLiftDay(days, i, lift, protectedDays);
      if (target === -1) break; // nowhere safe — leave it (best-effort)
      const dest = days[target]!; // safe: pickNoLiftDay returns a valid index or -1
      day.sessions.splice(moveIdx, 1);
      // Destination at the ceiling: trade, don't stack. `pickNoLiftDay` only
      // returns a full day when this index exists.
      if (dest.sessions.filter((x) => x.kind !== "rest").length >= MAX_WORKOUTS_PER_DAY) {
        const back = giveBackIndex(days, i, target, isHardLegLift(lift));
        if (back !== -1) day.sessions.push(dest.sessions.splice(back, 1)[0]!); // safe: back !== -1
      }
      dest.sessions.push(lift);
      idxs = liftIdxs(day);
    }
  }
}

/**
 * A source day to pull an easy run off, without unpairing another leg lift:
 * unprotected, holding an easy run, and — if it also has a hard-leg lift — with
 * a spare cardio session left behind. Prefers days with no leg lift and the most
 * cardio. Returns the day index, or -1.
 */
function pickEasyRunSource(
  days: DaySlot[],
  destIdx: number,
  protectedDays: Set<TrainingDayName>,
): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let t = 0; t < days.length; t++) {
    if (t === destIdx) continue;
    const day = days[t]!; // safe: t < days.length
    if (protectedDays.has(day.day)) continue;
    if (!dayHas(day, isEasyRun)) continue;
    const cardioCount = day.sessions.filter(isCardio).length;
    const legHere = dayHas(day, isHardLegLift);
    if (legHere && cardioCount <= 1) continue; // don't strip the only cardio off a leg-lift day
    const score = (legHere ? 0 : 100) + cardioCount;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Rule 2: pair every hard-leg-lift day with easy Z1–Z2 cardio on the same day. */
export function pairLegLiftWithCardio(days: DaySlot[], protectedDays: Set<TrainingDayName>): void {
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!; // safe: i < days.length
    if (!dayHas(day, isHardLegLift)) continue;
    if (dayHas(day, isCardio)) continue; // already paired
    const src = pickEasyRunSource(days, i, protectedDays);
    if (src === -1) continue; // no movable easy run — leave it (best-effort)
    const j = days[src]!.sessions.findIndex(isEasyRun);
    if (j === -1) continue; // defensive: pickEasyRunSource guarantees one exists
    const run = days[src]!.sessions.splice(j, 1)[0]!; // safe: j !== -1
    day.sessions.push(run);
  }
}

// --- Daily-load guards (per-day session limits) ------------------------------
//
// Two structural rules layered on top of the batch-3 guards, applied only for
// research-lift programs (gated at the call site on counts.researchLifts, so the
// golden oracle is untouched):
//   #2  A day may hold a SECOND run only once every (unprotected) training day
//       already has a run — runs spread across days before they double up.
//   #1  No more than 2 workouts on any single day — a 3rd+ session is relocated
//       to a lighter day (respecting rest-day preferences and the no-two-lifts
//       rule). Both are best-effort and session-count-preserving.

const isRun: SlotPredicate = (s) => s.kind === "run";
const isLift: SlotPredicate = (s) => s.kind === "lift";
/** The weekly long run is pinned to its (preferred or weekend-default) day by
 *  assignDays; these load guards must never relocate it. Protected-day checks
 *  only guard a DESTINATION, so the long run needs an explicit exemption here. */
const isLongRunSlot: SlotPredicate = (s) =>
  s.kind === "run" && (s.isLong === true || s.runType === "long");

/** Non-rest workouts on a day (rest slots aren't added until after the guards). */
function workoutCount(day: DaySlot): number {
  return day.sessions.filter((s) => s.kind !== "rest").length;
}
function runCount(day: DaySlot): number {
  return day.sessions.filter(isRun).length;
}

/** Lower = relocate this run first (keep the long run on its day). */
function runMovability(s: SessionSlot): number {
  if (s.kind !== "run") return 99;
  if (s.isLong || s.runType === "long") return 2;
  if (s.runType === "easy") return 0;
  return 1;
}

/** Lower = relocate this session first off an overloaded day. */
export function sessionMovability(s: SessionSlot): number {
  if (s.kind === "run") return s.isLong || s.runType === "long" ? 6 : s.runType === "easy" ? 1 : 3;
  if (s.kind === "hybrid") return 4;
  if (s.kind === "lift") return 5;
  return 8; // race / swim / bike / brick — pinned (not produced for research-lift sports)
}

/**
 * Rule #2: runs spread across days before doubling. While some day stacks ≥2
 * runs and an unprotected day has none (with room for another session), move the
 * most-movable run onto the emptiest run-less day.
 */
export function spreadRuns(days: DaySlot[], protectedDays: Set<TrainingDayName>): void {
  for (let guard = 0; guard < days.length * 4; guard++) {
    const srcIdx = days.findIndex((d) => runCount(d) >= 2);
    if (srcIdx === -1) break;
    let best = -1;
    let bestLoad = Infinity;
    for (let t = 0; t < days.length; t++) {
      const d = days[t]!; // safe: t < days.length
      if (protectedDays.has(d.day)) continue;
      if (runCount(d) > 0) continue;
      const load = workoutCount(d);
      if (load >= 2) continue; // adding a run would break the 2-per-day cap
      if (load < bestLoad) {
        bestLoad = load;
        best = t;
      }
    }
    if (best === -1) break; // every day already has a run (or no room) — doubling allowed
    const src = days[srcIdx]!; // safe: findIndex returned a valid index
    const movable = src.sessions
      .map((sl, i) => ({ sl, i }))
      .filter((x) => x.sl.kind === "run" && !isLongRunSlot(x.sl)) // never move the long run
      .sort((a, b) => runMovability(a.sl) - runMovability(b.sl));
    if (movable.length === 0) break; // only the long run here — leave it put
    const moveIdx = movable[0]!.i; // safe: srcIdx has ≥2 runs
    const run = src.sessions.splice(moveIdx, 1)[0]!; // safe: moveIdx is a valid index
    days[best]!.sessions.push(run); // safe: best is a valid index
  }
}

/**
 * Never leave a selected training day empty while another day doubles up.
 *
 * The athlete picked these days; a day the engine leaves bare is wasted capacity,
 * and it always pairs with some other day carrying two sessions. The round-robin
 * in assignDays deals one session per day and would never produce this — it's the
 * pinning passes afterwards (long run forced to its day, hybrid anchored to the
 * weekend, lifts re-dealt onto spread targets) that pull sessions off a day and
 * strand it, because none of them checks whether it just emptied one.
 *
 * This runs last and deliberately outranks those pins: a hybrid anchor or a
 * preferred lift day will yield to fill an empty day. Two things it will NOT
 * move — the long run, which the athlete pinned to a chosen day and which every
 * other pass already exempts, and a race. A rest day the athlete asked for is not
 * "empty" in the sense that matters, so `protectedDays` is still honoured as the
 * set of days that must stay clear.
 */
export function fillEmptyDays(days: DaySlot[], protectedDays: Set<TrainingDayName>): void {
  for (let guard = 0; guard < days.length * 4; guard++) {
    const destIdx = days.findIndex((d) => !protectedDays.has(d.day) && workoutCount(d) === 0);
    if (destIdx === -1) break; // every training day is doing something
    // Take from the fullest day, so the week levels out rather than shuffling.
    let srcIdx = -1;
    for (let t = 0; t < days.length; t++) {
      if (t === destIdx) continue;
      if (workoutCount(days[t]!) < 2) continue; // only ever unstack a doubled day
      if (srcIdx === -1 || workoutCount(days[t]!) > workoutCount(days[srcIdx]!)) srcIdx = t;
    }
    if (srcIdx === -1) break; // nothing is doubled — the empty day is genuine slack
    const src = days[srcIdx]!; // safe: srcIdx set in the loop above
    const dest = days[destIdx]!; // safe: findIndex returned a valid index
    const movable = src.sessions
      .map((sl, i) => ({ sl, i }))
      .filter((x) => x.sl.kind !== "rest" && x.sl.kind !== "race" && !isLongRunSlot(x.sl))
      // Never end up with two lifts on the destination day.
      .filter((x) => !(x.sl.kind === "lift" && dayHas(dest, isLift)))
      .sort((a, b) => sessionMovability(a.sl) - sessionMovability(b.sl));
    if (movable.length === 0) break; // only pinned work here — best-effort, stop
    const sess = src.sessions.splice(movable[0]!.i, 1)[0]!; // safe: length checked above
    dest.sessions.push(sess);
  }
}

/** A lighter, unprotected day that can accept `sess` under the 2-per-day cap. */
function pickCapTarget(
  days: DaySlot[],
  fromIdx: number,
  sess: SessionSlot,
  protectedDays: Set<TrainingDayName>,
  max: number,
): number {
  const wantRun = sess.kind === "run";
  const wantLift = sess.kind === "lift";
  let best = -1;
  let bestScore = -Infinity;
  for (let t = 0; t < days.length; t++) {
    if (t === fromIdx) continue;
    const d = days[t]!; // safe: t < days.length
    if (protectedDays.has(d.day)) continue;
    const load = workoutCount(d);
    if (load >= max) continue;
    if (wantLift && dayHas(d, isLift)) continue; // never two lifts on a day
    const runless = runCount(d) === 0;
    const score = (load === 0 ? 100 : 0) + (wantRun && runless ? 50 : 0) - load; // prefer empty, then runless for runs
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/**
 * Rule #1: no more than `max` (default 2) workouts on any day. Relocate the
 * most-movable excess session to a lighter day; keep lifts and the long run put.
 */
export function capSessionsPerDay(
  days: DaySlot[],
  protectedDays: Set<TrainingDayName>,
  max = 2,
): void {
  for (let guard = 0; guard < days.length * 6; guard++) {
    const srcIdx = days.findIndex((d) => workoutCount(d) > max);
    if (srcIdx === -1) break;
    const src = days[srcIdx]!; // safe: findIndex returned a valid index
    const order = src.sessions
      .map((sl, i) => ({ sl, i }))
      .filter((x) => x.sl.kind !== "rest" && !isLongRunSlot(x.sl)) // long run is pinned
      .sort((a, b) => sessionMovability(a.sl) - sessionMovability(b.sl));
    let moved = false;
    for (const cand of order) {
      const t = pickCapTarget(days, srcIdx, cand.sl, protectedDays, max);
      if (t === -1) continue;
      const sess = src.sessions.splice(cand.i, 1)[0]!; // safe: cand.i is a valid index
      days[t]!.sessions.push(sess); // safe: pickCapTarget returns a valid index or -1
      moved = true;
      break;
    }
    if (!moved) break; // nowhere safe to move anything — best-effort
  }
}

// --- Lift-day recovery separation (all programs) -----------------------------
//
// Levi's rule: two FULL-BODY lifts must never land on consecutive CALENDAR days,
// and full-body lifts are kept >=2 days apart when the week allows; every weight
// session (any split) additionally tries to sit >=1 day apart. Gaps are measured
// in calendar days — so a rest day between two lifts counts — not in training-day
// slots. Best-effort and count-preserving: a lift is relocated onto an
// unprotected, lift-free day (giving back a light session when that day is
// occupied) and never onto a rest day or a new consecutive-lift adjacency.

const CAL_INDEX: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};
const isFullLift: SlotPredicate = (s) => s.kind === "lift" && s.liftType === "full";

/** Calendar-day gap between two day slots (Mon→Wed = 2). */
function calGap(days: DaySlot[], i: number, j: number): number {
  return Math.abs((CAL_INDEX[days[i]!.day] ?? 0) - (CAL_INDEX[days[j]!.day] ?? 0));
}

/** Required minimum calendar gap between two lift days: 3 (>=2 days between) when
 *  BOTH are full-body/heavy, else 2 (>=1 day between — not consecutive). */
function requiredLiftGap(days: DaySlot[], i: number, j: number): number {
  return dayHas(days[i]!, isFullLift) && dayHas(days[j]!, isFullLift) ? 3 : 2;
}

/** Best day to relocate the lift on `fromIdx` to: unprotected, lift-free, able to
 *  give back a light session, and — critically — never calendar-consecutive to any
 *  other lift. Maximizes the smallest gap to the other lifts. Returns -1 if none. */
function bestLiftDay(
  days: DaySlot[],
  fromIdx: number,
  protectedDays: Set<TrainingDayName>,
): number {
  const otherLiftIdxs = days
    .map((d, i) => (i !== fromIdx && dayHas(d, isLift) ? i : -1))
    .filter((i) => i >= 0);
  const lift = days[fromIdx]!.sessions.find(isLift);
  const hardLeg = !!lift && isHardLegLift(lift);
  let best = -1;
  let bestScore = -Infinity;
  for (let t = 0; t < days.length; t++) {
    if (t === fromIdx) continue;
    const d = days[t]!;
    if (protectedDays.has(d.day)) continue;
    if (dayHas(d, isLift)) continue; // never two lifts on a day
    const empty = d.sessions.length === 0;
    if (!empty && lightIndex(d) === -1) continue; // nothing safe to give back
    const minGap = otherLiftIdxs.length
      ? Math.min(...otherLiftIdxs.map((o) => calGap(days, t, o)))
      : 99;
    if (minGap < 2) continue; // would create a consecutive-day lift pair
    const conflict = hardLeg && conflictsWithKeyRun(days, t) ? 1 : 0;
    const load = d.sessions.filter((x) => x.kind !== "rest").length;
    const score = minGap * 100 + (empty ? 10 : 0) - load - conflict * 40;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Move the lift on `fromIdx` to `targetIdx`, swapping a light session back if the
 *  target already holds work (count-preserving). */
function moveLiftTo(days: DaySlot[], fromIdx: number, targetIdx: number): void {
  const from = days[fromIdx]!;
  const tgt = days[targetIdx]!;
  const j = from.sessions.findIndex(isLift);
  if (j === -1) return;
  const lift = from.sessions.splice(j, 1)[0]!; // safe: j !== -1
  if (tgt.sessions.length > 0) {
    const di = lightIndex(tgt);
    if (di !== -1) {
      const back = tgt.sessions.splice(di, 1)[0]!; // safe: di !== -1
      from.sessions.push(back);
    }
  }
  tgt.sessions.push(lift);
}

/** Every size-k subset of `xs` (k small; used for lift-day selection). */
function kSubsets<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > xs.length) return [];
  const [head, ...rest] = xs;
  const withHead = kSubsets(rest, k - 1).map((s) => [head!, ...s]);
  const withoutHead = kSubsets(rest, k);
  return [...withHead, ...withoutHead];
}

/**
 * Levi's HARD rule enforcer: two FULL-BODY lifts must never share consecutive
 * days and are kept >=2 calendar days apart when the lift days allow it. Rather
 * than MOVE a lift (which fails when every free day is protected — long run,
 * weekend hybrid, key runs), this RELABELS which of the existing lift days carry
 * the heavy "full" session vs the lighter split/power session. That is
 * count-preserving and needs no free day, so it works in the densest weeks.
 *
 * With the research heavy/power split a 3-lift week is [full, power, full]; if
 * both fulls get dealt onto adjacent days (e.g. Tue+Wed), this reassigns "full"
 * to the best-spread pair of lift days (e.g. Tue+Fri) and hands the vacated day
 * the power session — same sessions, legal spacing. No-op when the current full
 * placement is already >=2 days apart, so weeks that were already fine (and the
 * golden fixtures) are untouched.
 */
export function spreadFullLiftTypes(days: DaySlot[]): void {
  const liftDays = days
    .map((d, i) => (dayHas(d, isLift) ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => (CAL_INDEX[days[a]!.day] ?? 0) - (CAL_INDEX[days[b]!.day] ?? 0));
  if (liftDays.length < 2) return;

  const fullDays = liftDays.filter((i) => dayHas(days[i]!, isFullLift));
  const f = fullDays.length;
  if (f < 2) return;

  const minGap = (idxs: number[]): number => {
    let m = Infinity;
    for (let a = 0; a < idxs.length; a++)
      for (let b = a + 1; b < idxs.length; b++) m = Math.min(m, calGap(days, idxs[a]!, idxs[b]!));
    return m;
  };
  // Already >=2 days apart (calendar gap >= 3)? Leave everything as-is.
  if (minGap(fullDays) >= 3) return;

  // Pick which lift days should be "full": maximize the smallest gap between full
  // days (never consecutive if avoidable), then total spread, then keep the most
  // of the current full days to minimize churn.
  let best: number[] | null = null;
  let bestKey: [number, number, number] = [-1, -1, -1];
  for (const combo of kSubsets(liftDays, f)) {
    let mn = Infinity;
    let sum = 0;
    for (let a = 0; a < combo.length; a++)
      for (let b = a + 1; b < combo.length; b++) {
        const g = calGap(days, combo[a]!, combo[b]!);
        mn = Math.min(mn, g);
        sum += g;
      }
    const kept = combo.filter((i) => fullDays.includes(i)).length;
    const key: [number, number, number] = [mn, sum, kept];
    if (
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] &&
        (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))
    ) {
      bestKey = key;
      best = combo;
    }
  }
  if (!best || minGap(best) <= minGap(fullDays)) return; // no improvement available

  // The non-full lift types, kept in day order so we reassign them stably to the
  // lift days that are no longer "full".
  const nonFullTypes = liftDays
    .filter((i) => !best!.includes(i))
    .map((i) => {
      const lift = days[i]!.sessions.find(isLift);
      return lift && lift.kind === "lift" && lift.liftType !== "full" ? lift.liftType : "power";
    });
  let nf = 0;
  for (const i of liftDays) {
    const lift = days[i]!.sessions.find(isLift);
    if (!lift || lift.kind !== "lift") continue;
    lift.liftType = best.includes(i) ? "full" : (nonFullTypes[nf++] ?? "power");
  }
}

/**
 * Enforce lift-day recovery separation. First relabels which lift days carry the
 * heavy "full" session so two full-body lifts are never consecutive (works even
 * when the week is too dense to move a lift). Then repeatedly fixes the worst
 * remaining spacing violation (full-body-on-consecutive-days first, then the
 * largest gap shortfall) by relocating one lift of the offending pair.
 * Best-effort on the relocation step: it stops when no legal destination remains.
 */
export function separateLiftDays(days: DaySlot[], protectedDays: Set<TrainingDayName>): void {
  spreadFullLiftTypes(days);
  for (let guard = 0; guard < days.length * 6; guard++) {
    const liftDays = days.map((d, i) => (dayHas(d, isLift) ? i : -1)).filter((i) => i >= 0);
    let worst: { i: number; j: number; sev: number } | null = null;
    for (let a = 0; a < liftDays.length; a++) {
      for (let b = a + 1; b < liftDays.length; b++) {
        const i = liftDays[a]!;
        const j = liftDays[b]!;
        const gap = calGap(days, i, j);
        const need = requiredLiftGap(days, i, j);
        if (gap >= need) continue;
        const bothFull = dayHas(days[i]!, isFullLift) && dayHas(days[j]!, isFullLift);
        const sev = (bothFull ? 1000 : 0) + (need - gap);
        if (!worst || sev > worst.sev) worst = { i, j, sev };
      }
    }
    if (!worst) break;
    const later = bestLiftDay(days, worst.j, protectedDays);
    if (later !== -1) {
      moveLiftTo(days, worst.j, later);
      continue;
    }
    const earlier = bestLiftDay(days, worst.i, protectedDays);
    if (earlier !== -1) {
      moveLiftTo(days, worst.i, earlier);
      continue;
    }
    break; // nowhere legal to move — best-effort
  }
}
