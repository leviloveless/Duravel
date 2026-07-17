import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DailyMetricInputSchema } from "@/lib/schemas";

/**
 * POST /api/daily-metrics — upsert one day's resting HR + HRV (Tasks addition #7).
 *
 * Keyed on (user, date). Program-agnostic daily data; the program view rolls it
 * up into a weekly average resting HR / HRV. Free (no AI).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = DailyMetricInputSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: `${first?.path.join(".")}: ${first?.message}` }, { status: 400 });
  }
  const input = parsed.data;

  const { error } = await supabase.from("daily_metrics").upsert(
    {
      user_id: user.id,
      date: input.date,
      resting_hr: input.restingHr ?? null,
      hrv: input.hrv ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,date" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
