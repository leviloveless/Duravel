/**
 * HYROX mid-program RE-FORECAST (#17 projection §4) — PURE, unit-tested.
 *
 * The build-time projection (progression.ts) is a starting estimate. As the
 * athlete trains we replace assumptions with observations and re-forecast:
 *
 *   - Walk the "now" projection along the improvement curve, throttled by how
 *     much of the plan they've actually completed (adherence): the realized
 *     fraction at week K is  saturation(K)/saturation(W) · adherence^0.7.
 *   - Re-project the END target from where they actually are, assuming they keep
 *     training at a blend of their observed adherence and the plan (trust the
 *     plan early, trust the data late).
 *   - When a fresh per-event MEASUREMENT arrives (a new race import / updated
 *     benchmark), blend it into "now" (Kalman-style, measurement-weighted) and
 *     re-anchor the remainder from that reality.
 *
 * Everything is floored at the elite band (F·0.98) and never projected slower
 * than a fresh measurement. Read-only; does not touch program assembly.
 */

import { eventBand, type HyroxEventKey } from "./hyrox-standards";
import { saturation, formatClock, type ProjectedTimes } from "./progression";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** A fresh measurement outweighs the model when re-anchoring "now". */
const MEASUREMENT_WEIGHT = 0.65;

export interface ReforecastContext {
  /** Program length in weeks. */
  weeksW: number;
  /** Current elapsed week (0 at the start). */
  weekK: number;
  /** Completion rate to date, 0–1 (e.g. computeAdherence().overall.completionRate). */
  adherence: number;
  /** Optional readiness/load modifier (~0.9–1.1); 1 = neutral. */
  loadTrend?: number;
  /** Optional fresh per-event times in seconds (measured since build). */
  measurements?: Partial<Record<HyroxEventKey, number>>;
  sex?: string;
  division?: string;
  age?: number;
}

export interface ReforecastEvent {
  key: HyroxEventKey;
  label: string;
  /** Imported (build-time) time. */
  baselineSec: number;
  /** Current projection given training so far. */
  nowSec: number;
  /** Re-forecast end-of-program time. */
  endSec: number;
  /** Original build-time end target (for reference). */
  originalEndSec: number;
  baseline: string;
  now: string;
  end: string;
  /** True when a fresh measurement anchored this event. */
  measured: boolean;
  /** Percent of the planned improvement realized so far (0–100+). */
  progressPct: number;
}

export interface Reforecast {
  perEvent: ReforecastEvent[];
  finishBaselineSec: number | null;
  finishNowSec: number | null;
  finishEndSec: number | null;
  finishBaseline: string | null;
  finishNow: string | null;
  finishEnd: string | null;
  weekK: number;
  weeksW: number;
  adherencePct: number;
  /** End projection still within ~3% of the original target. */
  onTrack: boolean;
  note?: string;
}

/**
 * Re-forecast a stored baseline projection against live training signals.
 * `baseline` is the build-time ProjectedTimes (each event carries `currentSec`
 * = imported time and `projectedSec` = original end target).
 */
export function reforecast(baseline: ProjectedTimes, ctx: ReforecastContext): Reforecast {
  const W = Math.max(ctx.weeksW, 1);
  const K = clamp(ctx.weekK, 0, W);
  const a = clamp(ctx.adherence, 0, 1);
  const load = clamp(ctx.loadTrend ?? 1, 0.8, 1.2);
  const aEff = Math.pow(a, 0.7) * load;

  const curveFrac = clamp(saturation(K) / (saturation(W) || 1), 0, 1);
  const elapsedFrac = clamp(K / W, 0, 1);
  // Trust the plan early, the observed adherence late.
  const futureAdh = clamp(elapsedFrac * aEff + (1 - elapsedFrac) * 1, 0, 1.1);
  const meas = ctx.measurements ?? {};

  const perEvent: ReforecastEvent[] = baseline.perEvent.map((e) => {
    const baseCur = e.currentSec;
    const originalEndSec = e.projectedSec;
    const plannedGain = Math.max(0, baseCur - originalEndSec);
    const floor = eventBand(e.key, ctx.sex, ctx.division, ctx.age).F * 0.98;

    const realizedNow = clamp(curveFrac * aEff, 0, 1);
    const nowModel = baseCur - plannedGain * realizedNow;

    const m = meas[e.key];
    const measured = typeof m === "number" && Number.isFinite(m) && m > 0;
    let nowSec = measured
      ? MEASUREMENT_WEIGHT * (m as number) + (1 - MEASUREMENT_WEIGHT) * nowModel
      : nowModel;
    nowSec = clamp(nowSec, floor, baseCur * 1.25);

    const remainingGain = plannedGain * (1 - curveFrac) * futureAdh;
    const endSec = clamp(nowSec - remainingGain, floor, nowSec);

    const progressPct = plannedGain > 0 ? clamp(((baseCur - nowSec) / plannedGain) * 100, 0, 150) : 0;

    return {
      key: e.key,
      label: e.label,
      baselineSec: baseCur,
      nowSec,
      endSec,
      originalEndSec,
      baseline: formatClock(baseCur),
      now: formatClock(nowSec),
      end: formatClock(endSec),
      measured,
      progressPct,
    };
  });

  // Finish only when the baseline had one (singles with the full event set).
  const hasFinish = baseline.finishCurrentSec != null && baseline.finishProjectedSec != null;
  const finishBaselineSec = hasFinish ? baseline.finishCurrentSec : null;
  const finishNowSec = hasFinish ? perEvent.reduce((s, e) => s + e.nowSec, 0) : null;
  const finishEndSec = hasFinish ? perEvent.reduce((s, e) => s + e.endSec, 0) : null;

  const onTrack =
    finishEndSec != null && baseline.finishProjectedSec != null
      ? finishEndSec <= baseline.finishProjectedSec * 1.03
      : true;

  let note: string | undefined;
  if (K <= 0) note = "Your projection updates as you log training.";
  else if (a < 0.5) note = "Behind on planned sessions — projection trimmed to match your training so far.";
  else if (!onTrack) note = "Slightly behind the original target — keep logging to close the gap.";

  return {
    perEvent,
    finishBaselineSec,
    finishNowSec,
    finishEndSec,
    finishBaseline: finishBaselineSec != null ? formatClock(finishBaselineSec) : null,
    finishNow: finishNowSec != null ? formatClock(finishNowSec) : null,
    finishEnd: finishEndSec != null ? formatClock(finishEndSec) : null,
    weekK: K,
    weeksW: W,
    adherencePct: Math.round(a * 100),
    onTrack,
    note,
  };
}
