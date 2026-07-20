import type { NormalizedDaily, WearableProvider } from "./types";

/**
 * Map a normalized daily-recovery metric to a `wearable_daily` row (canonical
 * columns from migration 0029). Each provider owns its own (user, provider, date)
 * row, computed in full each sync, so a straight upsert never nulls another
 * provider's columns — cross-provider merging happens at READ time in
 * `normalize.ts` (spec §1.5), not here.
 */
export function dailyToRow(userId: string, provider: WearableProvider, d: NormalizedDaily) {
  return {
    user_id: userId,
    provider,
    date: d.date,
    resting_hr: d.restingHr,
    hrv: d.hrv,
    sleep_score: d.sleepScore,
    sleep_total_min: d.sleepTotalMin ?? null,
    sleep_deep_min: d.sleepDeepMin ?? null,
    sleep_rem_min: d.sleepRemMin ?? null,
    sleep_light_min: d.sleepLightMin ?? null,
    sleep_awake_min: d.sleepAwakeMin ?? null,
    readiness_score: d.readinessScore ?? null,
    respiratory_rate: d.respiratoryRate ?? null,
    vo2max: d.vo2max ?? null,
    raw: d.raw,
  };
}
