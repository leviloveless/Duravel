/**
 * Periodized strength prescription (Review #4).
 *
 * Replaces the old flat model (full-body 5–7, upper/lower a fixed 12–15, a
 * static ~75–80% 5RM start, no plyometrics) with an evidence-based scheme:
 *
 *   - HEAVY, LOW-REP MAX STRENGTH drives the full-body day. Heavy strength +
 *     plyometrics improve running economy and delay fatigue far more than
 *     hypertrophy-rep work, and add little mass — which matters in a bodyweight-
 *     carrying 8 km event (Rønnestad & Mujika 2014; Blagrove 2018; Beattie 2017).
 *   - Upper/lower days run a MODERATE strength scheme (6–10 reps, dropping
 *     toward peak) — strength-biased, not the old hypertrophy 12–15.
 *   - The LUNGE pattern (HYROX sandbag lunges) keeps HIGH-REP MUSCULAR
 *     ENDURANCE — the one place high reps are sport-specific. The CHEST FLY runs
 *     high-rep too, for the opposite reason: it is an isolation movement and has
 *     no business carrying a heavy compound load.
 *   - Load PROGRESSES across the microcycle (intensity climbs on increase weeks,
 *     backs off on deloads) and is autoregulated with an RIR (reps-in-reserve)
 *     target (Helms 2016), so it isn't a static number.
 *   - A PLYOMETRIC / reactive element is added in Base and Build for RFD and
 *     tendon stiffness → running economy (Barnes & Kilding 2015).
 *
 * Deterministic + pure (engine owns the math, like the running side); assembly
 * applies these schemes over whatever the AI returned so strength is auditable
 * and periodized rather than guessed.
 */

import type { z } from "zod";
import { MovementPattern, StrengthEmphasis as StrengthEmphasisEnum } from "@/lib/schemas";
import type { EquipmentKey } from "@/lib/schemas";
import type { ExperienceLevel, MicroWeekType, PhaseName } from "./types";
import { clamp, round5, EPLEY_5RM_TO_1RM } from "./math";

// Derived from the canonical Zod enums (roadmap #2.5) — kills the LiftPattern /
// MovementPattern and StrengthEmphasis twins that were maintained by hand.
export type LiftPattern = z.infer<typeof MovementPattern>;
export type StrengthEmphasis = z.infer<typeof StrengthEmphasisEnum>;

export type LiftType = "upper" | "lower" | "full" | "power";

export interface MovementScheme {
  sets: number;
  repRange: string;
  intensityPct: number; // target % of 1RM
  rir: number; // reps in reserve (autoregulation cue)
  emphasis: StrengthEmphasis;
}

interface SchemeBase {
  sets: number;
  repRange: string;
  intensityPct: number;
  rir: number;
}

/** Heavy, low-rep max strength — the full-body day (economy driver). */
const MAX_STRENGTH: Record<PhaseName, SchemeBase> = {
  base: { sets: 4, repRange: "5-6", intensityPct: 78, rir: 3 },
  build: { sets: 4, repRange: "4-5", intensityPct: 83, rir: 2 },
  peak: { sets: 5, repRange: "3", intensityPct: 88, rir: 1 },
  taper: { sets: 3, repRange: "3", intensityPct: 85, rir: 2 },
};

/** Moderate strength — upper/lower compound work (reps drop toward peak). */
const STRENGTH: Record<PhaseName, SchemeBase> = {
  base: { sets: 3, repRange: "8-10", intensityPct: 70, rir: 3 },
  build: { sets: 3, repRange: "6-8", intensityPct: 75, rir: 2 },
  peak: { sets: 3, repRange: "5-6", intensityPct: 80, rir: 2 },
  taper: { sets: 2, repRange: "5-6", intensityPct: 78, rir: 2 },
};

/**
 * LIGHT full-body day (Levi, 2026-08-04). When a week carries more than one
 * full-body lift, the LATER one runs light — 12–15 reps at a submaximal load —
 * so the athlete isn't asked for two maximal-strength efforts in the same week
 * on top of the running. Heavy first while fresh, light second.
 */
const LIGHT_FULL: Record<PhaseName, SchemeBase> = {
  base: { sets: 3, repRange: "12-15", intensityPct: 58, rir: 3 },
  build: { sets: 3, repRange: "12-15", intensityPct: 60, rir: 3 },
  peak: { sets: 3, repRange: "12-15", intensityPct: 55, rir: 3 },
  taper: { sets: 2, repRange: "12-15", intensityPct: 50, rir: 3 },
};

/**
 * POWER / EXPLOSIVE — the dedicated power-day prescription (Levi, 2026-08-05).
 *
 * Before this existed, a `power` lift day routed straight into `MAX_STRENGTH` and
 * was indistinguishable from the heavy full-body day except that it had FEWER
 * patterns and MORE sets of each. A real generated week shipped a "power" session
 * of Front Squat / Push Press / Lat Pulldown at 6 x 4-5 @ 85% 1RM with 2 RIR plus
 * an 18-rep reverse lunge — 24 working sets of grinding, near-failure work. That
 * is the hardest session of the week and the precise opposite of power training,
 * which is defined by BAR SPEED, not by load.
 *
 * The physiology this encodes:
 *   - **Submaximal load, maximal intent.** Peak mechanical power for ballistic
 *     movements sits near 30-60% 1RM. Load climbs a little toward peak because the
 *     movements get more specific — never because the athlete grinds harder.
 *   - **2-3 reps.** Power is a RATE quality. The moment bar speed drops, the set
 *     has stopped training power and started training fatigue.
 *   - **Full recovery** (`POWER_REST_SECONDS`), not the 60-90 s a hypertrophy set
 *     takes. Most-skipped rule in the gym, and the one that decides whether the
 *     session trains power at all.
 *   - **Never near failure.** The RIR figures are high on purpose; the real
 *     stopping rule is velocity, which `POWER_CUE` states in words.
 */
const POWER: Record<PhaseName, SchemeBase> = {
  base: { sets: 4, repRange: "3", intensityPct: 45, rir: 5 },
  build: { sets: 4, repRange: "3", intensityPct: 55, rir: 4 },
  peak: { sets: 5, repRange: "2", intensityPct: 62, rir: 4 },
  taper: { sets: 3, repRange: "2", intensityPct: 55, rir: 4 },
};

/** Rest between power sets. Long on purpose — see `POWER`. */
export const POWER_REST_SECONDS = 165;

/**
 * What actually governs a power set, shown instead of a RIR figure — "2 reps in
 * reserve" invites an athlete to grind, and grinding is the exact failure mode
 * this session type exists to avoid.
 */
export const POWER_CUE = "move fast — end the set the moment bar speed drops";

/**
 * Total working sets allowed on a power day. Far below `MAX_SESSION_WORKING_SETS`
 * (24): quality collapses long before 24 sets of anything explosive, and the whole
 * point of the day is that it leaves the athlete fresher than it found them.
 */
export const MAX_POWER_SESSION_SETS = 12;

/** High-rep muscular endurance — the lunge pattern (HYROX sandbag lunges). */
const ENDURANCE: Record<PhaseName, SchemeBase> = {
  base: { sets: 3, repRange: "15", intensityPct: 55, rir: 3 },
  build: { sets: 3, repRange: "18", intensityPct: 55, rir: 2 },
  peak: { sets: 3, repRange: "20", intensityPct: 50, rir: 2 },
  taper: { sets: 2, repRange: "12", intensityPct: 50, rir: 3 },
};

/** Per-microcycle-week intensity delta (%1RM) — real load progression. */
const MICRO_INTENSITY_DELTA: Record<MicroWeekType, number> = {
  increase: 2,
  rebound: 0,
  deload: -6,
  taper: -3,
  race: -3,
};

/** Intensity ceilings by emphasis so autoregulation stays safe. */
const PCT_CAP: Record<StrengthEmphasis, number> = {
  max_strength: 90,
  strength: 85,
  endurance: 60,
  // Hard ceiling on a power day. Above roughly two-thirds of 1RM a "ballistic"
  // lift stops being ballistic — the bar decelerates through the back half of the
  // range and the session quietly becomes another heavy day, which is exactly the
  // bug this emphasis was introduced to fix.
  power: 67,
};
const PCT_FLOOR = 45;

/**
 * The lunge is the one HYROX-specific muscular-endurance pattern. A LIGHT
 * full-body day is muscular-endurance work throughout — 12–15 reps at a
 * submaximal load — so every pattern on it carries the endurance emphasis (which
 * is also what caps its intensity sensibly).
 */
export function patternEmphasis(
  pattern: LiftPattern,
  liftType: LiftType,
  light = false,
): StrengthEmphasis {
  if (light) return "endurance";
  // A POWER day is explosive throughout — checked BEFORE the lunge/fly overrides,
  // because on a power day the lunge is a split-squat JUMP, not a 20-rep carry.
  // (`chest_fly` never reaches a power day at all; see POWER_PATTERNS.)
  if (liftType === "power") return "power";
  // The lunge is HYROX's sport-specific muscular-endurance pattern. The chest fly
  // is a single-joint ISOLATION movement — loading it like a compound press is how
  // shoulders get hurt — so it also runs high-rep, whatever the day.
  if (pattern === "lunge" || pattern === "chest_fly") return "endurance";
  return liftType === "full" ? "max_strength" : "strength";
}

function baseScheme(emphasis: StrengthEmphasis, phase: PhaseName, light: boolean): SchemeBase {
  if (light) return LIGHT_FULL[phase];
  if (emphasis === "endurance") return ENDURANCE[phase];
  if (emphasis === "power") return POWER[phase];
  if (emphasis === "max_strength") return MAX_STRENGTH[phase];
  return STRENGTH[phase];
}

/**
 * The prescription for one movement given its pattern, the session's lift type,
 * and the week's phase + microcycle position.
 *
 * `light` marks the week's SECOND full-body session (see `LIGHT_FULL`): every
 * movement on it drops to 12–15 reps at a submaximal load. The `sets` returned
 * here are the per-session starting point — `applyStrengthSchemes` then rewrites
 * them so the WEEKLY total per pattern matches the athlete's target
 * (`weeklySetTarget`).
 */
export function movementScheme(
  pattern: LiftPattern,
  liftType: LiftType,
  phase: PhaseName,
  microWeek: MicroWeekType,
  light = false,
): MovementScheme {
  const emphasis = patternEmphasis(pattern, liftType, light);
  const b = baseScheme(emphasis, phase, light);
  const intensityPct = clamp(
    b.intensityPct + (MICRO_INTENSITY_DELTA[microWeek] ?? 0),
    PCT_FLOOR,
    PCT_CAP[emphasis],
  );
  return { sets: b.sets, repRange: b.repRange, intensityPct, rir: b.rir, emphasis };
}

// --- weekly working-set volume per pattern -----------------------------------
//
// Levi's rule (2026-08-04): weekly WORKING SETS per muscle / movement pattern are
// set by the athlete's LIFTING experience, not by the phase's per-session scheme.
// The per-session numbers above are a starting point; what the athlete actually
// accumulates over the week is what drives hypertrophy/strength adaptation, so the
// week is the unit that gets controlled.

/** Weekly working sets per movement pattern, by lifting experience. */
export const WEEKLY_SETS_PER_PATTERN: Record<ExperienceLevel, number> = {
  beginner: 6,
  intermediate: 8,
  advanced: 10,
};

/**
 * Recovery weeks carry a fraction of the target — a deload that kept full volume
 * would not be a deload. Intensity is handled separately by
 * `MICRO_INTENSITY_DELTA`; this is the volume side of the same idea.
 */
const WEEKLY_SET_FACTOR: Record<MicroWeekType, number> = {
  increase: 1,
  rebound: 1,
  deload: 0.6,
  taper: 0.5,
  race: 0.5,
};

/** Weekly working sets per pattern for this athlete in this microcycle week. */
export function weeklySetTarget(liftingExp: ExperienceLevel, microWeek: MicroWeekType): number {
  const base = WEEKLY_SETS_PER_PATTERN[liftingExp] ?? WEEKLY_SETS_PER_PATTERN.intermediate;
  return Math.max(1, Math.round(base * (WEEKLY_SET_FACTOR[microWeek] ?? 1)));
}

/**
 * Ceiling on the working sets ONE session may give ONE movement pattern.
 *
 * Levi's rule (2026-08-04, round 2): the weekly target is the goal, but a single
 * session still has to fit the hour it is billed at. Before this cap, a pattern
 * that appeared on only one lift day received its entire weekly target on that
 * day — an advanced athlete's upper day came out `Bench 10×8-10 / OHP 10×8-10 /
 * Row 10×8-10 / Pull-Up 10×8-10`, 40 working sets against a 45-minute working
 * block. Six sets of one pattern is already a hard, complete stimulus; past that
 * the marginal set buys less than the time it costs.
 *
 * The cap is a BACKSTOP, not the primary mechanism — `spreadPatternSessions`
 * runs first and gets most patterns onto two lift days, where 10 splits into
 * 5 + 5 and the cap never binds. It only bites when a pattern genuinely cannot
 * be trained twice (a one-lift deload week, an upper-only pattern with a single
 * upper day). In that case the WEEK lands short of target, deliberately: a
 * session the athlete cannot actually finish is worse than a week that admits
 * it fell 4 sets shy.
 */
export const MAX_SESSION_SETS_PER_PATTERN = 6;

/**
 * Ceiling on the TOTAL working sets in one strength session, across every
 * pattern it trains.
 *
 * The per-pattern cap alone does not bound a session: an upper/lower/full split
 * gives the FULL day every one of the seven patterns (it is the only lift type
 * that accepts all of them), so after spreading, an advanced full-body day came
 * out seven movements at five sets — 35 working sets. `STRENGTH_SESSION_MIN`
 * bills every strength session at a flat 60 minutes: 10 warmup, a 45-minute
 * WORKING BLOCK, 5 cooldown. Twenty-four sets in 45 minutes is ~1.9 min a set,
 * which is achievable at these rep ranges when movements are paired, and is
 * about the honest ceiling. Thirty-five is not.
 *
 * Chosen so a full week can still reach target: three lift sessions × 24 = 72
 * set-slots against the heaviest weekly demand (advanced, 7 patterns × 10 = 70).
 * Weeks with fewer lift days land short — correctly, because they are short.
 */
export const MAX_SESSION_WORKING_SETS = 24;

/**
 * Split a weekly set target across the sessions that train the pattern, in
 * calendar order. The remainder goes to the EARLIER sessions, which are the
 * heavier ones (the light full-body day is always the later one), so the extra
 * set lands on the quality work.
 *
 * Every session that trains a pattern gets at least one set — if a week somehow
 * trains a pattern more times than the target has sets to give, the weekly total
 * overshoots rather than prescribing a zero-set movement.
 *
 * No single session may exceed `MAX_SESSION_SETS_PER_PATTERN`. When the cap
 * binds, the surplus is offered to the other sessions first (they may still have
 * headroom) and only then dropped — so the week loses volume solely when there
 * is nowhere legal left to put it.
 */
export function splitWeeklySets(
  target: number,
  occurrences: number,
  cap: number = MAX_SESSION_SETS_PER_PATTERN,
): number[] {
  if (occurrences <= 0) return [];
  const base = Math.floor(target / occurrences);
  const remainder = target % occurrences;
  const shares = Array.from({ length: occurrences }, (_, i) =>
    Math.max(1, base + (i < remainder ? 1 : 0)),
  );

  // Redistribute anything the cap trims onto sessions that still have headroom,
  // earliest (heaviest) first. Whatever will not fit anywhere is dropped.
  let surplus = 0;
  for (let i = 0; i < shares.length; i++) {
    const share = shares[i] ?? 0;
    if (share > cap) {
      surplus += share - cap;
      shares[i] = cap;
    }
  }
  for (let i = 0; i < shares.length && surplus > 0; i++) {
    const headroom = cap - (shares[i] ?? 0);
    if (headroom <= 0) continue;
    const take = Math.min(headroom, surplus);
    shares[i] = (shares[i] ?? 0) + take;
    surplus -= take;
  }
  return shares;
}

/**
 * Which lift split a pattern belongs to. `full` and `power` days accept every
 * pattern; `upper`/`lower` days only accept their own.
 *
 * Lives here rather than in assembly because both the AI-assembled path
 * (HYROX/DEKA) and the deterministic triathlon builder need it.
 */
export const PATTERN_HOME: Record<LiftPattern, "upper" | "lower" | "full"> = {
  squat: "lower",
  hip_hinge: "lower",
  lunge: "lower",
  horizontal_press: "upper",
  vertical_press: "upper",
  horizontal_pull: "upper",
  vertical_pull: "upper",
  chest_fly: "upper",
};

/**
 * True when a lift day of this type may legitimately train this pattern.
 *
 * A POWER day is NOT a wildcard. It used to return true for everything, which is
 * how `spreadPatternSessions` came to treat it as a dumping ground for overflow
 * sets — the direct cause of power sessions shipping 6 sets of every pattern at
 * 85% 1RM. It now accepts only patterns with a real ballistic expression.
 */
export function acceptsPattern(liftType: LiftType, pattern: string): boolean {
  if (liftType === "power") return POWER_PATTERNS.includes(pattern as LiftPattern);
  if (liftType === "full") return true;
  return PATTERN_HOME[pattern as LiftPattern] === liftType;
}

/**
 * The shape the weekly-volume passes need from a lift session. Deliberately
 * structural — the AI-assembled `Session` and the triathlon builder's own lift
 * objects both satisfy it, so neither layer has to import the other.
 */
export interface VolumeMovement {
  pattern: LiftPattern;
  sets: number;
  repRange: string;
}
export interface VolumeSession {
  liftType: LiftType;
  movements: VolumeMovement[];
}

/**
 * Give every movement pattern at least TWO lift days in the week, where the
 * week's lift sessions allow it. Returns the patterns that gained a second day.
 *
 * The weekly set target is split across the sessions that train a pattern, so a
 * pattern appearing on ONE day received the whole target there — an advanced
 * upper day came out four movements at ten sets each, 40 working sets billed as
 * an hour. On a real 6-day HYROX build, 4.4 of the 7 patterns were trained only
 * once a week, so this was the common case, not the corner case.
 *
 * Training a pattern twice at half the volume is also better programming than
 * once at full volume — the same weekly sets, twice the practice, each session
 * recoverable. So spread first, cap second.
 *
 * A pattern only moves to a session whose `liftType` can legitimately train it,
 * and goes to the session carrying the FEWEST movements so the extra work lands
 * where there is room. Patterns with nowhere legal to go — a one-lift deload
 * week, an upper pattern with a single upper day and no full/power day — stay put
 * and `MAX_SESSION_SETS_PER_PATTERN` keeps them honest.
 *
 * Call BEFORE prescribing, so injected movements are scheme'd like any other.
 * `liftSessions` must be in calendar order; mutated in place.
 */
export function spreadPatternSessions<S extends VolumeSession>(liftSessions: S[]): LiftPattern[] {
  if (liftSessions.length < 2) return [];

  const homes = new Map<string, S[]>();
  for (const session of liftSessions) {
    for (const m of session.movements) {
      const list = homes.get(m.pattern);
      if (list) list.push(session);
      else homes.set(m.pattern, [session]);
    }
  }

  const added: LiftPattern[] = [];
  for (const [pattern, trained] of homes) {
    if (trained.length >= 2) continue;
    const candidates = liftSessions.filter(
      (s) => !trained.includes(s) && acceptsPattern(s.liftType, pattern),
    );
    if (candidates.length === 0) continue;
    // Fewest movements wins; ties go to the earlier (calendar-order) session.
    let target = candidates[0]!;
    for (const s of candidates) {
      if (s.movements.length < target.movements.length) target = s;
    }
    const repRange = target.liftType === "full" || target.liftType === "power" ? "5-7" : "12-15";
    target.movements.push({ pattern: pattern as LiftPattern, sets: 3, repRange });
    added.push(pattern as LiftPattern);
  }
  return added;
}

/**
 * Bring every lift session under `MAX_SESSION_WORKING_SETS` by MOVING sets to a
 * lighter session that trains the same pattern, and only dropping them when there
 * is nowhere left to move them.
 *
 * The per-pattern cap does not bound a session's total: on an upper/lower/full
 * split the FULL day is the only lift type that accepts all seven patterns, so
 * spreading concentrates every pattern there — advanced came out at 35 working
 * sets against a 45-minute working block. This pass rebalances that.
 *
 * Sets are shed from the pattern currently carrying the MOST sets in the
 * offending session (the biggest block gives first, so the session stays even),
 * and are re-homed on the session with the most remaining headroom that also
 * trains that pattern and is still under both caps. Weekly volume is preserved
 * whenever the week has room for it; a week that is genuinely too small keeps the
 * heaviest sessions full and lands under target rather than shipping an hour-long
 * session the athlete cannot finish. No movement drops below one set.
 */
export function capSessionWorkingSets<S extends VolumeSession>(liftSessions: S[]): void {
  const total = (s: S) => s.movements.reduce((n, m) => n + (m.sets ?? 0), 0);
  // A power day gets a much tighter ceiling than everything else — explosive
  // quality is gone long before 24 sets, and the day is supposed to leave the
  // athlete fresh (Levi, 2026-08-05).
  const ceiling = (s: S) =>
    s.liftType === "power" ? MAX_POWER_SESSION_SETS : MAX_SESSION_WORKING_SETS;

  for (const session of liftSessions) {
    // Bounded: every iteration removes exactly one set from this session.
    while (total(session) > ceiling(session)) {
      const donor = session.movements.reduce((best, m) =>
        (m.sets ?? 0) > (best.sets ?? 0) ? m : best,
      );
      if ((donor.sets ?? 0) <= 1) break; // nothing left to give without a zero-set movement
      donor.sets = (donor.sets ?? 0) - 1;

      // Re-home the set on the roomiest session that also trains this pattern.
      let receiver: VolumeMovement | undefined;
      let bestHeadroom = 0;
      for (const other of liftSessions) {
        if (other === session) continue;
        if (total(other) >= ceiling(other)) continue;
        const match = other.movements.find((m) => m.pattern === donor.pattern);
        if (!match || (match.sets ?? 0) >= MAX_SESSION_SETS_PER_PATTERN) continue;
        const headroom = ceiling(other) - total(other);
        if (headroom > bestHeadroom) {
          bestHeadroom = headroom;
          receiver = match;
        }
      }
      if (receiver) receiver.sets = (receiver.sets ?? 0) + 1;
    }
  }
}

/**
 * Rewrite each movement's `sets` so the WEEKLY total per movement pattern hits
 * the athlete's target, split across the sessions that train it (earlier =
 * heavier = the extra set), then bring every session under the working-set
 * ceiling. Only `sets` is touched — reps, load, emphasis and exercise selection
 * belong to whichever layer prescribed them, which is why the deterministic
 * triathlon lifts can share this without inheriting HYROX periodization.
 */
export function applyWeeklySetVolume<S extends VolumeSession>(
  liftSessions: S[],
  liftingExp: ExperienceLevel,
  microWeek: MicroWeekType,
): void {
  const target = weeklySetTarget(liftingExp, microWeek);
  const byPattern = new Map<string, VolumeMovement[]>();
  for (const session of liftSessions) {
    for (const m of session.movements) {
      const list = byPattern.get(m.pattern);
      if (list) list.push(m);
      else byPattern.set(m.pattern, [m]);
    }
  }
  for (const movements of byPattern.values()) {
    const shares = splitWeeklySets(target, movements.length);
    movements.forEach((m, i) => {
      m.sets = shares[i] ?? m.sets;
    });
  }
  capSessionWorkingSets(liftSessions);
}

// --- A/B exercise variation (Tasks #10) --------------------------------------
//
// Each movement PATTERN carries two interchangeable exercise variants — an "A"
// and a "B". The engine alternates them by week so the athlete isn't grinding
// the identical lift every session (a common overuse driver); both variants
// train the same pattern with slightly different mechanics, so periodization and
// emphasis are unchanged. Variant A on odd program weeks, B on even.

export type ABExercise = readonly [a: string, b: string];

/** A (odd weeks) / B (even weeks) exercise per movement pattern. */
/**
 * What each exercise needs. An exercise with an EMPTY list needs nothing — it is
 * a bodyweight movement and is always available.
 *
 * Used to substitute a movement the athlete cannot actually perform. Onboarding
 * has collected an equipment list since the field shipped and told athletes
 * "we'll factor it in as this feature rolls out" — nothing ever read it, so a
 * bodyweight-only athlete was still being prescribed "Back Squat — 4 x 5-6 @ 285
 * lbs" (Levi, backlog #17).
 */
export const EXERCISE_EQUIPMENT: Record<string, EquipmentKey[]> = {
  // Squat
  "Back Squat": ["barbell", "squat_rack"],
  "Front Squat": ["barbell"],
  "Goblet Squat": ["dumbbells"],
  "Kettlebell Goblet Squat": ["kettlebells"],
  "Bodyweight Squat": [],
  // Hip hinge
  "Conventional Deadlift": ["barbell"],
  "Romanian Deadlift": ["barbell"],
  "Dumbbell Romanian Deadlift": ["dumbbells"],
  "Kettlebell Swing": ["kettlebells"],
  "Single-Leg Hip Hinge": [],
  // Lunge
  "Walking Lunge": [],
  "Reverse Lunge": [],
  // Horizontal press
  "Barbell Bench Press": ["barbell", "bench"],
  "Dumbbell Bench Press": ["dumbbells", "bench"],
  "Dumbbell Floor Press": ["dumbbells"],
  "Push-Up": [],
  // Vertical press
  "Standing Overhead Press": ["barbell"],
  "Push Press": ["barbell"],
  "Dumbbell Shoulder Press": ["dumbbells"],
  "Pike Push-Up": [],
  // Horizontal pull
  "Barbell Bent-Over Row": ["barbell"],
  "Chest-Supported Row": ["dumbbells", "bench"],
  "Dumbbell Bent-Over Row": ["dumbbells"],
  "Inverted Row": ["pull_up_bar"],
  "Prone Y-T-W Raise": [],
  // Vertical pull
  "Pull-Up": ["pull_up_bar"],
  "Lat Pulldown": ["pull_up_bar"],
  "Band Lat Pulldown": [],
  // Chest fly
  "Dumbbell Chest Fly": ["dumbbells"],
  "Cable Chest Fly": ["dumbbells"],
  "Wide Push-Up": [],
};

/**
 * Substitution ladder per pattern, best first. `pickExercise` walks this when the
 * athlete's equipment rules out the A/B variant, so the pattern is still trained
 * with whatever they actually own — ending in a bodyweight movement that always
 * works.
 */
export const EXERCISE_FALLBACKS: Record<LiftPattern, string[]> = {
  squat: [
    "Back Squat",
    "Front Squat",
    "Goblet Squat",
    "Kettlebell Goblet Squat",
    "Bodyweight Squat",
  ],
  hip_hinge: [
    "Conventional Deadlift",
    "Romanian Deadlift",
    "Dumbbell Romanian Deadlift",
    "Kettlebell Swing",
    "Single-Leg Hip Hinge",
  ],
  lunge: ["Walking Lunge", "Reverse Lunge"],
  horizontal_press: [
    "Barbell Bench Press",
    "Dumbbell Bench Press",
    "Dumbbell Floor Press",
    "Push-Up",
  ],
  vertical_press: [
    "Standing Overhead Press",
    "Push Press",
    "Dumbbell Shoulder Press",
    "Pike Push-Up",
  ],
  horizontal_pull: [
    "Barbell Bent-Over Row",
    "Chest-Supported Row",
    "Dumbbell Bent-Over Row",
    "Inverted Row",
    "Prone Y-T-W Raise",
  ],
  vertical_pull: ["Pull-Up", "Lat Pulldown", "Band Lat Pulldown"],
  chest_fly: ["Dumbbell Chest Fly", "Cable Chest Fly", "Wide Push-Up"],
};

/** True when the athlete's kit covers everything this exercise needs. */
export function canPerform(exercise: string, equipment?: readonly EquipmentKey[]): boolean {
  // No list = we don't know what they have, so assume a full gym. This is what
  // keeps every existing program byte-identical.
  if (!equipment || equipment.length === 0) return true;
  const needs = EXERCISE_EQUIPMENT[exercise];
  if (!needs) return true; // unknown exercise (AI-authored) — don't second-guess it
  if (needs.length === 0) return true; // bodyweight
  if (equipment.includes("bodyweight_only")) return false;
  return needs.every((n) => equipment.includes(n));
}

/** A movement that needs nothing — no %1RM load should be suggested for it. */
export function isBodyweight(exercise: string): boolean {
  return EXERCISE_EQUIPMENT[exercise]?.length === 0;
}

/**
 * Does the athlete's 5RM benchmark apply to this exercise?
 *
 * The benchmarks are barbell squat / deadlift / bench numbers. Projecting them
 * onto a substituted variant produced nonsense — a "Goblet Squat — 285 lbs" and a
 * "Dumbbell Romanian Deadlift — 370 lbs". Only a BARBELL movement inherits the
 * absolute load; everything else keeps the %1RM + RIR cue with no number, which
 * is the honest prescription when we don't know their dumbbell strength.
 */
export function usesBarbellBenchmark(exercise: string): boolean {
  return EXERCISE_EQUIPMENT[exercise]?.includes("barbell") ?? false;
}

export const EXERCISE_AB: Record<LiftPattern, ABExercise> = {
  squat: ["Back Squat", "Front Squat"],
  hip_hinge: ["Conventional Deadlift", "Romanian Deadlift"],
  lunge: ["Walking Lunge", "Reverse Lunge"],
  horizontal_press: ["Barbell Bench Press", "Dumbbell Bench Press"],
  vertical_press: ["Standing Overhead Press", "Push Press"],
  horizontal_pull: ["Barbell Bent-Over Row", "Chest-Supported Row"],
  vertical_pull: ["Pull-Up", "Lat Pulldown"],
  chest_fly: ["Dumbbell Chest Fly", "Cable Chest Fly"],
};

/**
 * The patterns a power day must not ship without (Levi's live program, 2026-08-05).
 *
 * Two regressions showed up together once `acceptsPattern("power", …)` stopped
 * being a wildcard, one of them visible on Levi's real Wednesday:
 *
 *   1. **All-upper power days.** His session came back Med-Ball Chest Pass /
 *      Kettlebell High Pull / Push Press / Explosive Barbell Row — four upper
 *      patterns, no jump, no swing. For a HYROX athlete that is the wrong half of
 *      the body: sled push, wall balls and burpee broad jumps are all lower-body
 *      triple extension. A deterministic sweep put 10% of power sessions in that
 *      state, up from 0% before.
 *   2. **Empty power days.** Non-empty power sessions fell 224 -> 160 across the
 *      same sweep, because patterns the power day now refuses (chest fly) used to
 *      be what filled it.
 *
 * `ensurePowerSessionPatterns` fixes both: a power session always trains at least
 * one of squat/hip_hinge, and is never left with nothing.
 */
const POWER_LOWER_PATTERNS: readonly LiftPattern[] = ["squat", "hip_hinge"];

/** The shape a power day falls back to when nothing usable survived filtering. */
const POWER_DEFAULT_PATTERNS: readonly LiftPattern[] = [
  "hip_hinge",
  "squat",
  "vertical_press",
  "horizontal_pull",
];

/**
 * Guarantee a power session is trainable and lower-body-inclusive.
 *
 * Runs BEFORE the schemes are applied so injected movements get prescribed like
 * any other. Mutates in place; returns nothing. A no-op on a session that already
 * carries a squat or hinge, which is the common case.
 */
export function ensurePowerSessionPatterns<
  S extends {
    liftType: LiftType;
    movements: { pattern: LiftPattern; sets: number; repRange: string }[];
  },
>(session: S, weekNumber = 1): void {
  if (session.liftType !== "power") return;
  const have = new Set(session.movements.map((m) => m.pattern));

  if (session.movements.length === 0) {
    for (const pattern of POWER_DEFAULT_PATTERNS) {
      session.movements.push({ pattern, sets: 3, repRange: "3" });
      have.add(pattern);
    }
    return;
  }

  if (POWER_LOWER_PATTERNS.some((p) => have.has(p))) return;
  // Alternate which lower pattern is added so consecutive weeks differ.
  const pick = POWER_LOWER_PATTERNS[(weekNumber - 1) % POWER_LOWER_PATTERNS.length]!;
  // Lower-body power leads the session — it is the most transferable work and
  // wants the freshest nervous system.
  session.movements.unshift({ pattern: pick, sets: 3, repRange: "3" });
}

/**
 * Ballistic + sport-transfer movements for a POWER day (Levi, 2026-08-05 —
 * "ballistic + sport transfer").
 *
 * A power day cannot just re-use `EXERCISE_AB`: a Back Squat at 45% is a slow
 * squat, not a power movement. Each pattern maps instead to something genuinely
 * ballistic — the athlete either leaves the ground, throws an implement, or
 * accelerates through the whole range with nothing to decelerate against.
 *
 * The B slot of each pair leans HYROX/DEKA-specific wherever the pattern has a
 * station analogue, so the day transfers to the race rather than staying abstract:
 * sled push (compromised horizontal drive), wall ball (triple extension into a
 * throw), sandbag over shoulder, burpee broad jump.
 *
 * Ordered like `EXERCISE_FALLBACKS`: most equipment-hungry first, ending in
 * something a bodyweight-only athlete can do, so no equipment profile can leave a
 * power slot unfillable.
 */
export const POWER_EXERCISE: Record<LiftPattern, string[]> = {
  squat: ["Trap-Bar Jump", "Jump Squat", "Box Jump"],
  hip_hinge: ["Hang High Pull", "Kettlebell Swing", "Broad Jump"],
  lunge: ["Dumbbell Split-Squat Jump", "Sandbag Over-Shoulder", "Split-Squat Jump"],
  horizontal_press: ["Med-Ball Chest Pass", "Sled Push", "Plyo Push-Up"],
  vertical_press: ["Push Press", "Wall Ball", "Med-Ball Overhead Throw"],
  horizontal_pull: ["Explosive Barbell Row", "Med-Ball Rotational Throw", "Burpee Broad Jump"],
  vertical_pull: ["Kettlebell High Pull", "Explosive Lat Pulldown", "Explosive Pull-Up"],
  // chest_fly never reaches a power day — see POWER_PATTERNS.
  chest_fly: ["Med-Ball Chest Pass", "Plyo Push-Up"],
};

/**
 * Patterns a POWER day may train. `chest_fly` is deliberately absent: a
 * single-joint isolation movement has no explosive expression and no place on a
 * day built around whole-body rate of force development. Everything else has a
 * legitimate ballistic variant in `POWER_EXERCISE`.
 */
export const POWER_PATTERNS: readonly LiftPattern[] = [
  "squat",
  "hip_hinge",
  "lunge",
  "horizontal_press",
  "vertical_press",
  "horizontal_pull",
  "vertical_pull",
];

/**
 * The specific exercise for a pattern on a given program week. Odd weeks → the A
 * variant, even weeks → B, so consecutive weeks never repeat the same exercise
 * for a pattern. Falls back to a spaced pattern name if a pattern is ever missing
 * from the library (defensive; the record is exhaustive today).
 *
 * On a POWER day the ballistic library is used instead, with the same rotation
 * and the same equipment filtering.
 */
export function pickExercise(
  pattern: LiftPattern,
  weekNumber: number,
  equipment?: readonly EquipmentKey[],
  liftType?: LiftType,
): string {
  if (liftType === "power") {
    const opts = (POWER_EXERCISE[pattern] ?? []).filter((e) => canPerform(e, equipment));
    const pool = opts.length > 0 ? opts : (POWER_EXERCISE[pattern] ?? []);
    if (pool.length > 0) return pool[(weekNumber - 1) % pool.length]!;
  }
  const pair = EXERCISE_AB[pattern];
  if (!pair) return pattern.replace(/_/g, " ");
  const preferred = weekNumber % 2 === 1 ? pair[0] : pair[1];
  if (canPerform(preferred, equipment)) return preferred;

  // The rotation's pick is off the table. Keep alternating among what the athlete
  // CAN do, so weeks still vary, then fall down the ladder.
  const usable = (EXERCISE_FALLBACKS[pattern] ?? []).filter((e) => canPerform(e, equipment));
  if (usable.length === 0) return preferred; // nothing fits — better a name than nothing
  return usable[(weekNumber - 1) % usable.length]!;
}

// --- suggested working weight from a 5RM benchmark ---------------------------

/** Which 5RM benchmark (if any) maps to a movement pattern. */
export function benchmarkForPattern(
  pattern: LiftPattern,
  benchmarks?: { fiveRmSquat?: number; fiveRmDeadlift?: number; fiveRmBench?: number },
): number | undefined {
  if (!benchmarks) return undefined;
  if (pattern === "squat") return benchmarks.fiveRmSquat;
  if (pattern === "hip_hinge") return benchmarks.fiveRmDeadlift;
  if (pattern === "horizontal_press") return benchmarks.fiveRmBench;
  return undefined;
}

/**
 * Build the suggestedWeight string. With a mapped 5RM benchmark it gives an
 * absolute working weight at the scheme intensity; otherwise a %1RM + RIR cue.
 */
export function suggestedWeight(
  scheme: MovementScheme,
  pattern: LiftPattern,
  benchmarks?: { fiveRmSquat?: number; fiveRmDeadlift?: number; fiveRmBench?: number },
  weightUnit: "lbs" | "kg" = "lbs",
): string {
  // A power set is governed by bar SPEED, not by reps in reserve. Printing
  // "4 RIR" next to a jump squat invites exactly the grinding this emphasis
  // exists to prevent, so power movements carry the velocity rule instead.
  const cue =
    scheme.emphasis === "power"
      ? `~${scheme.intensityPct}% 1RM · ${POWER_CUE}`
      : `~${scheme.intensityPct}% 1RM · ${scheme.rir} RIR`;
  const fiveRm = benchmarkForPattern(pattern, benchmarks);
  if (fiveRm && fiveRm > 0) {
    const oneRm = fiveRm * EPLEY_5RM_TO_1RM;
    const w = round5((oneRm * scheme.intensityPct) / 100);
    return `${w} ${weightUnit} (${cue})`;
  }
  return cue;
}

// --- plyometric / reactive element ------------------------------------------

export interface PowerElement {
  exercise: string;
  sets: number;
  reps: string;
  note: string;
}

const POWER_NOTE =
  "Explosive intent with full recovery between sets — this trains rate of force development and running economy, not fatigue.";

/** Plyometric options by phase (Base/Build only). */
const POWER_LIB: Partial<Record<PhaseName, string[]>> = {
  base: ["box jumps", "broad jumps", "pogo hops", "med-ball chest pass"],
  build: ["depth jumps", "broad jumps", "box jumps", "med-ball rotational throw"],
  // Peak/Taper are used only by a forced power session (low-volume, sharpening).
  peak: ["depth jumps", "broad jumps", "pogo hops"],
  taper: ["pogo hops", "box jumps"],
};

/** Plyometric volume by phase. */
const POWER_VOLUME: Partial<Record<PhaseName, { sets: number; reps: string }>> = {
  base: { sets: 4, reps: "3" },
  build: { sets: 5, reps: "3" },
  peak: { sets: 3, reps: "3" },
  taper: { sets: 2, reps: "3" },
};

/**
 * A plyometric/reactive element for a lift session, or null. Programmed in Base
 * and Build only (economy/RFD development); Peak and Taper stay race-specific.
 * `sessionIndex` rotates the exercise across the week's lift sessions.
 */
export function powerElementFor(
  phase: PhaseName,
  microWeek: MicroWeekType,
  sessionIndex: number,
  force = false,
): PowerElement | null {
  // Recovery weeks never carry plyometrics, even a forced power session.
  if (microWeek === "deload" || microWeek === "race") return null;
  // Legacy (non-forced): plyometrics live in Base/Build only. A forced power
  // session (research power-focus liftType) keeps them through Peak and Taper.
  if (!force && (microWeek === "taper" || phase === "peak" || phase === "taper")) return null;
  const lib = POWER_LIB[phase];
  const vol = POWER_VOLUME[phase];
  if (!lib || !vol) return null;
  const exercise = lib[((sessionIndex % lib.length) + lib.length) % lib.length]!; // safe: index normalized into [0, lib.length) and POWER_LIB entries are non-empty
  return { exercise, sets: vol.sets, reps: vol.reps, note: POWER_NOTE };
}
