import { GOALS, type Goal } from "@/lib/library/types";
import { QUESTIONS, TESTS } from "./questions";
import type {
  AthleteContext,
  DiagnosticResult,
  Evidence,
  LimiterScore,
  TestResults,
} from "./types";

/**
 * Turning answers and measurements into a ranked limiter (2026-09-13).
 *
 * The interesting signal is almost never a raw number — it is a RATIO between
 * two numbers. A 21-minute 5 k says little on its own; a 21-minute 5 k next to a
 * 3:30 kilometre says the engine is the problem, and next to a 4:10 kilometre it
 * says the top end is. Every rule below is built that way where it can be, which
 * is why the battery asks for pairs.
 *
 * ⚠️ THE THRESHOLDS ARE COACHING HEURISTICS, NOT MEASUREMENTS. They come from
 * conventional endurance practice — 5% aerobic decoupling, a 6–8% speed reserve,
 * 1.5× body weight as a strength floor — and they are honest starting points, not
 * results fitted to Duravel's own athletes. Once there is enough data, refit them
 * against it, the same way `hyrox-standards.ts` says its F/C bands should be.
 */

const SEC_PER_KM_TOLERANCE = 0.0001;

/** Human "mm:ss" or "h:mm:ss" to seconds. Returns null on anything unparseable. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  // Minutes and seconds above 59 mean somebody typed a duration, not a clock.
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return parts.length === 2 ? nums[0]! * 60 + nums[1]! : nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
}

// ─── the objective rules ────────────────────────────────────────────────────

/**
 * Speed reserve: how much faster your best kilometre is than your 5 k pace.
 *
 * A trained runner sits around 6–8%. Well above that means a good top end
 * sitting on a weak engine — the aerobic and threshold systems are what is
 * costing time. Well below it means the engine is fine and there is no ceiling
 * above it to reach for, which is a VO2 problem.
 */
export function speedReserve(fiveKSec: number, oneKSec: number): number {
  const fiveKPerKm = fiveKSec / 5;
  if (oneKSec <= 0 || fiveKPerKm <= SEC_PER_KM_TOLERANCE) return 0;
  return (fiveKPerKm - oneKSec) / fiveKPerKm;
}

/** Relative strength floors, by sex. Below these, strength is the cheapest win available. */
const SQUAT_FLOOR: Record<"male" | "female", number> = { male: 1.5, female: 1.2 };
/** Broad jump as a multiple of height. Roughly "can you jump your own height". */
const JUMP_FLOOR: Record<"male" | "female", number> = { male: 1.0, female: 0.85 };

function sexKey(sex?: string | null): "male" | "female" {
  return sex === "female" ? "female" : "male";
}

export function testEvidence(results: TestResults, ctx: AthleteContext): Evidence[] {
  const out: Evidence[] = [];
  const push = (limiter: Goal, weight: number, reason: string) =>
    out.push({ limiter, weight: Math.min(1, Math.max(0, weight)), reason });

  // 1. Speed reserve — needs both, and is the most informative pair in the battery.
  if (results.fiveKSec && results.oneKSec) {
    const reserve = speedReserve(results.fiveKSec, results.oneKSec);
    const pct = Math.round(reserve * 1000) / 10;
    if (reserve > 0.12) {
      push(
        "threshold",
        0.9,
        `Your best kilometre is ${pct}% faster than 5 k pace — well above the usual 6–8%. The top end is there; what is missing is the ability to hold near it.`,
      );
      push(
        "aerobic",
        0.6,
        `A large speed reserve (${pct}%) usually means a small aerobic base underneath a decent gear.`,
      );
    } else if (reserve < 0.05) {
      push(
        "vo2",
        0.85,
        `Your kilometre is only ${pct}% faster than 5 k pace. There is very little gear above your steady pace — that ceiling is the limiter.`,
      );
    }
  }

  // 2. Aerobic decoupling — the single clearest read on base quality.
  if (results.decouplingPct != null) {
    const d = results.decouplingPct;
    if (d > 8) {
      push(
        "aerobic",
        1.0,
        `Heart rate drifted ${d}% across a steady hour. Above 5% means the aerobic base is not yet built; above 8% it is the dominant limiter.`,
      );
      push(
        "durability",
        0.5,
        `Decoupling of ${d}% shows up in a race as the later runs falling apart.`,
      );
    } else if (d > 5) {
      push(
        "aerobic",
        0.65,
        `Heart rate drifted ${d}% across a steady hour — over the 5% mark that separates a built base from one still being built.`,
      );
    }
  }

  // 3. Compromised running — the pair that is specific to this sport.
  if (results.freshKmSec && results.compromisedKmSec) {
    const gap = (results.compromisedKmSec - results.freshKmSec) / results.freshKmSec;
    const pct = Math.round(gap * 1000) / 10;
    if (gap > 0.15) {
      push(
        "durability",
        1.0,
        `You lost ${pct}% on a kilometre run straight off 100 wall balls. Anything past about 12% is compromised running, not fitness.`,
      );
    } else if (gap > 0.1) {
      push(
        "durability",
        0.6,
        `A ${pct}% drop-off on the compromised kilometre — real, but within reach of a block of hybrid work.`,
      );
    } else if (gap < 0.05) {
      push(
        "vo2",
        0.3,
        `Only ${pct}% slower after 100 wall balls. Compromised running is a strength of yours; the ceiling is worth more of your attention.`,
      );
    }
  }

  // 4. Relative strength.
  if (results.squat3Rm && ctx.bodyWeight) {
    const ratio = results.squat3Rm / ctx.bodyWeight;
    const floor = SQUAT_FLOOR[sexKey(ctx.sex)];
    const shown = Math.round(ratio * 100) / 100;
    if (ratio < floor * 0.75) {
      push(
        "max_strength",
        1.0,
        `A 3RM squat at ${shown}× body weight, against a working floor of ${floor}×. Every loaded station is drawing on a small pot.`,
      );
      push(
        "hypertrophy",
        0.5,
        `At ${shown}× body weight there is muscle to add as well as strength to express.`,
      );
    } else if (ratio < floor) {
      push(
        "max_strength",
        0.7,
        `A 3RM squat at ${shown}× body weight, just under the ${floor}× mark where the sled stops being a strength problem.`,
      );
    }
  }

  // 5. Relative power. Height arrives in inches from setup; jump in centimetres.
  if (results.broadJumpCm && ctx.heightIn) {
    const heightCm = ctx.heightIn * 2.54;
    const ratio = results.broadJumpCm / heightCm;
    const floor = JUMP_FLOOR[sexKey(ctx.sex)];
    const shown = Math.round(ratio * 100) / 100;
    if (ratio < floor * 0.85) {
      push(
        "max_power",
        1.0,
        `A broad jump of ${shown}× your height, against a floor of ${floor}×. Rate of force development is the gap, not maximum force.`,
      );
    } else if (ratio < floor) {
      push(
        "max_power",
        0.6,
        `A broad jump of ${shown}× your height — a little under the ${floor}× mark.`,
      );
    }
  }

  // 6. Muscular endurance at the station that ends races.
  if (results.wallBallsUnbroken != null) {
    const n = results.wallBallsUnbroken;
    if (n < 20) {
      push(
        "hypertrophy",
        0.95,
        `${n} unbroken wall balls. A race asks for 75 to 100 — this is a muscular-endurance gap before it is anything else.`,
      );
      push(
        "max_strength",
        0.4,
        `At ${n} reps, each rep is a large fraction of your maximum, which is why they run out.`,
      );
    } else if (n < 40) {
      push(
        "hypertrophy",
        0.55,
        `${n} unbroken wall balls. Enough to keep moving, not enough to stop the last station costing you minutes.`,
      );
    }
  }

  // 7. Upper-body capacity, cross-checked against running so it is a RATIO and
  //    not just "are you fast". Without the 5 k this says nothing, by design.
  if (results.ski500Sec && results.fiveKSec) {
    const expectedSki = (results.fiveKSec / 5) * 0.42;
    const excess = (results.ski500Sec - expectedSki) / expectedSki;
    if (excess > 0.2) {
      push(
        "hypertrophy",
        0.7,
        `Your 500 m ski is slow relative to your running — the upper body is behind the legs, which shows up on ski, row and sled pull.`,
      );
    }
  }

  return out;
}

export function questionEvidence(answers: Readonly<Record<string, string>>): Evidence[] {
  const out: Evidence[] = [];
  for (const q of QUESTIONS) {
    const chosen = answers[q.id];
    if (!chosen) continue;
    const option = q.options.find((o) => o.id === chosen);
    if (!option) continue;
    for (const e of option.evidence) {
      out.push({ limiter: e.limiter, weight: e.weight, reason: `You said: “${option.label}”.` });
    }
  }
  return out;
}

/**
 * How much of the battery was done.
 *
 * Counted over TESTS only, not questions. The questionnaire is answerable in two
 * minutes by anyone, so including it would let a page of opinions read as a
 * nearly-complete assessment.
 */
export function completenessOf(results: TestResults): number {
  const done = TESTS.filter((t) => results[t.id] != null).length;
  return TESTS.length === 0 ? 0 : done / TESTS.length;
}

/**
 * Combine everything into a ranked list.
 *
 * Scores are normalised against the STRONGEST limiter rather than against some
 * absolute maximum, so the output always answers the question actually being
 * asked — what should I work on first — instead of grading the athlete.
 *
 * `confident` is deliberately conservative. Naming a primary limiter off two
 * questionnaire answers would be worse than saying nothing, because an athlete
 * who trains the wrong quality for eight weeks has lost a block.
 */
/**
 * How far the questionnaire is turned down once real measurements exist.
 *
 * ⚠️ CAPPING EACH ANSWER AT 0.5 WAS NOT ENOUGH, and the tests caught it. Four
 * answers all pointing the same way sum to 2.0, which outvotes any single
 * measurement — so an athlete who believed their problem was strength kept
 * getting told it was strength even when a heart-rate drift of 12% and a 25%
 * compromised-running gap both said otherwise. That is precisely the failure a
 * diagnostic exists to prevent: it would have confirmed the prior instead of
 * correcting it.
 *
 * With no tests, opinions are all there is and run at full weight. As soon as
 * one stopwatch number arrives, they become the tiebreaker they were meant to
 * be. The number is a judgement, not a measurement — it just has to be small
 * enough that a stack of self-assessment cannot beat an objective signal.
 */
const QUESTION_DAMPING_WITH_TESTS = 0.45;

export function diagnose(
  answers: Readonly<Record<string, string>>,
  results: TestResults,
  ctx: AthleteContext = {},
): DiagnosticResult {
  const fromTests = testEvidence(results, ctx);
  const damping = fromTests.length > 0 ? QUESTION_DAMPING_WITH_TESTS : 1;
  const fromQuestions = questionEvidence(answers).map((e) => ({
    ...e,
    weight: e.weight * damping,
  }));
  const evidence = [...fromQuestions, ...fromTests];

  const totals = new Map<Goal, { score: number; reasons: string[] }>();
  for (const g of GOALS) totals.set(g, { score: 0, reasons: [] });
  for (const e of evidence) {
    const row = totals.get(e.limiter);
    if (!row) continue;
    row.score += e.weight;
    // Questionnaire reasons repeat the same sentence for several limiters; keep
    // one copy per limiter so the "why" list reads as evidence, not as noise.
    if (!row.reasons.includes(e.reason)) row.reasons.push(e.reason);
  }

  const raw = [...totals.entries()].map(([limiter, v]) => ({ limiter, ...v }));
  const top = Math.max(...raw.map((r) => r.score), 0);

  const ranked: LimiterScore[] = raw
    .map((r) => ({
      limiter: r.limiter,
      score: top > 0 ? Math.round((r.score / top) * 100) : 0,
      reasons: r.reasons,
    }))
    .sort((a, b) => b.score - a.score || GOALS.indexOf(a.limiter) - GOALS.indexOf(b.limiter));

  const completeness = completenessOf(results);
  const answered = Object.keys(answers).length;

  return {
    ranked,
    completeness,
    // Either half of the battery can carry it, but not a handful of opinions:
    // three tests, or the full questionnaire plus one test.
    confident:
      top > 0 && (completeness >= 0.33 || (answered >= QUESTIONS.length && completeness > 0)),
  };
}
