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
import { applyBandZoneShift, bandTriHours, startVolumeReadiness } from "../time-budget";
import { spreadPatternSessions, applyWeeklySetVolume } from "../strength";
import { trainingCaps, MAX_SESSIONS_PER_DAY, type TrainingCaps } from "../caps";
import { bandMaxWeeklyMinutes } from "../time-budget";
import { STRENGTH_SESSION_MIN, runOverhead } from "@/lib/session-volume";
import type {
  EngineInput,
  EngineRace,
  ExperienceLevel,
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

const SWIM_ZONE: Record<string, number> = {
  technique: 2,
  css: 4,
  threshold: 4,
  endurance: 2,
  open_water: 2,
};
const BIKE_ZONE: Record<string, number> = {
  endurance: 2,
  sweet_spot: 3,
  threshold: 4,
  vo2: 5,
  recovery: 1,
};

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

/**
 * How much bigger the week's KEY session is than an ordinary one of the same
 * discipline. The builder has always sized the long ride and the long run at
 * 1.4x their discipline's per-session share; naming the number lets the CEILING
 * be built from the same shape the session was built from, so an ordinary ride
 * or run can never be scaled up past the key one it is supposed to support.
 */
const LONG_SESSION_MULTIPLE = 1.4;

/** Longest Z2 run tail on the aerobic long-ride brick (its construction bound). */
const BRICK_TAIL_MAX_MIN = 30;

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

// --- long-SWIM model: phase-gated duration cap ------------------------------
/**
 * The swim's phase-gated ceiling (Levi to confirm the NUMBERS, 2026-09-09).
 *
 * Two things are worth separating here. That the swim needs a ceiling AT ALL is
 * not a policy question — it is the same defect that had just been fixed for the
 * run and the ride arriving in the third discipline. Once those two carry caps,
 * the swim is the only session left that will absorb whatever the week's time
 * target has spare, and the fitter duly gave it: measured over 576 generated
 * weeks, swims past two hours went from 424 to 577 and swims past two and a half
 * from 258 to 473, topping out at a **300-minute — FIVE HOUR — swim in an
 * OLYMPIC-distance program**, whose race swim is 1500 m. Nothing bounded it but
 * `caps.cardioSession`, which is a statement about the athlete's longest Zone 2
 * BLOCK and was written with the long ride in mind.
 *
 * The NUMBERS below are a different matter and are Levi's to confirm. They are
 * not derived from a race-distance table on purpose — there is no swim distance
 * anywhere in `SportConfig`, and inventing one to divide by an assumed pace
 * would dress a judgement up as a calculation. They are stated directly, and
 * sanity-checked against the race distances through the engine's own pace model
 * (`swimContent`, ~51 m/min including rest and turns at a 1:45/100 m CSS):
 *
 *   olympic  75 peak / 60 standard  -> ~3.8 km / ~3.1 km   (race 1500 m)
 *   70_3     90 peak / 75 standard  -> ~4.6 km / ~3.8 km   (race 1900 m)
 *   140_6   120 peak / 100 standard -> ~6.2 km / ~5.1 km   (race 3800 m)
 *
 * Each is a plausible upper bound for a peak-week long swim in that distance —
 * roughly 1.5x race distance for the 140.6, more for the short courses, where
 * the session is limited by what a pool session sensibly is rather than by the
 * race. The non-peak figure is ~0.8x the peak one, the same shape the run and
 * ride caps already use. All three are CEILINGS reached only in the top hours
 * bands, not prescriptions.
 */
const LONG_SWIM_CAP: Record<string, { peak: number; standard: number }> = {
  "140_6": { peak: 120, standard: 100 },
  "70_3": { peak: 90, standard: 75 },
  olympic: { peak: 75, standard: 60 },
};
function longSwimCapMin(cfg: SportConfig, phase: PhaseName): number {
  const c = LONG_SWIM_CAP[distanceKey(cfg.id)] ?? LONG_SWIM_CAP["70_3"]!;
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
function balanceFor(
  cfg: SportConfig,
  phase: PhaseName,
): { swim: number; bike: number; run: number } {
  const b =
    cfg.volume.kind === "per_discipline" ? cfg.volume.disciplineBalanceByPhase[phase] : undefined;
  return { swim: b?.["swim"] ?? 0.2, bike: b?.["bike"] ?? 0.5, run: b?.["run"] ?? 0.3 };
}

// --- cardio slot generation -------------------------------------------------

/**
 * A slot's own ceiling in SESSION-TOTAL minutes, keyed by slot identity.
 *
 * The phase caps (`longRunCapMin`, `longRideCapMin`) are decided when the week
 * is BUILT and have to survive into the rescaler, which otherwise knows only
 * `caps.session` / `caps.cardioSession` and would happily undo them. Keying by
 * object identity rather than index is deliberate: `distributeCardio` returns a
 * SUBSET of these same slot objects and `fitTriSlotsToTarget` is then run again
 * over that subset, so an index-based table would silently mis-align and hand a
 * run the long ride's ceiling.
 *
 * Anything absent is unbounded here and falls back to `triSlotCap` alone.
 */
type SlotCeilings = Map<SessionSlot, number>;

/**
 * The largest this brick can be scaled to with NEITHER leg past its own cap.
 *
 * `scaleSlot` grows a brick pro rata, so bounding the session total is not the
 * same as bounding the ride inside it: a 240-minute ceiling on a brick that is
 * 90% bike is a 216-minute ride whatever the long-ride cap says. Scaling the
 * whole session by the tightest per-leg factor is the only bound that holds,
 * and it also works downward — a brick built over its ride cap gets a ceiling
 * BELOW its current size, so the first clamp pass pulls it back.
 */
function brickCeiling(
  segments: { discipline: string; durationMin: number }[],
  bikeCapMin: number,
  runCapMin: number,
): number {
  const bike = segments.reduce((a, x) => a + (x.discipline === "bike" ? x.durationMin : 0), 0);
  const run = segments.reduce((a, x) => a + (x.discipline === "run" ? x.durationMin : 0), 0);
  const total = bike + run;
  if (total <= 0) return Number.POSITIVE_INFINITY;
  let factor = Number.POSITIVE_INFINITY;
  if (bike > 0) factor = Math.min(factor, bikeCapMin / bike);
  if (run > 0) factor = Math.min(factor, runCapMin / run);
  // Floor, not round: `scaleSlot` rounds each segment, and a half-minute of
  // rounding up on the ride is still a ride over its cap.
  return Math.floor(total * factor);
}

/**
 * Build the swim / bike / run / brick slots for one week's cardio minutes.
 * The long ride is emitted as a discrete Z2 bike→run BRICK (feature B); the long
 * run is a capped ramp (feature A). Strength is placed separately (feature C).
 *
 * Returns each slot WITH the ceiling it was built under. Until 2026-09-09 it
 * returned the slots alone: the phase caps were applied here and then thrown
 * away, because `fitTriSlotsToTarget` re-scaled every slot against `triSlotCap`
 * and nothing else. Measured across 576 generated triathlon weeks, that left
 * 634 runs past their own phase long-run cap (worst +230 min), 153 long-ride
 * legs past the long-ride cap, and — because the long run was the ONLY run
 * carrying a cap, so every surplus minute landed on the uncapped easy runs — a
 * **290-minute "easy" run in an OLYMPIC-distance build**, whose race run is
 * 10 km and whose long run that week was capped at 60. And in 231 of those 576
 * weeks (40%) the long run was not the longest run of the week measured in
 * running minutes — 256 (44%) measured in session total: the identical
 * inversion that took a long fix on the HYROX side, arriving by another road.
 */
function triCardioSlots(
  phase: PhaseName,
  totalMin: number,
  cfg: SportConfig,
  idx: number,
  caps: TrainingCaps,
): { slots: SessionSlot[]; ceilings: SlotCeilings } {
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
  const longSwimCap = longSwimCapMin(cfg, phase);

  // The long run's ceiling in SESSION-TOTAL minutes — the currency the fitter
  // and `caps` both speak. Two separate ceilings meet here and the tighter wins:
  // the phase cap, which is a question about the RACE, and `caps.longRun`, which
  // is a question about the ATHLETE (150 for a triathlete, or their band session
  // cap when that is higher). `caps.longRun` was never consulted on this path at
  // all, which is how a beginner in a 5-10 h band could still be handed the
  // 140.6 peak long run in full.
  const longRunTotalCap = Math.min(longRunCap + runOverhead("long"), caps.longRun);
  const longRunDurCap = Math.max(20, longRunTotalCap - runOverhead("long"));
  // ...and everything ELSE is held below the key session of its discipline, at
  // exactly the ratio the builder used to size them apart in the first place.
  // Without this the caps are still trivially defeated: the fitter has to put
  // the week's surplus somewhere, and a cap on the long run alone just redirects
  // it into the easy runs — which is how the longest run of an Olympic week
  // became a 290-minute easy run sitting beside a 60-minute long run.
  const easyRunDurCap = Math.max(20, Math.round(longRunDurCap / LONG_SESSION_MULTIPLE));
  const rideDurCap = Math.max(20, Math.round(longRideCap / LONG_SESSION_MULTIPLE));
  const swimDurCap = Math.max(20, Math.round(longSwimCap / LONG_SESSION_MULTIPLE));

  const slots: SessionSlot[] = [];
  const ceilings: SlotCeilings = new Map();

  // Swim — every swim is built at the same share, so which one is allowed to be
  // the week's LONG swim is a designation, exactly as `k === 0` designates the
  // long ride and the long run. It is the LAST slot rather than the first, and
  // for a reason: outside base the first swim is the week's CSS set, which is
  // Zone 4 and therefore already held to `caps.session` by `triSlotCap`. The
  // swim that can actually run away is the aerobic one — the endurance swim
  // outside base, a technique swim within it — and that is the one carrying the
  // long-swim allowance here. Everything else is held below it at the same ratio
  // the runs use, so the surplus cannot simply relocate into a technique swim.
  for (let k = 0; k < swimN; k++) {
    const sessionType =
      k === 0 && phase !== "base" ? "css" : phase === "base" ? "technique" : "endurance";
    const isLongSwim = k === swimN - 1;
    const cap = isLongSwim ? longSwimCap : swimDurCap;
    const swim: SessionSlot = {
      kind: "swim",
      goalZone: SWIM_ZONE[sessionType]!,
      durationMin: Math.min(swimMin, cap),
      sessionType,
    };
    slots.push(swim);
    ceilings.set(swim, cap);
  }

  // Bike — k === 0 is the weekly long ride, now a discrete Z2 brick (feature B).
  for (let k = 0; k < bikeN; k++) {
    if (k === 0) {
      const bikeLongMin = Math.min(Math.round(bikeMin * LONG_SESSION_MULTIPLE), longRideCap);
      const runTail = clampInt(runMin * 0.3, 15, BRICK_TAIL_MAX_MIN); // short Z2 run off the bike
      const brick: SessionSlot = {
        kind: "brick",
        goalZone: 2, // Z2 marks this as the aerobic long-ride brick (vs. Z3 race bricks)
        segments: [
          { discipline: "bike", durationMin: bikeLongMin, goalZone: 2 },
          { discipline: "run", durationMin: runTail, goalZone: 2 },
        ],
      };
      slots.push(brick);
      ceilings.set(brick, brickCeiling(brick.segments, longRideCap, BRICK_TAIL_MAX_MIN));
      continue;
    }
    const sessionType = phase === "build" || phase === "peak" ? "sweet_spot" : "endurance";
    const ride: SessionSlot = {
      kind: "bike",
      goalZone: BIKE_ZONE[sessionType]!,
      durationMin: bikeMin,
      isLong: false,
      sessionType,
    };
    slots.push(ride);
    ceilings.set(ride, rideDurCap);
  }

  // Run — k === 0 is the long run: min(1.4× easy, phase cap) (feature A).
  for (let k = 0; k < runN; k++) {
    const isLong = k === 0;
    const runType = isLong
      ? "long"
      : k === 1 && (phase === "build" || phase === "peak")
        ? "tempo"
        : "easy";
    const durationMin = isLong
      ? Math.min(Math.round(runMin * LONG_SESSION_MULTIPLE), longRunDurCap)
      : Math.min(runMin, easyRunDurCap);
    const run: SessionSlot = {
      kind: "run",
      runType,
      goalZone: runType === "tempo" ? 3 : 2,
      isLong,
      durationMin,
    };
    slots.push(run);
    ceilings.set(
      run,
      isLong ? longRunTotalCap : Math.min(easyRunDurCap, longRunDurCap - 1) + runOverhead(runType),
    );
  }

  // Dedicated mid-week race-specific bricks (Z3), kept as-is.
  for (let k = 0; k < brickN; k++) {
    const bikeSeg = Math.round(bikeMin * (phase === "peak" ? 1.6 : 1.2));
    const runSeg = Math.min(90, Math.round(runMin * 0.7));
    const brick: SessionSlot = {
      kind: "brick",
      goalZone: 3,
      segments: [
        { discipline: "bike", durationMin: bikeSeg, goalZone: 2 },
        { discipline: "run", durationMin: runSeg, goalZone: 3 },
      ],
    };
    slots.push(brick);
    // A mid-week brick is race REHEARSAL, not the week's key aerobic work: its
    // ride is held under the long ride's cap and its run leg under an ordinary
    // run's, so the session that is supposed to be the biggest one still is.
    ceilings.set(brick, brickCeiling(brick.segments, longRideCap, easyRunDurCap));
  }

  return { slots, ceilings };
}

/**
 * The cap a triathlon session is held to.
 *
 * Same rule as the station-hybrid side (Levi, 2026-08-04): a ZONE 1-2 session is
 * limited by time, not by recovery cost, so it gets the long `cardioSession` cap
 * — that is the long ride and the aerobic long-ride brick, which are the whole
 * point of a big triathlon week. Anything at Zone 3+ is quality work and is held
 * to the ordinary `session` cap.
 */
function triSlotCap(slot: SessionSlot, caps: TrainingCaps): number {
  const zone =
    slot.kind === "lift" || slot.kind === "race" || slot.kind === "rest" ? 0 : slot.goalZone;
  return zone <= 2 ? caps.cardioSession : caps.session;
}

/**
 * The ceiling a slot is actually held to: the athlete's cap AND the phase cap
 * the slot was built under, whichever is lower.
 *
 * This is the whole fix. `triSlotCap` answers "how long may THIS ATHLETE train
 * in one go" and is the only thing the rescaler ever asked. The phase caps
 * answer "how long should this session be FOR THIS RACE, in this phase" — a
 * different question with a different, usually much smaller, answer. Asking only
 * the first is how an Olympic-distance athlete on a 30-40 h band got sessions
 * sized for a 30-40 h athlete: the caps were computed, applied, and discarded
 * one function later.
 */
function slotCeiling(slot: SessionSlot, caps: TrainingCaps, ceilings?: SlotCeilings): number {
  const phase = ceilings?.get(slot) ?? Number.POSITIVE_INFINITY;
  return Math.min(triSlotCap(slot, caps), phase);
}

/**
 * What `sessionTiming` will report for this slot once it becomes a session.
 *
 * Swim, bike and brick are their prescribed duration exactly. A RUN also carries
 * a fixed warmup + cooldown on top of `durationMin` — miss that and every run in
 * the week is 10-15 minutes bigger than the number the fitter reasoned about,
 * which is exactly how a "960 minute" week shipped at 1000+.
 */
function slotTotalMinutes(slot: SessionSlot): number {
  if (slot.kind === "run") return (slot.durationMin ?? 40) + runOverhead(slot.runType);
  return slotMinutes(slot);
}

/** Set a slot so its SESSION TOTAL is `minutes` (brick segments scale pro rata). */
function scaleSlot(slot: SessionSlot, minutes: number): void {
  if (slot.kind === "brick") {
    const cur = slot.segments.reduce((a, x) => a + x.durationMin, 0) || 1;
    const f = minutes / cur;
    slot.segments.forEach((seg) => {
      seg.durationMin = Math.max(10, Math.round(seg.durationMin * f));
    });
    return;
  }
  if (slot.kind === "run") {
    slot.durationMin = Math.max(10, Math.round(minutes - runOverhead(slot.runType)));
    return;
  }
  if (slot.kind === "swim" || slot.kind === "bike") {
    slot.durationMin = Math.max(10, Math.round(minutes));
  }
}

/**
 * Hold the week's cardio slots to `totalMin`, and every slot to its own cap.
 *
 * The triathlon builder sizes each session from a SHARE of the weekly minutes and
 * then grows the important ones on top — the long ride is 1.4x its share plus a
 * run tail, the long run another 1.4x, the race bricks 1.2-1.6x. Nothing ever
 * added the result back up, so a week prescribed 960 minutes shipped **1789**
 * (an athlete who asked for 10-20 hours got 30), and a single long-ride brick
 * reached **666 minutes — 11 hours**. HYROX has been reconciled to its target
 * since the start; triathlon never was.
 *
 * Two passes: clamp each slot to its cap, then scale the whole set to the target.
 * The relative shape (long ride dominant, long run next) is preserved because
 * every slot scales by the same factor. If the caps alone can't reach the target,
 * the week lands short rather than shipping an 11-hour session.
 *
 * `ceilings` is the second half of that rule and was missing until 2026-09-09.
 * "Its own cap" used to mean `triSlotCap` alone — the athlete's session cap —
 * so the phase caps that `triCardioSlots` had just applied were re-scaled away
 * on the very next line. Passing them through is what makes the clamp mean
 * something. THE WEEKS GET SHORTER as a result, and that is the correct answer
 * rather than a regression: the surplus that used to land on an uncapped easy
 * run has nowhere legitimate to go, and hours win — a capped-out week lands
 * short and says so, exactly as it already did when the session caps bound.
 */
function fitTriSlotsToTarget(
  slots: SessionSlot[],
  totalMin: number,
  caps: TrainingCaps,
  ceilings?: SlotCeilings,
): void {
  const cardio = slots.filter((s) => s.kind !== "lift" && s.kind !== "race" && s.kind !== "rest");
  if (cardio.length === 0 || totalMin <= 0) return;

  for (const s of cardio) {
    const cap = slotCeiling(s, caps, ceilings);
    if (slotTotalMinutes(s) > cap) scaleSlot(s, cap);
  }

  // Scale toward the target, re-clamping anything the scale pushes over its cap
  // and re-spreading what that leaves behind. Two rounds converge in practice;
  // the loop is bounded regardless.
  for (let round = 0; round < 4; round++) {
    const current = cardio.reduce((a, s) => a + slotTotalMinutes(s), 0);
    if (current <= 0 || Math.abs(totalMin - current) <= 1) break;
    const factor = totalMin / current;
    let headroom = false;
    for (const s of cardio) {
      const cap = slotCeiling(s, caps, ceilings);
      const want = slotTotalMinutes(s) * factor;
      scaleSlot(s, Math.min(want, cap));
      if (slotTotalMinutes(s) < cap) headroom = true;
    }
    if (!headroom) break; // everything is at its ceiling — the week is as big as it can be
  }

  // Per-slot rounding can leave the week a minute or two OVER, which is enough to
  // push it past the band ceiling the caller sized against. Never round upward
  // out of the athlete's budget: shave the excess off the longest session.
  let excess = cardio.reduce((a, s) => a + slotTotalMinutes(s), 0) - totalMin;
  if (excess > 0) {
    const longest = cardio.reduce((a, b) => (slotTotalMinutes(b) > slotTotalMinutes(a) ? b : a));
    scaleSlot(longest, Math.max(10, slotTotalMinutes(longest) - excess));
  }
}

/**
 * Downgrade a week's cardio slots to active recovery for the week after a race
 * (feature D): cap durations, drop all bricks, and downgrade any hard swim/bike/
 * run to easy endurance. No vo2 / threshold / brick survives.
 */
function toActiveRecovery(slots: SessionSlot[]): { slots: SessionSlot[]; ceilings: SlotCeilings } {
  const out: SessionSlot[] = [];
  const ceilings: SlotCeilings = new Map();
  const keep = (slot: SessionSlot, ceiling: number) => {
    out.push(slot);
    ceilings.set(slot, ceiling);
  };
  for (const s of slots) {
    if (s.kind === "brick") continue; // no bricks in a recovery week
    if (s.kind === "swim") {
      const sessionType =
        s.sessionType === "threshold" || s.sessionType === "css" ? "endurance" : s.sessionType;
      keep(
        {
          ...s,
          sessionType,
          goalZone: SWIM_ZONE[sessionType]!,
          durationMin: Math.min(s.durationMin, RECOVERY_CAP.swim),
        },
        RECOVERY_CAP.swim,
      );
    } else if (s.kind === "bike") {
      keep(
        {
          kind: "bike",
          sessionType: "endurance",
          goalZone: BIKE_ZONE.endurance!,
          isLong: false,
          durationMin: Math.min(s.durationMin, RECOVERY_CAP.bike),
        },
        RECOVERY_CAP.bike,
      );
    } else if (s.kind === "run") {
      keep(
        {
          kind: "run",
          runType: "easy",
          goalZone: 2,
          isLong: false,
          durationMin: Math.min(s.durationMin ?? 40, RECOVERY_CAP.run),
        },
        RECOVERY_CAP.run + runOverhead("easy"),
      );
    } else {
      out.push(s);
    }
  }
  // The recovery caps are ceilings for the FITTER too, not just for this pass.
  // They were applied here and then scaled straight back out: a post-race week
  // whose target minutes exceeded what 30-minute runs and 90-minute rides could
  // hold simply grew them again, which is the same discard bug one layer up.
  return { slots: out, ceilings };
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

/**
 * Round-robin cardio slots across the training days, never putting a THIRD
 * session on a day (Levi, 2026-08-04 — two a day is absolute).
 *
 * The old version was a bare `days[i % days.length].push(...)`, so a week with
 * more slots than 2x the training days simply stacked them: real triathlon weeks
 * came out with THREE sessions on a day, every day. Slots that no longer fit are
 * returned to the caller, which folds their minutes back into the sessions that
 * did fit rather than dropping the training.
 */
function distributeCardio(
  trainingDays: EngineInput["trainingDays"],
  slots: SessionSlot[],
  reservedPerWeek = 0,
): { days: DaySlot[]; unplaced: SessionSlot[] } {
  const days: DaySlot[] = trainingDays.map((day) => ({ day, sessions: [] as SessionSlot[] }));
  // Leave room for the lifts that will be placed after us.
  const capacity = Math.max(0, days.length * MAX_SESSIONS_PER_DAY - reservedPerWeek);
  const placed = slots.slice(0, capacity);
  const unplaced = slots.slice(capacity);
  placed.forEach((s, i) => {
    days[i % days.length]!.sessions.push(s);
  });
  return { days, unplaced };
}

/**
 * Place `liftN` full-body strength slots (feature C): each lands on the
 * lowest-total-minutes day that is NOT a key aerobic (long) day, preferring
 * separate days (a placed lift raises that day's load for the next pick).
 */
function placeLifts(days: DaySlot[], liftN: number): void {
  for (let i = 0; i < liftN; i++) {
    const open = days.filter((d) => d.sessions.length < MAX_SESSIONS_PER_DAY);
    if (open.length === 0) return; // two a day is absolute — the lift is dropped, not stacked
    const eligible = open.filter((d) => !dayHasKeyAerobic(d));
    const pool = eligible.length > 0 ? eligible : open;
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
  caps: TrainingCaps,
): DaySlot[] {
  const raceWeek = !!ctx.raceThis;
  const isTaper = phase === "taper";
  const postRace = !ctx.raceThis && !!ctx.raceLast && !isTaper;

  let { slots, ceilings } = triCardioSlots(phase, totalMin, cfg, idx, caps);
  if (postRace) ({ slots, ceilings } = toActiveRecovery(slots));

  const liftN = raceWeek || postRace ? 0 : LIFT_BY_PHASE[phase];
  const raceSlots = raceWeek ? 1 : 0;

  // Hold the week to its prescribed minutes and every session to its cap BEFORE
  // placing anything — the day layout then only has legal sessions to place.
  fitTriSlotsToTarget(slots, totalMin, caps, ceilings);

  const { days, unplaced } = distributeCardio(input.trainingDays, slots, liftN + raceSlots);
  // Anything that could not get a slot gives its minutes back to the sessions
  // that did, so the week keeps its volume instead of silently losing a session.
  // This is the pass that used to do the most damage: fewer slots carrying the
  // same target means a bigger scale factor, and with nothing but the athlete's
  // session cap in the way it is where the 290-minute "easy" runs came from.
  // The ceilings travel with the slot objects, so the survivors keep theirs.
  if (unplaced.length > 0) {
    const placedSlots = days.flatMap((d) => d.sessions);
    fitTriSlotsToTarget(placedSlots, totalMin, caps, ceilings);
  }

  // After an A race: near-complete rest early — clear the first training day.
  if (postRace && ctx.raceLast!.priority === "A" && days.length > 0) days[0]!.sessions = [];

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
  const caps =
    input.caps ??
    trainingCaps(
      cfg.family,
      { runningExp: input.runningExp, hybridExp: input.hybridExp, liftingExp: input.liftingExp },
      input.weeklyHours,
    );
  const bandHours = input.weeklyHours ? bandTriHours(input.weeklyHours) : null;
  const hours =
    bandHours ??
    (cfg.volume.kind === "per_discipline"
      ? (cfg.volume.hoursPerWeekByLevel[key] ?? [8, 14])
      : [8, 14]);
  const [rawBaseH, peakH] = hours as [number, number];
  // Pitch the START toward the athlete's real current training frequency; the PEAK
  // is untouched, so the held level simply climbs a little more steeply to the same
  // place. No-op when `currentDaysPerWeek` wasn't supplied.
  const baseH = Math.min(
    peakH,
    rawBaseH * startVolumeReadiness(input.currentDaysPerWeek, input.trainingDays.length),
  );
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

    // Hold the week inside the band the athlete actually chose, lifts included —
    // the same ceiling the station-hybrid path gets (Levi, 2026-08-04). Triathlon
    // returns before `buildSkeleton`'s clamp, so it needs its own.
    // Must match assembleTriDays exactly, or the ceiling reserves the wrong number
    // of lift minutes and the week lands over the athlete's stated budget.
    const postRaceWeek = !raceThis && !!raceLast && !isTaper;
    const liftN = raceThis || postRaceWeek ? 0 : LIFT_BY_PHASE[phase];
    let totalMin = Math.round(hoursThis * 60);
    if (input.weeklyHours) {
      const ceiling = Math.max(
        0,
        bandMaxWeeklyMinutes(input.weeklyHours) - liftN * STRENGTH_SESSION_MIN,
      );
      totalMin = Math.min(totalMin, ceiling);
    }

    weeks.push({
      weekNumber,
      phase,
      microWeek: micro,
      targetMileage: 0,
      targetCardioMinutes: totalMin,
      zoneTargets: input.weeklyHours
        ? applyBandZoneShift(cfg.phaseZoneTargets[phase], input.weeklyHours)
        : { ...cfg.phaseZoneTargets[phase] },
      days: assembleTriDays(input, cfg, phase, totalMin, idx, { raceThis, raceLast }, caps),
      ...(raceThis
        ? {
            raceDay: {
              priority: raceThis.priority,
              ...(raceThis.date ? { date: raceThis.date } : {}),
            },
          }
        : {}),
    });
  }

  // The triathlon skeleton used to return NO caps at all, so nothing downstream
  // could bound a session — every guard the station-hybrid path has was silently
  // absent here.
  return {
    durationWeeks: D,
    trainingClass: input.trainingClass,
    allocation: alloc,
    weeks,
    needs: input.needs,
    restDays: input.restDays,
    caps,
  };
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
function bikeContent(
  type: string,
  durationMin: number,
  isLong: boolean | undefined,
  a: TriAnchors,
): string {
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
function brickContent(
  segments: { discipline: string; durationMin: number; goalZone: number }[],
): string {
  const bike = segments.find((s) => s.discipline === "bike");
  const run = segments.find((s) => s.discipline === "run");
  const long = (run?.goalZone ?? 3) <= 2;
  if (long) {
    const bikePart = bike ? `Ride ${bike.durationMin} min steady Zone 2` : "Ride the long bike";
    const runPart = run
      ? `run ${run.durationMin} min easy Zone 2 immediately off the bike`
      : "run easy off the bike";
    return `Long-ride brick — the aerobic cornerstone. ${bikePart}, rehearsing race fuel + hydration, then transition fast and ${runPart} to rehearse race legs. Hold form as your legs come around.`;
  }
  const bikePart = bike
    ? `Ride ${bike.durationMin} min building to Zone 2–3`
    : "Ride the bike segment";
  const runPart = run
    ? `run ${run.durationMin} min immediately off the bike`
    : "run immediately off the bike";
  return `Brick — bike→run in one session. ${bikePart}, then transition fast and ${runPart} at a controlled Zone 3 effort. Your legs feel heavy the first km — hold target pace through it. The single most race-specific session.`;
}

/** Canonical periodized full-body strength session (feature C).
 *
 *  Sets are a STARTING value only: `applyTriWeeklySetVolume` rewrites them from
 *  the athlete's lifting experience once the whole week is known, because weekly
 *  volume per pattern is a weekly property, not a per-session one. Reps, load
 *  emphasis and pattern selection stay triathlon-specific — a triathlete's lifts
 *  are not HYROX lifts, so this deliberately does NOT route through
 *  `applyStrengthSchemes`. */
function liftSession(phase: PhaseName): Session {
  const strength = phase === "build" || phase === "peak";
  const sets = strength ? 4 : 3;
  const repRange = strength ? "4-6" : "8-12";
  const emphasis: "strength" | "endurance" = strength ? "strength" : "endurance";
  const patterns: MovementPattern[] = [
    "squat",
    "hip_hinge",
    "horizontal_press",
    "horizontal_pull",
    "vertical_press",
  ];
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
          note:
            s.discipline === "run" ? "Off the bike — controlled effort, quick cadence." : undefined,
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
export function triWeekToProgramWeek(
  w: WeekSkeleton,
  anchors: TriAnchors = {},
  liftingExp: ExperienceLevel = "intermediate",
): ProgramWeek {
  const days: ProgramDay[] = w.days.map((d) => ({
    day: d.day,
    sessions: d.sessions
      .map((s) => slotToSession(s, anchors, w.phase))
      .filter((s): s is Session => s !== null),
  }));

  // Levi's weekly working-set rule (6 / 8 / 10 by lifting experience) applies to
  // triathletes too — it was HYROX/DEKA-only because the triathlon builder makes
  // its own lift sessions and never passed through assembly. Only `sets` is
  // rewritten; the tri-specific patterns, rep ranges and emphasis are untouched.
  const liftSessions = days
    .flatMap((d) => d.sessions)
    .filter((s): s is Extract<Session, { kind: "lift" }> => s.kind === "lift");
  spreadPatternSessions(liftSessions);
  applyWeeklySetVolume(liftSessions, liftingExp, w.microWeek);

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

export function buildTriProgramData(
  skeleton: ProgramSkeleton,
  anchors: TriAnchors = {},
  liftingExp: ExperienceLevel = "intermediate",
): ProgramData {
  return {
    generatedAt: new Date().toISOString(),
    weeks: skeleton.weeks.map((w) => triWeekToProgramWeek(w, anchors, liftingExp)),
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
    ? (input.races.find((r) => r.weekNumber === week.weekNumber) ?? {
        weekNumber: week.weekNumber,
        priority: week.raceDay.priority,
        date: week.raceDay.date,
      })
    : undefined;
  const raceLast = input.races.find((r) => r.weekNumber === week.weekNumber - 1);
  const caps =
    input.caps ??
    trainingCaps(
      cfg.family,
      { runningExp: input.runningExp, hybridExp: input.hybridExp, liftingExp: input.liftingExp },
      input.weeklyHours,
    );
  const days = assembleTriDays(
    input,
    cfg,
    week.phase,
    week.targetCardioMinutes,
    idx,
    { raceThis, raceLast },
    caps,
  );
  const skeletonWeek: WeekSkeleton = { ...week, days };
  return {
    skeletonWeek,
    programWeek: triWeekToProgramWeek(skeletonWeek, anchors, input.liftingExp),
  };
}
