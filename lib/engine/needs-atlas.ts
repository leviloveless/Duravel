/**
 * DEKA ATLAS needs analysis — the strength-format analog of the HYROX needs
 * engine (needs.ts). ATLAS is a heavy barbell/DB event with no meaningful
 * running, so its limiters aren't run/erg/strength but three strength-domain
 * systems: absolute strength, overhead-pressing endurance, and glycolytic
 * capacity (ATLAS_NEEDS in sports/deka.ts). This module scores those three from
 * the athlete's benchmarks and emits the same bounded ProgramBias the rest of
 * the engine already consumes — so ATLAS gets a limiter-aware program while the
 * HYROX/DEKA path (analyzeNeeds) is untouched and stays byte-identical.
 *
 * Pure + deterministic. Backward compatible: <2 scorable domains ⇒ neutral bias.
 * Reuses the shared scoring primitives + relative-strength scorer from needs.ts.
 */
import { parseTimeToSeconds } from "./paces";
import {
  NEUTRAL_BIAS,
  analyzeNeeds,
  detectLimiters,
  scoreHigherBetter,
  scoreLowerBetter,
  scoreStrength,
  sexKey,
  type NeedsAnalysis,
  type NeedsOptions,
  type NeedsProfile,
  type ProgramBias,
  type SexKey,
} from "./needs";

// ATLAS domain anchors (sex-specific), mirroring ATLAS_NEEDS in sports/deka.ts.
// press endurance [worst, best] reps (higher better); glycolytic [worst, best]
// seconds (lower better); strength reuses needs.ts relative-1RM scoring.
const PRESS_ANCHORS: Record<SexKey, [number, number]> = { male: [12, 40], female: [8, 30] };
const GLYCOLYTIC_ANCHORS: Record<SexKey, [number, number]> = { male: [210, 90], female: [240, 105] };

// Station-emphasis orderings by limiter — names match ATLAS_STATION_LIBRARY so
// the prompt's phase-library filter lines up.
const STRENGTH_EMPHASIS = ["barbell thruster", "atlas shoulder-to-carry", "farmers carry", "surrender lunge", "single-arm db ground-to-overhead"];
const PRESS_EMPHASIS = ["db shoulder-to-overhead", "single-arm db ground-to-overhead", "barbell thruster", "atlas shoulder-to-carry"];
const GLYCOLYTIC_EMPHASIS = ["bar-facing burpee over bar", "single-unders", "barbell thruster", "surrender lunge"];

const DOMAIN_LABEL: Record<string, string> = {
  strength: "absolute strength",
  press_endurance: "overhead-pressing endurance",
  glycolytic: "glycolytic capacity",
};

function scorePressEndurance(reps: number | undefined, sex: SexKey): number | null {
  if (typeof reps !== "number" || reps <= 0) return null;
  const [worst, best] = PRESS_ANCHORS[sex];
  return scoreHigherBetter(reps, worst, best);
}

function scoreGlycolytic(timeStr: string | undefined, sex: SexKey): number | null {
  const sec = timeStr ? parseTimeToSeconds(timeStr) : null;
  if (sec === null || sec <= 0) return null;
  const [worst, best] = GLYCOLYTIC_ANCHORS[sex];
  return scoreLowerBetter(sec, best, worst); // best = lower time
}

/** Ordered, de-duplicated station emphasis for the detected limiters. */
function atlasStationEmphasis(limiters: string[], scores: Record<string, number | null>): string[] {
  const lists: Array<[string, string[]]> = [
    ["strength", STRENGTH_EMPHASIS],
    ["press_endurance", PRESS_EMPHASIS],
    ["glycolytic", GLYCOLYTIC_EMPHASIS],
  ];
  // Order limiter blocks by severity (lowest score first).
  const active = lists
    .filter(([d]) => limiters.includes(d))
    .sort((a, b) => (scores[a[0]] ?? 100) - (scores[b[0]] ?? 100));
  const out: string[] = [];
  for (const [, list] of active) for (const st of list) if (!out.includes(st)) out.push(st);
  return out;
}

function buildAtlasSummary(limiters: string[]): string {
  const names = limiters.map((d) => DOMAIN_LABEL[d] ?? d).join(" and ");
  return `Primary limiter${limiters.length > 1 ? "s" : ""}: ${names}. Program biased to address ${limiters.length > 1 ? "these" : "this"}.`;
}

/** Analyze an ATLAS athlete into a needs assessment + a bounded ProgramBias. */
export function analyzeAtlasNeeds(profile: NeedsProfile): NeedsAnalysis {
  const b = profile.benchmarks;
  const sk = sexKey(profile.sex);
  const domainScores: Record<string, number | null> = {
    strength: roundOrNull(scoreStrength(profile, sk)),
    press_endurance: roundOrNull(scorePressEndurance(b?.ohpEnduranceReps, sk)),
    glycolytic: roundOrNull(scoreGlycolytic(b?.glycolyticTestSec, sk)),
  };
  const limiters = detectLimiters(domainScores);

  if (limiters.length === 0) {
    return {
      domainScores,
      durability: null,
      limiters,
      informative: false,
      bias: { ...NEUTRAL_BIAS },
      summary: "No clear limiter from the provided benchmarks — standard balanced ATLAS program.",
    };
  }

  const dominant = limiters[0]!;
  const bias: ProgramBias = { ...NEUTRAL_BIAS };

  // Glycolytic weakness → one more barbell-metcon (hybrid) session's frequency.
  if (limiters.includes("glycolytic")) bias.hybridCountDelta = 1;

  // Phase nudge (zero-sum, ±1 week): absolute-strength limiter → more base
  // (heavy foundation); pressing-endurance / glycolytic → more specific build.
  if (dominant === "strength") {
    bias.baseWeeksDelta = 1;
    bias.peakWeeksDelta = -1;
  } else {
    bias.buildWeeksDelta = 1;
    bias.baseWeeksDelta = -1;
  }

  bias.stationEmphasis = atlasStationEmphasis(limiters, domainScores);

  return {
    domainScores,
    durability: null,
    limiters,
    informative: true,
    bias,
    summary: buildAtlasSummary(limiters),
  };
}

/**
 * Sport-routed needs analysis. ATLAS uses its strength-domain analysis; every
 * other sport delegates to the exact same analyzeNeeds(profile, opts) call as
 * before — so HYROX/DEKA output is unchanged.
 */
export function analyzeNeedsForSport(
  profile: NeedsProfile,
  sport: string | undefined,
  opts?: NeedsOptions,
): NeedsAnalysis {
  if (sport === "deka_atlas") return analyzeAtlasNeeds(profile);
  return analyzeNeeds(profile, opts);
}

function roundOrNull(n: number | null): number | null {
  return n === null ? null : Math.round(n);
}
