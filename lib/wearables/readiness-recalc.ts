/**
 * Objective readiness recalculation (PURE, unit-testable).
 *
 * Upgrades the old "pick the latest daily row" prefill (`readinessFromDaily`) to
 * a BASELINE-RELATIVE signal computed off the cross-provider normalized series
 * (see `normalize.ts`). It answers: given the athlete's own recent HRV / resting
 * HR, how far is today from their personal baseline — and prefills the weekly
 * readiness form's objective fields accordingly. The subjective Hooper score and
 * the engine's `computeReadiness` still own the final number; this only supplies
 * (and interprets) the objective inputs. Purely additive; never overwrites input.
 */

/** Minimal daily shape this needs (a subset of NormalizedDailyMetric). */
export interface DailyPoint {
  date: string; // YYYY-MM-DD
  restingHr: number | null;
  hrv: number | null;
}

export interface ObjectiveReadiness {
  /** Date of the most recent usable reading. */
  date: string;
  restingHr: number | null;
  hrv: number | null;
  /** Trailing-window personal baselines (mean), or null if too little history. */
  restingHrBaseline: number | null;
  hrvBaseline: number | null;
  /** Today − baseline (bpm); positive = elevated (worse). */
  restingHrDelta: number | null;
  /** (baseline − today)/baseline as a %, positive = HRV suppressed (worse). */
  hrvDropPct: number | null;
  /**
   * Standalone 0–100 objective readiness (100 = at/above baseline). Null until
   * there are ≥ MIN_BASELINE prior readings to form a trustworthy baseline.
   */
  objectiveScore: number | null;
  /** Human note, e.g. "resting HR +4 bpm vs baseline; HRV 12% below baseline". */
  note: string;
}

/** Trailing window (days) used to form the personal baseline. */
export const BASELINE_WINDOW_DAYS = 28;
/** Minimum prior readings before a baseline (and objectiveScore) is trusted. */
export const MIN_BASELINE = 3;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dayDiff(aISO: string, bISO: string): number {
  const a = Date.parse(aISO + "T00:00:00Z");
  const b = Date.parse(bISO + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / 86_400_000;
}

/**
 * Compute the objective readiness prefill from a daily series. `series` need not
 * be sorted; the most recent point carrying an RHR or HRV is "today", and the
 * baseline is the mean of readings within BASELINE_WINDOW_DAYS BEFORE it.
 */
export function objectiveReadiness(series: DailyPoint[]): ObjectiveReadiness | null {
  const usable = series
    .filter((p) => p.restingHr != null || p.hrv != null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const latest = usable[0];
  if (!latest) return null;

  const priors = usable.slice(1).filter((p) => dayDiff(latest.date, p.date) <= BASELINE_WINDOW_DAYS);

  const priorRhr = priors.map((p) => p.restingHr).filter((n): n is number => typeof n === "number");
  const priorHrv = priors.map((p) => p.hrv).filter((n): n is number => typeof n === "number");

  const restingHrBaseline = priorRhr.length >= MIN_BASELINE ? Math.round(mean(priorRhr)) : null;
  const hrvBaseline =
    priorHrv.length >= MIN_BASELINE ? Math.round(mean(priorHrv) * 10) / 10 : null;

  const notes: string[] = [];
  let score = 100;
  let scored = false;

  let restingHrDelta: number | null = null;
  if (typeof latest.restingHr === "number" && restingHrBaseline != null) {
    restingHrDelta = latest.restingHr - restingHrBaseline;
    scored = true;
    if (restingHrDelta > 1) {
      score -= Math.min(20, restingHrDelta * 2);
      notes.push(`resting HR +${Math.round(restingHrDelta)} bpm vs baseline`);
    }
  }

  let hrvDropPct: number | null = null;
  if (typeof latest.hrv === "number" && hrvBaseline != null && hrvBaseline > 0) {
    const drop = (hrvBaseline - latest.hrv) / hrvBaseline;
    hrvDropPct = Math.round(drop * 100);
    scored = true;
    if (drop > 0.03) {
      score -= Math.min(20, clamp(drop, 0, 0.4) * 50);
      notes.push(`HRV ${Math.round(drop * 100)}% below baseline`);
    }
  }

  return {
    date: latest.date,
    restingHr: latest.restingHr,
    hrv: latest.hrv,
    restingHrBaseline,
    hrvBaseline,
    restingHrDelta,
    hrvDropPct,
    objectiveScore: scored ? clamp(Math.round(score), 0, 100) : null,
    note: notes.join("; "),
  };
}
