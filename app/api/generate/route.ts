import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateProgram } from "@/lib/generation/generate-program";

/**
 * POST /api/generate  { programId: string }
 *
 * Runs the generation pipeline (architecture-plan.md §5) for a program the
 * signed-in user owns: AI session fill → assemble + verify → persist.
 * Steps 1–2 (validation + periodization engine) already ran at onboarding
 * time; the skeleton is stored on the program row.
 */

// The pipeline makes several sequential model calls; allow headroom on Vercel.
export const maxDuration = 60;

// Per-user rate limit (Milestone 7): a generation run is expensive (one Haiku
// call per mesocycle), so cap how many a single user can trigger in a rolling
// 24-hour window. Counts real runs only — a no-op "already ready" request never
// reaches this check, so it doesn't burn quota.
const DAILY_GENERATION_LIMIT = 3;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let programId: string | undefined;
  let force = false;
  try {
    const body = await request.json();
    programId = typeof body?.programId === "string" ? body.programId : undefined;
    force = body?.force === true;
  } catch {
    /* fall through to 400 below */
  }
  if (!programId) {
    return NextResponse.json({ error: "programId is required" }, { status: 400 });
  }

  // RLS scopes this to the caller's own rows.
  const { data: program } = await supabase
    .from("programs")
    .select("id, status")
    .eq("id", programId)
    .single();
  if (!program) {
    return NextResponse.json({ error: "Program not found" }, { status: 404 });
  }
  // Already done and this isn't an explicit recalculate → no-op.
  if (program.status === "ready" && !force) {
    return NextResponse.json({ status: "ready" });
  }
  // Rate limit: count this user's real generation runs in the trailing 24h.
  // (RLS scopes the count to the caller; this runs before any expensive work.)
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count, error: countError } = await supabase
    .from("generation_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .neq("kind", "adapt") // weekly adaptations have their own separate limit
    .gte("created_at", since);
  if (!countError && (count ?? 0) >= DAILY_GENERATION_LIMIT) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `You've reached the limit of ${DAILY_GENERATION_LIMIT} generations per day. Please try again later.`,
      },
      { status: 429 },
    );
  }

  // Log this run before starting so concurrent requests can't slip past the cap.
  // Keep the id so we can stamp token usage onto this same row afterward.
  const { data: event } = await supabase
    .from("generation_events")
    .insert({ user_id: user.id, program_id: programId, kind: force ? "recalculate" : "create" })
    .select("id")
    .single();

  // Recalculate: reset to generating and clear the old program before re-running.
  if (force) {
    await supabase.from("programs").update({ status: "generating", program_data: null }).eq("id", programId);
  }

  const result = await generateProgram(supabase, programId);

  // Record actual token usage + estimated cost on this generation's event row.
  if (event?.id && result.usage) {
    await supabase
      .from("generation_events")
      .update({
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cost_usd: result.usage.costUsd,
      })
      .eq("id", event.id);
  }

  if (!result.ok) {
    return NextResponse.json({ status: "failed", issues: result.issues }, { status: 502 });
  }
  return NextResponse.json({ status: result.status, issues: result.issues, usage: result.usage });
}
