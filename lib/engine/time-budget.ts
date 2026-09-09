/**
 * Time-budget -> volume + intensity-distribution mapping (Phase 1 of the
 * volume-vs-intensity work). Pure and deterministic. These functions are only
 * invoked when the athlete supplied a `weeklyHours` band, so the legacy
 * (no-band) path is untouched and the golden-HYROX oracle stays byte-identical.
 *
 * Research basis: docs/research/Duravel_Volume-Intensity_Research_Report.
 * Numbers are intentionally conservative and tunable; the per-(sport,band)
 * snapshot tests freeze the resulting skeletons for review.
 */
import type { SportId, WeeklyHoursBand } from "@/lib/schemas";
import type { ExperienceLevel, PhaseName, TrainingDayName, ZoneDistribution } from "./types";
import type { SportFamily } from "./sports/types";

/**
 * Starting weekly running mileage for a single-currency sport (HYROX / DEKA /
 * general fitness) by budget. The microcycle progression grows this toward a
 * peak near the top of the band; cardio minutes derive from it exactly as in
 * the legacy path (startingCardioMinutes = mileage x avgMinPerMile). Anchored so
 * h0_5 ~= beginner, h5_10 ~= intermediate, h10_20 ~= advanced (the legacy
 * experience defaults 12/22/35), then scaled up for the elite budgets.
 */
export const BAND_START_MILEAGE: Record<WeeklyHoursBand, number> = {
  h0_5: 10,
  h5_10: 20,
  h10_20: 37,
  // Impact guardrail: high budgets cap RUNNING mileage below the raw
  // hours-equivalent (60 / 87). The surplus aerobic volume is carried by
  // BAND_START_CARDIO_MIN and routed to low-impact cardio by the reconciler.
  h20_30: 48,
  h30_40: 55,
};

/**
 * Total starting weekly cardio MINUTES by band — decoupled from running
 * mileage so that at high budgets the surplus aerobic volume goes to low-impact
 * cardio (bike / row / ski) instead of more running impact. For low/mid budgets
 * this equals mileage x avgMinPerMile (18), so their output is unchanged; only
 * h20_30 / h30_40 sit above the capped running mileage.
 */
export const BAND_START_CARDIO_MIN: Record<WeeklyHoursBand, number> = {
  h0_5: 180,
  h5_10: 360,
  h10_20: 666,
  h20_30: 1080,
  h30_40: 1560,
};

export function bandStartCardioMinutes(band: WeeklyHoursBand): number {
  return BAND_START_CARDIO_MIN[band];
}

/** Per-discipline (triathlon) [baseHours, peakHours] by budget. Base is where
 *  the program starts; the held level climbs to peak across the working weeks. */
export const BAND_TRI_HOURS: Record<WeeklyHoursBand, [number, number]> = {
  h0_5: [3, 5],
  h5_10: [6, 10],
  h10_20: [10, 16],
  h20_30: [18, 26],
  h30_40: [26, 36],
};

/**
 * Intensity shift by budget, in percentage points added to the "middle"
 * (threshold/tempo) pool z3+z4, taken from (or given to) the easy pool z1+z2.
 * z5 (VO2/hard) is held. This encodes the core finding: at low volume the mix
 * leans to threshold (positive delta); at high volume it polarizes into a big
 * easy base with less gray-zone (negative delta). h10_20 is the neutral anchor.
 */
export const BAND_MIDDLE_DELTA: Record<WeeklyHoursBand, number> = {
  h0_5: 8,
  h5_10: 4,
  h10_20: 0,
  h20_30: -3,
  h30_40: -6,
};

export function bandStartMileage(band: WeeklyHoursBand): number {
  return BAND_START_MILEAGE[band];
}

/**
 * Batch 7 — running share of the band aerobic budget.
 *
 * The band start-mileage is calibrated for an experienced runner, and the total
 * cardio-minute budget is fixed by the band; the reconciler routes whatever
 * isn't run to low-impact cross-training. So scaling the RUNNING mileage down
 * (a) starts beginners at a sane volume and (b) shifts a heavier athlete's
 * aerobic load off high-impact running — WITHOUT changing total aerobic volume.
 *
 *   - Experience: a beginner runner starts at 60% of the band mileage; an
 *     intermediate/advanced runner is unchanged (factor 1.0), so existing
 *     intermediate snapshots are byte-identical.
 *   - Bodyweight: above 185 lb the running share tapers ~0.3%/lb, floored at
 *     0.8 (a −20% cap). Missing bodyweight ⇒ 1.0.
 */
export function runImpactFactor(exp: ExperienceLevel, bodyWeightLbs?: number): number {
  const expF = exp === "beginner" ? 0.6 : 1.0;
  const bw = bodyWeightLbs ?? 0;
  const bwF = bw > 185 ? Math.max(0.8, 1 - (bw - 185) * 0.003) : 1.0;
  return expF * bwF;
}

export function bandTriHours(band: WeeklyHoursBand): [number, number] {
  return BAND_TRI_HOURS[band];
}

/**
 * Section 6 structure targets ~5–6 quality anchors + easy filler per week, NOT
 * the 8–10 fragmented touchpoints the phase/experience count model produces. A
 * band athlete's TOTAL weekly sessions are capped to this research-shaped budget;
 * the trim comes off easy filler runs first (and, for run-dominant sports,
 * surplus hybrids), so the long run + quality anchors (threshold / VO2) and the
 * research lift dose are preserved. Higher budgets support more anchors.
 */
/**
 * Minimum TRAINING DAYS a band requires (Levi, 2026-08-04).
 *
 * The volume a band prescribes has to physically fit, and a week can hold at most
 * `days x 2` sessions — two a day is absolute. Letting someone pick 20-30 hours
 * across 3 days produced a week that dropped half its prescription on the floor
 * and stacked five sessions on a Monday. The time budget and the day count are
 * one decision, so the day count follows the budget.
 */
export const BAND_MIN_TRAINING_DAYS: Record<WeeklyHoursBand, number> = {
  h0_5: 4,
  h5_10: 5,
  h10_20: 7,
  h20_30: 7,
  h30_40: 7,
};

export function bandMinTrainingDays(band: WeeklyHoursBand): number {
  return BAND_MIN_TRAINING_DAYS[band];
}

/**
 * The largest band a given number of training days can legitimately hold — the
 * inverse of `BAND_MIN_TRAINING_DAYS`.
 *
 * Matters for the legacy back-fill: a band does not only describe volume, it
 * RAISES the session and day caps (`trainingCaps` takes the max of the experience
 * tier and the band). Inferring a big band for a program that only trains 3 days a
 * week would hand it 20-hour caps and no days to spend them on — exactly the
 * "20-30 hours across 3 days" week that stacked five sessions on a Monday.
 * Programs chosen through onboarding can't do this (the day minimum is validated
 * there); back-filled ones have no such guarantee, so the ceiling is applied here.
 */
export function maxBandForTrainingDays(trainingDays: number): WeeklyHoursBand {
  let best: WeeklyHoursBand = WEEKLY_HOURS_ORDER[0]!;
  for (const band of WEEKLY_HOURS_ORDER) {
    if (BAND_MIN_TRAINING_DAYS[band] <= trainingDays) best = band;
  }
  return best;
}

/** Calendar order — the order days are added when a week has to grow. */
const CALENDAR_DAYS: readonly TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Raise a day count to what the band requires (Levi, 2026-08-06).
 *
 * The MIRROR of `clampBandToFamily`, for the other half of the same decision.
 * Onboarding validates the band minimum on both the client and the server, but
 * `toEngineInput` never did — so a program SAVED before that rule (2026-08-04)
 * regenerated an impossible week on every recalculate. An audit found 504 days
 * shipping two weight sessions, and every single one was an `h20_30` band on a
 * 4-day week: more lifts prescribed than lift-free days exist. The engine had no
 * legal arrangement available and thrashed producing the least-bad one.
 *
 * Only ever ADDS days, never removes: the athlete said they could train that
 * much, and the band is the thing they chose most recently. Removing days would
 * silently shrink a week that was already being delivered.
 *
 * Day choice is deterministic (recalculate must be idempotent) and preference-
 * aware: calendar order, but days the athlete asked to keep as REST are taken
 * last — only when there is no other way to reach the minimum. A 7-day band
 * necessarily consumes them all, which is exactly what onboarding tells a new
 * athlete choosing that band.
 */
export function clampTrainingDaysToBand(
  trainingDays: readonly TrainingDayName[],
  band: WeeklyHoursBand,
  restDays?: readonly TrainingDayName[],
): TrainingDayName[] {
  const min = BAND_MIN_TRAINING_DAYS[band];
  const have = trainingDays.filter((d, i) => trainingDays.indexOf(d) === i);
  if (have.length >= min) return [...have];

  const rest = new Set(restDays ?? []);
  const missing = CALENDAR_DAYS.filter((d) => !have.includes(d));
  // Preferred rest days sort last; calendar order breaks ties within each group.
  const candidates = [
    ...missing.filter((d) => !rest.has(d)),
    ...missing.filter((d) => rest.has(d)),
  ];

  const out = [...have];
  for (const d of candidates) {
    if (out.length >= min) break;
    out.push(d);
  }
  // Return in calendar order so the week reads normally downstream.
  return CALENDAR_DAYS.filter((d) => out.includes(d));
}

/** The smaller of two bands. */
export function minBand(a: WeeklyHoursBand, b: WeeklyHoursBand): WeeklyHoursBand {
  return WEEKLY_HOURS_ORDER.indexOf(a) <= WEEKLY_HOURS_ORDER.indexOf(b) ? a : b;
}

/**
 * Floor on the starting-volume readiness factor (see `startVolumeReadiness`).
 *
 * ⚠️ The number matters more than it looks, because the microcycle progression is
 * MULTIPLICATIVE — `increaseCardioStep` grows the CURRENT value by 10%, so a
 * discount applied at week 1 is still there, proportionally, at the peak. This is
 * not a ramp that heals; it is a haircut on the whole block. Any floor chosen here
 * is therefore also the fraction of their chosen band a fully-detrained athlete
 * ends up training.
 *
 * 0.8 is set by that constraint, not by taste. The line it has to clear: a
 * fully-detrained athlete must still FINISH the block training more than the
 * band's own week-1 prescription — 12 weeks of work has to leave them fitter than
 * the band's starting point, in every band. 0.75 misses that line at h5_10 by a
 * single minute (359 vs 360), so 0.8 is the nearest clean number that clears it
 * everywhere with room. Pinned by `start-readiness.test.ts`: raise it and week 1
 * eases less, lower it and the athlete stops getting the band they chose.
 */
export const MIN_START_READINESS = 0.8;

/**
 * How far to pitch STARTING volume down toward where the athlete actually is
 * today (Tasks #17 — the onboarding field says "Helps us pitch your starting
 * volume to where you are now"). `currentDaysPerWeek` has been collected,
 * validated and persisted since that field shipped, and read by nothing. This is
 * what reads it.
 *
 * The band tables (`BAND_START_MILEAGE`, `BAND_START_CARDIO_MIN`, `BAND_TRI_HOURS`)
 * are calibrated for an athlete ALREADY training the days they signed up for.
 * Someone training 2 days a week who commits to 6 is not that athlete, and a week-1
 * prescription built for a 6-day base is how a program gets abandoned in the first
 * fortnight.
 *
 *   factor = MIN_START_READINESS + (1 - MIN_START_READINESS) x (current / target)
 *
 *   0 of 6 days -> 0.80    3 of 6 -> 0.90    6 of 6 -> 1.00    7 of 6 -> 1.00
 *
 * Deliberate properties:
 *   - It NEVER scales UP. Training more days than you signed up for does not earn
 *     extra week-1 volume; the band ceiling is still the ceiling.
 *   - It is a no-op when `currentDaysPerWeek` is absent — every program generated
 *     before this shipped, and every athlete who skips the optional field. That is
 *     what keeps the golden-HYROX oracle byte-identical.
 *   - The discount PERSISTS proportionally across the block (see
 *     `MIN_START_READINESS`), so it is deliberately shallow. It is a nudge toward
 *     the athlete's real base, not a separate volume model.
 */
export function startVolumeReadiness(
  currentDaysPerWeek: number | undefined,
  targetDays: number,
): number {
  if (typeof currentDaysPerWeek !== "number" || !Number.isFinite(currentDaysPerWeek)) return 1;
  if (!(targetDays > 0)) return 1;
  const ratio = Math.min(1, Math.max(0, currentDaysPerWeek) / targetDays);
  return MIN_START_READINESS + (1 - MIN_START_READINESS) * ratio;
}

/**
 * The largest weekly-hours band a sport family may offer (Levi, 2026-08-04).
 *
 * **30-40 hours is not a HYROX or DEKA band.** Two sessions a day across 7 days is
 * 14 slots; 40 hours across 14 sessions averages 171 minutes EACH, which for a
 * station-hybrid athlete means three-hour runs. That is not HYROX training — it is
 * Ironman training. The band stays available for triathlon, where 30-40 hours is
 * a normal age-group build.
 *
 * Families without an entry offer every band.
 */
export const MAX_BAND_BY_FAMILY: Partial<Record<SportFamily, WeeklyHoursBand>> = {
  station_hybrid: "h20_30",
};

/**
 * The largest weekly-hours band an individual SPORT may offer, overriding its
 * family's ceiling (Levi, 2026-09-09).
 *
 * WHY THIS EXISTS AT ALL. `MAX_BAND_BY_FAMILY` above is the same decision, and
 * for the station sports the family is the right key — HYROX and DEKA are the
 * same race shape at different lengths. Triathlon is not: Olympic, 70.3 and
 * 140.6 share one family and one engine but differ by a factor of five in race
 * duration, and the tri engine's session caps are derived from the RACE (long
 * run 75/60 min for Olympic against 150/135 for 140.6, and the same shape for
 * the ride and the swim). A ceiling that can only be expressed per-family
 * therefore cannot say the one thing that is true here: 30-40 hours is a real
 * 140.6 build and is not a thing an Olympic-distance athlete can be given.
 *
 * THE TEST A BAND HAS TO PASS. A band is a promise of a RANGE of weekly hours,
 * so the honest test is whether the sport's biggest week actually reaches the
 * BOTTOM of that range. Anything less and the label on the radio button is
 * wrong. Measured end to end (16-week advanced build, 7 training days, peak week
 * delivered training minutes including strength — the number the athlete would
 * actually see in their calendar):
 *
 *                     h5_10   h10_20   h20_30   h30_40      band floor
 *   tri_olympic       10.0h    12.7h    12.6h    12.5h      5 / 10 / 20 / 30
 *   tri_70_3          10.0h    17.0h    22.1h    23.1h
 *   tri_140_6         10.0h    17.0h    26.1h    29.6h
 *   hyrox / deka       10.0h    16.6h    23.2h        —
 *
 * Read down the columns against the floors. Olympic flatlines at ~12.6 h from
 * h10_20 upward — it is not short of slots or of ambition, it is short of
 * legitimate sessions, because there is no Olympic-distance workout that is
 * three hours long. Selecting 20-30 h buys an Olympic athlete NOTHING over
 * 10-20 h; selecting 30-40 h buys slightly less than nothing. So Olympic stops
 * at `h10_20`, the last band it can honour.
 *
 * 70.3 delivers 22.1 h at h20_30 — comfortably over that band's 20 h floor — and
 * 23.1 h at h30_40, which is 77% of a 30 h promise. So 70.3 stops at `h20_30`.
 *
 * 140.6 has no entry and keeps the family default (every band). It lands at
 * 29.6 h against h30_40's 30 h floor: a 24-minute miss on a 36-hour
 * prescription, stable across every program length from 12 to 32 weeks. That is
 * rounding distance, not mis-selling, and it is what the band is for.
 *
 * ⚠️ THESE THREE NUMBERS ARE LEVI'S TO ADJUST. The criterion — "the peak
 * delivered week must reach the band's lower bound" — is the defensible part,
 * and it is worth noting that it independently reproduces his own 2026-08-04
 * call on the station sports: HYROX at h20_30 delivers 23.2 h and passes, while
 * h30_40 would deliver the same 23.2 h against a 30 h floor and fails. The
 * ceilings BELOW follow from applying that criterion to today's tri caps. If the
 * caps move — a longer Olympic long ride, say — re-measure and move these with
 * them. If Levi wants the criterion applied without tolerance, `tri_140_6` gains
 * an `h20_30` entry and loses the band it is most associated with; that is a
 * product call, not an engineering one.
 *
 * Sports without an entry fall back to their family ceiling, then to "no
 * ceiling" — so this table stays small and only says the things a family cannot.
 */
export const MAX_BAND_BY_SPORT: Partial<Record<SportId, WeeklyHoursBand>> = {
  tri_olympic: "h10_20",
  tri_70_3: "h20_30",
};

/**
 * The minimum a caller has to know about a sport to resolve its band ceiling.
 *
 * Deliberately a shape and not the `SportId`, so this module never has to import
 * the sport REGISTRY to look a family up: `sports/index` reaches the triathlon
 * engine, which imports this file, and a runtime cycle through a module whose
 * top level is all `const` tables is the kind of bug that only shows up in a
 * production bundle. Every call site already holds the `SportConfig` — it was
 * calling `getSport(sport).family` to reach the old function — so passing the
 * config itself costs nothing and closes the cycle by construction.
 */
export interface SportBandRef {
  id: SportId;
  family: SportFamily;
}

/**
 * How close (fractionally) a legacy program's starting cardio may sit BELOW a
 * band's own starting cardio and still be classified into it. See
 * `inferBandFromStartCardio`.
 *
 * Without a tolerance the advanced legacy default (35 mi/wk -> 630 min) misses
 * h10_20's 666 by 36 minutes and lands in h5_10 — classifying a 35-mile-a-week
 * athlete as a 5-to-10-hour trainee. 10% is wide enough to catch that and narrow
 * enough that the beginner (216 vs 360, 40% below) and intermediate (396 vs 666,
 * 41% below) defaults stay exactly where they belong.
 */
export const BAND_INFER_TOLERANCE = 0.1;

/**
 * Infer a weekly-hours band from a legacy program's STARTING cardio minutes
 * (Levi, 2026-08-05 — "yes back fill").
 *
 * Programs generated before `weeklyHours` existed carry no band, and a bandless
 * program bypasses every band rule on recalculate: no session cap, no day cap, no
 * hour ceiling, no band zone shift. 63% of their weeks were landing >=15 min under
 * prescribed cardio as a result. This gives those programs a band so they get the
 * same guarantees as everything generated since.
 *
 * The comparison is deliberately cardio-to-cardio (legacy start vs
 * `BAND_START_CARDIO_MIN`) rather than against total training time — mixing lift
 * minutes into one side of the comparison and not the other over-classifies every
 * athlete by roughly a band.
 *
 * Returns the LARGEST band whose starting cardio the athlete's own start reaches
 * (within `BAND_INFER_TOLERANCE`), so the inference never hands an athlete MORE
 * volume than their program already had — it only brings the ceiling down onto a
 * program that previously had none. `h0_5` is the floor: every athlete gets a band.
 */
export function inferBandFromStartCardio(startCardioMinutes: number): WeeklyHoursBand {
  let best: WeeklyHoursBand = "h0_5";
  for (const band of WEEKLY_HOURS_ORDER) {
    const threshold = BAND_START_CARDIO_MIN[band] * (1 - BAND_INFER_TOLERANCE);
    if (startCardioMinutes >= threshold) best = band;
  }
  return best;
}

/** Bands in ascending order — the single source of truth for "how big is this band". */
export const WEEKLY_HOURS_ORDER: readonly WeeklyHoursBand[] = [
  "h0_5",
  "h5_10",
  "h10_20",
  "h20_30",
  "h30_40",
];

/** Is this band offered for this sport family? */
export function bandAllowedForFamily(family: SportFamily, band: WeeklyHoursBand): boolean {
  const max = MAX_BAND_BY_FAMILY[family];
  if (!max) return true;
  return WEEKLY_HOURS_ORDER.indexOf(band) <= WEEKLY_HOURS_ORDER.indexOf(max);
}

/** Every band this sport family offers, ascending. */
export function bandsForFamily(family: SportFamily): WeeklyHoursBand[] {
  return WEEKLY_HOURS_ORDER.filter((b) => bandAllowedForFamily(family, b));
}

/**
 * Clamp a band to what the family allows. Belt-and-braces for the ENGINE: a
 * stored program from before this rule (or a hand-edited input snapshot) must not
 * be able to generate a 40-hour HYROX week on recalculate.
 */
export function clampBandToFamily(family: SportFamily, band: WeeklyHoursBand): WeeklyHoursBand {
  return bandAllowedForFamily(family, band) ? band : MAX_BAND_BY_FAMILY[family]!;
}

/**
 * The largest band this SPORT offers: its own ceiling if it has one, otherwise
 * its family's, otherwise none. The sport-first order is the whole point — a
 * sport-level entry exists precisely to say something its family cannot.
 */
export function maxBandForSport(sport: SportBandRef): WeeklyHoursBand | undefined {
  return MAX_BAND_BY_SPORT[sport.id] ?? MAX_BAND_BY_FAMILY[sport.family];
}

/** Is this band offered for this sport? Sport ceiling first, then family. */
export function bandAllowedForSport(sport: SportBandRef, band: WeeklyHoursBand): boolean {
  const max = maxBandForSport(sport);
  if (!max) return true;
  return WEEKLY_HOURS_ORDER.indexOf(band) <= WEEKLY_HOURS_ORDER.indexOf(max);
}

/** Every band this sport offers, ascending — what onboarding should render. */
export function bandsForSport(sport: SportBandRef): WeeklyHoursBand[] {
  return WEEKLY_HOURS_ORDER.filter((b) => bandAllowedForSport(sport, b));
}

/**
 * Clamp a band to what the SPORT allows.
 *
 * ⚠️ This is the graceful-degradation path, and it is the reason the ceiling is
 * a clamp rather than a validation error. A program SAVED at a band that is no
 * longer offered — an Olympic-distance athlete stored at `h30_40` from before
 * `MAX_BAND_BY_SPORT` existed — still has to rebuild every time they hit
 * recalculate, adapt a week, or open the program. It rebuilds at the ceiling,
 * quietly, exactly as `clampBandToFamily` has done for station-hybrid programs
 * since 2026-08-04. Nothing throws, nothing is dropped, and the athlete's week
 * gets smaller only in the sense that it stops claiming hours it never delivered.
 */
export function clampBandForSport(sport: SportBandRef, band: WeeklyHoursBand): WeeklyHoursBand {
  return bandAllowedForSport(sport, band) ? band : maxBandForSport(sport)!;
}

/**
 * The band's own upper bound, as total weekly TRAINING MINUTES (Levi,
 * 2026-08-04). The progression must never prescribe more than the athlete said
 * they had.
 *
 * It used to. `h20_30` peaked at 32 hours and `h30_40` at **46** — an athlete who
 * selected "30-40 hours" was being handed 46. Cardio is clamped to
 * `bandMax - liftMinutes`, so the whole week (lifts included) stays inside the
 * budget the athlete actually chose.
 */
export const BAND_MAX_WEEKLY_MINUTES: Record<WeeklyHoursBand, number> = {
  h0_5: 5 * 60,
  h5_10: 10 * 60,
  h10_20: 20 * 60,
  h20_30: 30 * 60,
  h30_40: 40 * 60,
};

export function bandMaxWeeklyMinutes(band: WeeklyHoursBand): number {
  return BAND_MAX_WEEKLY_MINUTES[band];
}

/**
 * TOTAL weekly non-cardio sessions (runs + lifts + hybrids) the band budgets for.
 *
 * This is also, implicitly, how many of the week's `days x 2` slots are LEFT for
 * Zone 1-2 blocks — and that is what makes a high-volume week deliverable. At
 * 20-30 h the old budget of 10 left only 3 cardio slots on a 7-day week, so 441
 * of 1560 prescribed minutes had nowhere to go. Dropping to 8 frees two more
 * slots; the same mileage then rides on fewer, LONGER runs and the aerobic volume
 * lands in long Zone 1-2 blocks, which is what a 20+ hour endurance week is
 * actually made of (Levi, 2026-08-04 — "build out the longer sessions").
 */
export const BAND_SESSION_CAP: Record<WeeklyHoursBand, number> = {
  h0_5: 5,
  h5_10: 6,
  h10_20: 8,
  h20_30: 8,
  h30_40: 8,
};

/**
 * Runs preserved when trimming to the session cap. Protects the long run plus
 * the quality anchors buildRunSlots seeds first. At the lowest budget only the
 * long run + one VO2 anchor are guaranteed (research protects VO2 first), so the
 * floor is 2; from 5 h up the long + threshold + VO2 trio is held (floor 3).
 */
export const BAND_ANCHOR_RUN_FLOOR: Record<WeeklyHoursBand, number> = {
  h0_5: 2,
  h5_10: 3,
  h10_20: 3,
  h20_30: 3,
  h30_40: 3,
};

export function bandSessionCap(band: WeeklyHoursBand): number {
  return BAND_SESSION_CAP[band];
}

export function bandAnchorRunFloor(band: WeeklyHoursBand): number {
  return BAND_ANCHOR_RUN_FLOOR[band];
}

/** Split an integer `total` across two channels in the ratio a:b, exactly:
 *  the two returned integers always sum back to `total` (no rounding drift). */
function splitProportional(total: number, a: number, b: number): [number, number] {
  if (a + b <= 0) return [total, 0];
  const first = Math.round((total * a) / (a + b));
  return [first, total - first];
}

/**
 * Apply the budget's intensity shift to one phase's zone distribution.
 * Preserves the exact sum of the input (a 100-sum distribution stays 100),
 * never lets a pool go negative, and holds z5.
 */
export function applyBandZoneShift(
  base: ZoneDistribution,
  band: WeeklyHoursBand,
): ZoneDistribution {
  const delta = BAND_MIDDLE_DELTA[band];
  if (delta === 0) return { ...base };
  const easy = base.z1 + base.z2;
  const mid = base.z3 + base.z4;
  // Bounded move: cannot take more than the easy pool holds, nor remove more
  // than the middle pool holds.
  const d = Math.max(-mid, Math.min(delta, easy));
  const newEasy = easy - d;
  const newMid = mid + d;
  const [z1, z2] = splitProportional(newEasy, base.z1, base.z2);
  const [z3, z4] = splitProportional(newMid, base.z3, base.z4);
  return { z1, z2, z3, z4, z5: base.z5 };
}

/** Research Section 6 three-zone target {easy, gray, hard} (Z1/Z2/Z3) — `hard` is
 *  above-threshold / VO2 work (engine z5). Supplied per weekly-hours band by a
 *  sport's config; drives the zone distribution when the athlete gives a budget. */
export type ThreeZone = { easy: number; gray: number; hard: number };

/** Per-phase tilt (percentage points of the HARD pool) around the band anchor:
 *  Base sits easier, Peak more polarized/intense, so the plan still periodizes
 *  while its program average tracks the research target for the budget. */
const PHASE_HARD_TILT: Record<PhaseName, number> = { base: -4, build: -1, peak: 5, taper: 0 };

/**
 * Build one phase's 5-zone target from the sport's research 3-zone band target.
 * SCALES true high-intensity (z5) by budget — the finding the flat band shift
 * missed — while preserving phase periodization and summing to exactly 100.
 *   research Z1 (easy) -> engine z1 + z2   |   Z2 (gray) -> z3 + z4   |   Z3 (hard) -> z5
 */
export function bandPhaseZoneTargets(
  phase: PhaseName,
  band: WeeklyHoursBand,
  table: Record<WeeklyHoursBand, ThreeZone>,
): ZoneDistribution {
  const a = table[band];
  const hard = Math.max(3, a.hard + (PHASE_HARD_TILT[phase] ?? 0));
  const gray = a.gray;
  const easy = Math.max(0, 100 - gray - hard);
  const z1 = Math.round(easy * 0.25);
  const z2 = easy - z1;
  const z3 = Math.round(gray * 0.6);
  const z4 = gray - z3;
  return { z1, z2, z3, z4, z5: hard };
}
