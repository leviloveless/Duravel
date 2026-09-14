import type { Goal } from "@/lib/library/types";

/**
 * The limiter diagnostic (2026-09-13).
 *
 * ⚠️ A LIMITER IS A LIBRARY GOAL. Not a parallel vocabulary — the same seven.
 * That is the whole design: the diagnostic's output is a filter you can apply to
 * `/library` and a thing the engine already knows how to periodize. A diagnostic
 * that produced its own categories would be a personality quiz.
 *
 * Two halves, deliberately separable:
 *
 *   QUESTIONS — no equipment, two minutes, answerable on the sofa. Subjective,
 *   so it is weighted lower, but it catches things no test does: an athlete who
 *   knows their grip fails, or who has not lifted in a year.
 *
 *   TESTS — objective, and where the real signal is. Each carries its own
 *   protocol because a benchmark measured differently is not a benchmark, and
 *   the single most common way a self-assessment goes wrong is an athlete
 *   running their "5k time trial" downhill on fresh legs after three rest days.
 *
 * Both are optional. The scorer says what it can with what it has and says so.
 */
export type Limiter = Goal;

/** One piece of support for a limiter, from a single answer or measurement. */
export interface Evidence {
  limiter: Limiter;
  /**
   * How hard this points at that limiter, 0–1. Objective measurements are
   * allowed up to 1.0; a questionnaire answer is capped at 0.5 in the data
   * below, so no combination of opinions can outvote a stopwatch.
   */
  weight: number;
  /** One sentence naming the actual number, so the result can show its working. */
  reason: string;
}

export interface DiagnosticQuestion {
  id: string;
  /** What the athlete is asked. */
  prompt: string;
  /** Why we are asking — shown under the prompt; a question nobody understands gets a random answer. */
  why: string;
  options: readonly {
    id: string;
    label: string;
    evidence: readonly { limiter: Limiter; weight: number }[];
  }[];
}

export type TestUnit = "time" | "number" | "percent";

export interface DiagnosticTest {
  id: keyof TestResults;
  name: string;
  /** Exactly how to run it. Ambiguity here is measurement error later. */
  protocol: readonly string[];
  /** What it tells you. */
  measures: string;
  unit: TestUnit;
  /** Placeholder showing the expected format. */
  placeholder: string;
  /** Equipment beyond shoes, if any. */
  needs?: string;
}

/**
 * Everything the battery can measure. All optional — an athlete who has only
 * run a 5k still gets a partial read, clearly labelled as partial.
 *
 * Times are SECONDS, distances CENTIMETRES, loads in the athlete's own weight
 * unit (compared only as a ratio to body weight, so the unit cancels).
 */
export interface TestResults {
  fiveKSec?: number;
  oneKSec?: number;
  /** Heart-rate drift across a steady 60-minute aerobic run, as a percentage. */
  decouplingPct?: number;
  /** 1 km run on fresh legs, as the control for the compromised one below. */
  freshKmSec?: number;
  /** 1 km run immediately after 100 wall balls. */
  compromisedKmSec?: number;
  /** Best 3-rep back squat. */
  squat3Rm?: number;
  /** Standing broad jump, centimetres. */
  broadJumpCm?: number;
  /** Maximum unbroken wall balls at race weight. */
  wallBallsUnbroken?: number;
  /** 500 m SkiErg, seconds. */
  ski500Sec?: number;
}

export interface AthleteContext {
  sex?: string | null;
  bodyWeight?: number | null;
  heightIn?: number | null;
}

export interface LimiterScore {
  limiter: Limiter;
  /** 0–100, normalised so the strongest limiter is the one to train first. */
  score: number;
  reasons: readonly string[];
}

export interface DiagnosticResult {
  ranked: readonly LimiterScore[];
  /** How much of the battery was actually completed, 0–1. */
  completeness: number;
  /** True when there is enough to name a primary limiter with a straight face. */
  confident: boolean;
}
