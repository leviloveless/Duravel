import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ReadinessCheckinInputSchema } from "@/lib/schemas";

/**
 * POST /api/readiness — upsert one weekly readiness check-in (Review #7).
 *
 * Keyed on (program, week). Free (no AI). Like workout logs, a week's check-in
 * is frozen once that week's review has been APPLIED, since it was an audit
 * input to the adaptation decision.
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
  const parsed = ReadinessCheckinInputSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: `${first?.path.join(".")}: ${first?.message}` }, { status: 400 });
  }
  const input = parsed.data;

  // RLS scopes to the caller's rows; confirm the program exists and is ready.
  const { data: program } = await supabase
    .from("programs")
    .select("id, status")
    .eq("id", input.programId)
    .single();
  if (!program) {
    return NextResponse.json({ error: "Program not found" }, { status: 404 });
  }
  if (program.status !== "ready") {
    return NextResponse.json({ error: "Program is not ready" }, { status: 409 });
  }

  // Frozen once this week's review has been applied.
  const { data: applied } = await supabase
    .from("adaptations")
    .select("id")
    .eq("program_id", input.programId)
    .eq("week_number", input.weekNumber)
    .eq("decision", "applied")
    .maybeSingle();
  if (applied) {
    return NextResponse.json(
      { error: "This week has already been reviewed — its readiness check-in is frozen." },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("readiness_checkins").upsert(
    {
      user_id: user.id,
      program_id: input.programId,
      week_number: input.weekNumber,
      sleep: input.sleep,
      fatigue: input.fatigue,
      stress: input.stress,
      soreness: input.soreness,
      resting_hr: input.restingHr ?? null,
      hrv: input.hrv ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program_id,week_number" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
