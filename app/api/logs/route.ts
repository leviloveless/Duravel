import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { WorkoutLogInputSchema, type ProgramData } from "@/lib/schemas";

/**
 * POST /api/logs — upsert one session log (Phase 2, phase2-spec.md §6).
 *
 * Keyed on (program, week, day, session index). Free (no AI), so no rate
 * limit. Logs are editable until their week's review is APPLIED — after that
 * they're frozen, because they were the audit input to an adaptation.
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
  const parsed = WorkoutLogInputSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path.join(".")}: ${first?.message}` },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // RLS scopes to the caller's rows; also confirms the session position exists.
  const { data: program } = await supabase
    .from("programs")
    .select("id, status, program_data")
    .eq("id", input.programId)
    .single();
  if (!program) {
    return NextResponse.json({ error: "Program not found" }, { status: 404 });
  }
  if (program.status !== "ready") {
    return NextResponse.json({ error: "Program is not ready" }, { status: 409 });
  }
  const data = program.program_data as ProgramData | null;
  const week = data?.weeks.find((w) => w.weekNumber === input.weekNumber);
  const session = week?.days.find((d) => d.day === input.day)?.sessions[input.sessionIndex];
  if (!session) {
    return NextResponse.json({ error: "No such session in this program" }, { status: 400 });
  }
  if (session.kind === "race" && input.status !== "completed" && input.status !== "skipped") {
    // Races are loggable (finish + RPE + note) but never partial.
    return NextResponse.json({ error: "Race days can only be completed or skipped" }, { status: 400 });
  }

  // Frozen once this week's review has been applied (it fed an adaptation).
  const { data: applied } = await supabase
    .from("adaptations")
    .select("id")
    .eq("program_id", input.programId)
    .eq("week_number", input.weekNumber)
    .eq("decision", "applied")
    .maybeSingle();
  if (applied) {
    return NextResponse.json(
      { error: "This week has already been reviewed and adapted — its logs are frozen." },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("workout_logs").upsert(
    {
      user_id: user.id,
      program_id: input.programId,
      week_number: input.weekNumber,
      day: input.day,
      session_index: input.sessionIndex,
      status: input.status,
      rpe: input.status === "skipped" ? null : (input.rpe ?? null),
      actuals: input.actuals ?? null,
      note: input.note?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "program_id,week_number,day,session_index" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
