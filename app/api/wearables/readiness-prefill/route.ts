import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readinessFromDaily, type DailyRow } from "@/lib/wearables/ingest";

/**
 * GET /api/wearables/readiness-prefill
 *
 * Returns the latest resting-HR / HRV the user's connected wearable has recorded,
 * so the weekly readiness form can prefill those (optional) fields instead of
 * making the athlete type them. Reads `wearable_daily` via the caller's own
 * RLS-scoped session. Returns {} when there's nothing to offer.
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
    .select("date, resting_hr, hrv")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(14);

  const prefill = readinessFromDaily((data as DailyRow[] | null) ?? []);
  return NextResponse.json(prefill ?? {});
}
