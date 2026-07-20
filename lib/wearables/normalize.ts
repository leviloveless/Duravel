import type { WearableProvider } from "./types";

/**
 * Cross-provider daily-metric normalization (spec §1.5) — PURE, unit-testable.
 *
 * The same day can carry an HRV reading from Oura AND WHOOP AND Apple Health.
 * Health metrics are NOT merged into one physical row (each provider keeps its
 * own `wearable_daily` row); instead the readiness layer picks, PER METRIC, the
 * value from the highest-priority source that reported it. A dedicated recovery
 * wearable (Oura/WHOOP) outranks a watch for HRV/RHR/sleep.
 */

/** One provider's daily row as read from `wearable_daily`. */
export interface DailyMetricSource {
  provider: WearableProvider;
  date: string; // YYYY-MM-DD
  restingHr: number | null;
  hrv: number | null;
  sleepScore: number | null;
  sleepTotalMin?: number | null;
  readinessScore?: number | null;
  respiratoryRate?: number | null;
  vo2max?: number | null;
}

/** One day's best-available metrics + which provider each came from. */
export interface NormalizedDailyMetric {
  date: string;
  restingHr: number | null;
  hrv: number | null;
  sleepScore: number | null;
  sleepTotalMin: number | null;
  readinessScore: number | null;
  respiratoryRate: number | null;
  vo2max: number | null;
  /** Provider that supplied each non-null metric (for display / audit). */
  sources: Partial<Record<keyof Omit<NormalizedDailyMetric, "date" | "sources">, WearableProvider>>;
}

/**
 * Per-metric source priority (default: a dedicated recovery wearable beats a
 * watch, which beats an activity-only source). Higher = preferred. Configurable
 * by swapping this map.
 */
export const METRIC_SOURCE_PRIORITY: Record<WearableProvider, number> = {
  oura: 5,
  whoop: 4,
  garmin: 3,
  apple_health: 2,
  strava: 1,
};

type MetricKey = keyof Omit<NormalizedDailyMetric, "date" | "sources">;

const METRIC_KEYS: MetricKey[] = [
  "restingHr",
  "hrv",
  "sleepScore",
  "sleepTotalMin",
  "readinessScore",
  "respiratoryRate",
  "vo2max",
];

function readMetric(s: DailyMetricSource, key: MetricKey): number | null {
  const v = (s as unknown as Record<MetricKey, number | null | undefined>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Merge all providers' rows for ONE date into a single best-available metric set.
 * For each metric, take the value from the highest-priority provider that has a
 * (non-null) reading. `rows` must all be for the same `date`.
 */
export function normalizeDailyForDate(rows: DailyMetricSource[]): NormalizedDailyMetric | null {
  if (rows.length === 0) return null;
  const out: NormalizedDailyMetric = {
    date: rows[0]!.date,
    restingHr: null,
    hrv: null,
    sleepScore: null,
    sleepTotalMin: null,
    readinessScore: null,
    respiratoryRate: null,
    vo2max: null,
    sources: {},
  };
  for (const key of METRIC_KEYS) {
    let best: { value: number; provider: WearableProvider; prio: number } | null = null;
    for (const r of rows) {
      const v = readMetric(r, key);
      if (v == null) continue;
      const prio = METRIC_SOURCE_PRIORITY[r.provider] ?? 0;
      if (!best || prio > best.prio) best = { value: v, provider: r.provider, prio };
    }
    if (best) {
      out[key] = best.value;
      out.sources[key] = best.provider;
    }
  }
  return out;
}

/**
 * Normalize a full series of provider rows into one canonical metric per date,
 * newest-first. Rows are grouped by date, then merged with `normalizeDailyForDate`.
 */
export function normalizeDailySeries(rows: DailyMetricSource[]): NormalizedDailyMetric[] {
  const byDate = new Map<string, DailyMetricSource[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const out: NormalizedDailyMetric[] = [];
  for (const list of byDate.values()) {
    const merged = normalizeDailyForDate(list);
    if (merged) out.push(merged);
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}
