import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeDailySeries, type DailyMetricSource } from "@/lib/wearables/normalize";
import { objectiveReadiness } from "@/lib/wearables/readiness-recalc";

/**
 * GET /api/wearables/readiness-prefill
 *
 * Returns the athlete's latest objective recovery signal so the weekly readiness
 * form can prefill resting-HR / HRV (and show how today compares to their
 * baseline) instead of making them type it. Reads ALL connected providers'
 * `wearable_daily` rows via the caller's own RLS-scoped session, MERGES them
 * per-date by source priority (normalize.ts), then computes a baseline-relative
 * prefill (readiness-recalc.ts). Returns {} when there's nothing to offer.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data } = await supabase
    .from("wearable_daily")
    .select(
      "provider, date, resting_hr, hrv, sleep_score, sleep_total_min, readiness_score, respiratory_rate, vo2max",
    )
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(90);

  const rows = (data as
    | {
        provider: DailyMetricSource["provider"];
        date: string;
        resting_hr: number | null;
        hrv: number | null;
        sleep_score: number | null;
        sleep_total_min: number | null;
        readiness_score: number | null;
        respiratory_rate: number | null;
        vo2max: number | null;
      }[]
    | null) ?? [];

  const sources: DailyMetricSource[] = rows.map((r) => ({
    provider: r.provider,
    date: r.date,
    restingHr: r.resting_hr,
    hrv: r.hrv,
    sleepScore: r.sleep_score,
    sleepTotalMin: r.sleep_total_min,
    readinessScore: r.readiness_score,
    respiratoryRate: r.respiratory_rate,
    vo2max: r.vo2max,
  }));

  const series = normalizeDailySeries(sources).map((d) => ({
    date: d.date,
    restingHr: d.restingHr,
    hrv: d.hrv,
  }));

  const prefill = objectiveReadiness(series);
  if (!prefill) return NextResponse.json({});

  // Keep the legacy {restingHr, hrv} keys the form already reads; add baseline
  // context so the UI can show "today vs your baseline".
  return NextResponse.json({
    date: prefill.date,
    restingHr: prefill.restingHr,
    hrv: prefill.hrv,
    restingHrBaseline: prefill.restingHrBaseline,
    hrvBaseline: prefill.hrvBaseline,
    objectiveScore: prefill.objectiveScore,
    note: prefill.note,
  });
}
