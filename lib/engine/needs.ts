/**
 * Needs analysis — limiter detection + program biasing (Review item #1).
 *
 * Implements the questionnaire's stated intent (Q15): "The split should be
 * based on the individual's weak points… the program should have some
 * functional tests that determine what the user needs most." The engine
 * previously ignored this — two athletes in the same experience tier got
 * identical programs regardless of their benchmark profile. This module reads
 * the optional benchmarks the athlete already provides, scores the HYROX-
 * relevant physiological systems on one comparable 0–100 scale, identifies the
 * 1–2 weakest ("limiters"), and emits a small, BOUNDED set of deterministic
 * knobs (ProgramBias) that the rest of the engine applies.
 *
 * Design rules that keep this safe:
 *   - Pure + deterministic (fully unit-testable, no AI).
 *   - Backward compatible: no benchmarks (or <2 scorable domains) ⇒ neutral
 *     bias ⇒ the program is byte-for-byte what it was before this module.
 *   - Bounded: every knob is small (±1 run/hybrid, ±1 phase week, an emphasis
 *     label, a station ordering). It never invents volume or overrides the
 *     periodization — the reconciler still sizes running to the mileage target,
 *     so a frequency nudge changes *how often* an athlete trains a quality, not
 *     *how much* total volume they do.
 *   - Limiter detection is RELATIVE (gap below the athlete's own mean), which
 *     is far more robust than absolute cutoffs — it self-corrects for athletes
 *     whose whole profile sits high or low (and softens the sex bias baked into
 *     the mixed-reference anchors below; a true sex normalization is Review #10).
 *
 * The reference anchors are deliberately coarse and centralized here so they
 * are a one-file edit. They map a median HYROX amateur to ≈50 and a strong
 * one to ≈85. Absolute calibration matters little; cross-domain COMPARABILITY
 * (finding the limiter) is the job.
 */

import { parseTimeToSeconds } from "./paces";
import { clamp, EPLEY_5RM_TO_1RM, FIVE_K_MILES, TEN_K_MILES } from "./math";

export type NeedsDomain = "run_engine" | "erg_engine" | "strength";
export type RunEmphasis = "aerobic" | "threshold" | "none";
export type Durability = "low" | "normal" | "high" | null;

/** Structural subset of the athlete profile this analysis needs. `Profile`
 *  (lib/schemas) is assignable to it, so callers pass the profile directly. */
export interface NeedsProfile {
  bodyWeight: number;
  weightUnit: "lbs" | "kg";
  runningExp: "beginner" | "intermediate" | "advanced";
  hybridExp: "beginner" | "intermediate" | "advanced";
  liftingExp: "beginner" | "intermediate" | "advanced";
  trainingDays: string[];
  /** Biological sex — selects sex-specific scoring anchors (Review #10). */
  sex?: "male" | "female" | "other";
  benchmarks?: {
    mileTime?: string;
    fiveKTime?: string;
    tenKTime?: string;
    fiveRmSquat?: number;
    fiveRmBench?: number;
    fiveRmDeadlift?: number;
    ski2kTime?: string;
    row2kTime?: string;
    bike20MinCals?: number;
    /** DEKA ATLAS: max unbroken DB shoulder-to-overhead reps (press endurance). */
    ohpEnduranceReps?: number;
    /** DEKA ATLAS: benchmark glycolytic couplet time, "mm:ss" (glycolytic capacity). */
    glycolyticTestSec?: string;
  };
}

/** Ordered station priorities for each kind of limiter. Names match the
 *  HYBRID_LIBRARY entries in lib/ai/philosophy.ts so the AI hint lines up. */
export const ERG_STATIONS = ["ski erg", "row erg", "assault bike"] as const;
export const STRENGTH_STATIONS = [
  "sled push",
  "sled pull",
  "farmers carry",
  "sandbag lunges",
  "wall balls",
  "burpee broad jumps",
] as const;

/** The bounded knobs the rest of the engine consumes. Phase deltas sum to 0. */
export interface ProgramBias {
  baseWeeksDelta: number; // phase nudge (zero-sum with build/peak)
  buildWeeksDelta: number;
  peakWeeksDelta: number;
  runCountDelta: number; // -1..+1 extra/fewer run slots (frequency, not volume)
  hybridCountDelta: number; // -1..+1 extra/fewer hybrid slots
  runEmphasis: RunEmphasis; // which filler run type to favor
  stationEmphasis: string[]; // ordered station priorities for hybrids
}

export interface NeedsAnalysis {
  /** 0–100 capability per scored domain (higher = stronger); null = no data.
   *  Keyed by string so sport-specific analyses (e.g. Atlas) can carry their own
   *  domains; the HYROX/DEKA path still emits exactly run/erg/strength. */
  domainScores: Record<string, number | null>;
  /** Durability across the speed–duration curve (Riegel deviation), or null. */
  durability: Durability;
  /** Weakest 1–2 scored domains, lowest first. Empty when info is insufficient. */
  limiters: string[];
  /** Whether the analysis had enough data to bias the program at all. */
  informative: boolean;
  bias: ProgramBias;
  /** Short human-readable limiter summary for UI / prompt / audit. */
  summary: string;
}

export const NEUTRAL_BIAS: ProgramBias = {
  baseWeeksDelta: 0,
  buildWeeksDelta: 0,
  peakWeeksDelta: 0,
  runCountDelta: 0,
  hybridCountDelta: 0,
  runEmphasis: "none",
  stationEmphasis: [],
};

/** A domain counts as a limiter when it sits at least this far below the
 *  athlete's own mean scored domain. */
const LIMITER_GAP = 10;

// --- scoring primitives -----------------------------------------------------

/** Score a metric where LOWER is better (race/erg times). best→100, worst→0. */
export function scoreLowerBetter(value: number, best: number, worst: number): number {
  return clamp((100 * (worst - value)) / (worst - best), 0, 100);
}

/** Score a metric where HIGHER is better (calories, relative strength). */
export function scoreHigherBetter(value: number, worst: number, best: number): number {
  return clamp((100 * (value - worst)) / (best - worst), 0, 100);
}

/** Weighted mean of the present (non-null) entries, or null if none present. */
export function weightedMean(entries: Array<{ score: number | null; weight: number }>): number | null {
  let sum = 0;
  let wsum = 0;
  for (const e of entries) {
    if (e.score === null) continue;
    sum += e.score * e.weight;
    wsum += e.weight;
  }
  return wsum > 0 ? sum / wsum : null;
}

// --- domain scorers ---------------------------------------------------------

/**
 * Sex-specific scoring anchors (Review #10). The absolute anchors were male-ish,
 * which skewed a female athlete's limiter detection (she'd look "weak" on erg /
 * strength across the board). Scoring each domain against sex norms keeps the
 * relative comparison — the actual job — fair. Male values are unchanged.
 */
export type SexKey = "male" | "female";
export function sexKey(sex?: string): SexKey {
  return sex === "female" ? "female" : "male";
}

// [best, worst] pace (sec/mile); lower is better.
const RUN_ANCHORS: Record<SexKey, { mile: [number, number]; five: [number, number]; ten: [number, number] }> = {
  male: { mile: [300, 600], five: [330, 690], ten: [360, 720] },
  female: { mile: [330, 660], five: [363, 759], ten: [396, 792] },
};
// erg times [best, worst] sec (lower better); bike cals [worst, best] (higher better).
const ERG_ANCHORS: Record<SexKey, { row: [number, number]; ski: [number, number]; bike: [number, number] }> = {
  male: { row: [400, 560], ski: [420, 590], bike: [150, 380] },
  female: { row: [460, 644], ski: [483, 679], bike: [110, 285] },
};
// relative 1RM [worst, best] (higher better).
const STR_ANCHORS: Record<SexKey, { squat: [number, number]; dead: [number, number]; bench: [number, number] }> = {
  male: { squat: [1.0, 2.25], dead: [1.2, 2.75], bench: [0.6, 1.6] },
  female: { squat: [0.8, 1.8], dead: [1.0, 2.2], bench: [0.45, 1.15] },
};

/** Running engine from mile / 5K / 10K, pace-normalized. Longer distances are
 *  weighted higher because HYROX is an aerobic-endurance (8 km) event. */
function scoreRunEngine(b: NeedsProfile["benchmarks"], sex: SexKey): number | null {
  if (!b) return null;
  const a = RUN_ANCHORS[sex];
  const mileSec = b.mileTime ? parseTimeToSeconds(b.mileTime) : null;
  const fiveSec = b.fiveKTime ? parseTimeToSeconds(b.fiveKTime) : null;
  const tenSec = b.tenKTime ? parseTimeToSeconds(b.tenKTime) : null;

  const milePace = mileSec && mileSec > 0 ? mileSec : null; // 1 mi → sec/mi directly
  const fivePace = fiveSec && fiveSec > 0 ? fiveSec / FIVE_K_MILES : null;
  const tenPace = tenSec && tenSec > 0 ? tenSec / TEN_K_MILES : null;

  return weightedMean([
    { score: milePace ? scoreLowerBetter(milePace, a.mile[0], a.mile[1]) : null, weight: 0.15 },
    { score: fivePace ? scoreLowerBetter(fivePace, a.five[0], a.five[1]) : null, weight: 0.35 },
    { score: tenPace ? scoreLowerBetter(tenPace, a.ten[0], a.ten[1]) : null, weight: 0.5 },
  ]);
}

/** Non-running cardio engine from ski / row 2 k and 20-min bike calories. */
function scoreErgEngine(b: NeedsProfile["benchmarks"], sex: SexKey): number | null {
  if (!b) return null;
  const a = ERG_ANCHORS[sex];
  const ski = b.ski2kTime ? parseTimeToSeconds(b.ski2kTime) : null;
  const row = b.row2kTime ? parseTimeToSeconds(b.row2kTime) : null;
  const bike = typeof b.bike20MinCals === "number" ? b.bike20MinCals : null;

  return weightedMean([
    { score: row && row > 0 ? scoreLowerBetter(row, a.row[0], a.row[1]) : null, weight: 1 },
    { score: ski && ski > 0 ? scoreLowerBetter(ski, a.ski[0], a.ski[1]) : null, weight: 1 },
    { score: bike !== null ? scoreHigherBetter(bike, a.bike[0], a.bike[1]) : null, weight: 1 },
  ]);
}

/** Relative maximal strength from 5RM squat / deadlift / bench ÷ body weight.
 *  Squat + deadlift (leg drive / posterior chain for the sled) weighted highest. */
export function scoreStrength(p: NeedsProfile, sex: SexKey): number | null {
  const b = p.benchmarks;
  if (!b || !(p.bodyWeight > 0)) return null;
  const a = STR_ANCHORS[sex];
  const rel = (fiveRm?: number): number | null =>
    typeof fiveRm === "number" && fiveRm > 0 ? (fiveRm * EPLEY_5RM_TO_1RM) / p.bodyWeight : null;

  const squat = rel(b.fiveRmSquat);
  const dead = rel(b.fiveRmDeadlift);
  const bench = rel(b.fiveRmBench);

  return weightedMean([
    { score: squat !== null ? scoreHigherBetter(squat, a.squat[0], a.squat[1]) : null, weight: 0.4 },
    { score: dead !== null ? scoreHigherBetter(dead, a.dead[0], a.dead[1]) : null, weight: 0.4 },
    { score: bench !== null ? scoreHigherBetter(bench, a.bench[0], a.bench[1]) : null, weight: 0.2 },
  ]);
}

/** Durability = resistance to fading over distance, via Riegel prediction
 *  (t2 = t1·(d2/d1)^1.06). If the longer race is materially slower than
 *  predicted, the aerobic engine fades ⇒ "low" (bias toward aerobic base). */
function scoreDurability(b: NeedsProfile["benchmarks"]): Durability {
  if (!b) return null;
  const mile = b.mileTime ? parseTimeToSeconds(b.mileTime) : null;
  const five = b.fiveKTime ? parseTimeToSeconds(b.fiveKTime) : null;
  const ten = b.tenKTime ? parseTimeToSeconds(b.tenKTime) : null;

  // Prefer the widest available distance pair.
  let shortT: number | null = null;
  let shortD = 0;
  let longT: number | null = null;
  let longD = 0;
  if (mile && five) {
    shortT = mile; shortD = 1; longT = five; longD = FIVE_K_MILES;
  }
  if (five && ten) {
    shortT = five; shortD = FIVE_K_MILES; longT = ten; longD = TEN_K_MILES;
  }
  if (mile && ten && !(five)) {
    shortT = mile; shortD = 1; longT = ten; longD = TEN_K_MILES;
  }
  if (shortT === null || longT === null || shortD <= 0 || longD <= 0) return null;

  const predicted = shortT * Math.pow(longD / shortD, 1.06);
  const ratio = longT / predicted; // >1 slower than predicted (fades)
  if (ratio >= 1.03) return "low";
  if (ratio <= 0.98) return "high";
  return "normal";
}

// --- limiter detection + bias ----------------------------------------------

export function detectLimiters(scores: Record<string, number | null>): string[] {
  const present = Object.entries(scores).filter(
    (e): e is [string, number] => e[1] !== null,
  );
  if (present.length < 2) return []; // not enough to compare ⇒ no limiter claim
  const mean = present.reduce((a, [, s]) => a + s, 0) / present.length;
  const below = present
    .filter(([, s]) => s <= mean - LIMITER_GAP)
    .sort((a, b) => a[1] - b[1]) // lowest first
    .map(([d]) => d);
  return below.slice(0, 2); // at most two limiters
}

/** Sport-provided station names for limiter emphasis. Omit → HYROX names. */
export interface NeedsOptions {
  ergStations?: readonly string[];
  strengthStations?: readonly string[];
}

function stationEmphasisFor(
  limiters: string[],
  scores: Record<string, number | null>,
  ergStations: readonly string[],
  strengthStations: readonly string[],
): string[] {
  const wantErg = limiters.includes("erg_engine");
  const wantStr = limiters.includes("strength");
  if (!wantErg && !wantStr) return [];
  if (wantErg && wantStr) {
    const ergFirst = (scores.erg_engine ?? 100) <= (scores.strength ?? 100);
    return ergFirst
      ? [...ergStations, ...strengthStations]
      : [...strengthStations, ...ergStations];
  }
  return wantErg ? [...ergStations] : [...strengthStations];
}

const DOMAIN_LABEL: Record<NeedsDomain, string> = {
  run_engine: "running endurance",
  erg_engine: "erg / non-running cardio",
  strength: "maximal strength",
};

/**
 * Analyze an athlete's profile into a needs assessment + a bounded ProgramBias.
 */
export function analyzeNeeds(profile: NeedsProfile, opts?: NeedsOptions): NeedsAnalysis {
  const b = profile.benchmarks;
  const sk = sexKey(profile.sex);
  const domainScores: Record<NeedsDomain, number | null> = {
    run_engine: roundOrNull(scoreRunEngine(b, sk)),
    erg_engine: roundOrNull(scoreErgEngine(b, sk)),
    strength: roundOrNull(scoreStrength(profile, sk)),
  };
  const durability = scoreDurability(b);
  const limiters = detectLimiters(domainScores);
  const informative = limiters.length > 0 || durability === "low" || durability === "high";

  if (!informative) {
    return {
      domainScores,
      durability,
      limiters,
      informative: false,
      bias: { ...NEUTRAL_BIAS },
      summary: "No clear limiter from the provided benchmarks — standard balanced program.",
    };
  }

  const dominant = limiters[0] ?? null;
  const trainingDayCount = profile.trainingDays.length;

  const bias: ProgramBias = { ...NEUTRAL_BIAS };

  // Frequency nudges (frequency, not total volume — the reconciler holds volume).
  if (limiters.includes("run_engine")) bias.runCountDelta = 1;
  if (limiters.includes("erg_engine")) bias.hybridCountDelta = 1;

  // Cap combined added sessions on tight schedules so we don't overstuff days.
  if (trainingDayCount < 5 && bias.runCountDelta + bias.hybridCountDelta > 1) {
    // Keep the one for the more severe (lower-scored) limiter.
    const runScore = domainScores.run_engine ?? 100;
    const ergScore = domainScores.erg_engine ?? 100;
    if (runScore <= ergScore) bias.hybridCountDelta = 0;
    else bias.runCountDelta = 0;
  }

  // Run-type emphasis: a weak running engine or a fading (low-durability)
  // athlete needs aerobic base first; otherwise, if running is fine but a
  // limiter elsewhere, nudge the extra run toward threshold specificity.
  if (limiters.includes("run_engine") || durability === "low") {
    bias.runEmphasis = "aerobic";
  } else if (durability === "high" && bias.runCountDelta > 0) {
    bias.runEmphasis = "threshold";
  }

  // Station emphasis for hybrids (sport-provided names; HYROX by default).
  bias.stationEmphasis = stationEmphasisFor(
    limiters,
    domainScores,
    opts?.ergStations ?? ERG_STATIONS,
    opts?.strengthStations ?? STRENGTH_STATIONS,
  );

  // Phase nudge (zero-sum, ±1 week; mesocycles.ts guards base-largest + floors).
  if (dominant === "run_engine" || (dominant === null && durability === "low")) {
    bias.baseWeeksDelta = 1; // more aerobic foundation
    bias.peakWeeksDelta = -1;
  } else if (dominant === "erg_engine" || dominant === "strength") {
    bias.buildWeeksDelta = 1; // more specific / hybrid-heavy build
    bias.baseWeeksDelta = -1;
  }

  return {
    domainScores,
    durability,
    limiters,
    informative: true,
    bias,
    summary: buildSummary(limiters, durability),
  };
}

function buildSummary(limiters: string[], durability: Durability): string {
  if (limiters.length === 0 && durability === "low") {
    return "Endurance fades over distance — emphasizing aerobic base.";
  }
  if (limiters.length === 0 && durability === "high") {
    return "Strong endurance over distance — room for more threshold work.";
  }
  const names = limiters.map((d) => DOMAIN_LABEL[d as NeedsDomain] ?? d).join(" and ");
  const dur =
    durability === "low" ? " Endurance also fades over distance (aerobic emphasis)." : "";
  return `Primary limiter${limiters.length > 1 ? "s" : ""}: ${names}. Program biased to address ${limiters.length > 1 ? "these" : "this"}.${dur}`;
}

function roundOrNull(n: number | null): number | null {
  return n === null ? null : Math.round(n);
}
