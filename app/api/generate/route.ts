import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateProgram } from "@/lib/generation/generate-program";
import { getEntitlement } from "@/lib/subscription";

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
// 7-day window. Counts real runs only — a no-op "already ready" request never
// reaches this check, so it doesn't burn quota.
const GENERATION_LIMIT = 2;
const RATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Accounts exempt from the daily generation cap (e.g. for testing). Set the
// GENERATION_UNLIMITED_EMAILS env var to a comma-separated list of emails.
const UNLIMITED_EMAILS = (process.env.GENERATION_UNLIMITED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Billing gate (monetization). No-op while BILLING_ENABLED !== "true". Once
  // billing is on, access requires a live subscription OR an active 14-day free
  // trial; otherwise 402 and the client sends the user to /pricing. The message
  // distinguishes "trial ended" from "no subscription" so the copy fits.
  const entitlement = await getEntitlement();
  if (!entitlement.entitled) {
    const message =
      entitlement.reason === "none" && entitlement.trialEndsAt
        ? "Your 14-day free trial has ended. Subscribe to keep generating and adapting your programs."
        : "An active subscription is required to generate programs.";
    return NextResponse.json({ error: "payment_required", message }, { status: 402 });
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
  // Rate limit + run marker in one atomic DB step so concurrent requests can't
  // slip past the cap (see migration 0012 — the old count-then-insert was a
  // TOCTOU race). Allowlisted testing accounts pass a very high limit so they're
  // effectively uncapped. The returned id is the marker row we stamp usage onto.
  const unlimited = !!user.email && UNLIMITED_EMAILS.includes(user.email.toLowerCase());
  const { data: eventId, error: claimError } = await supabase.rpc("claim_generation_slot", {
    p_kind: force ? "recalculate" : "create",
    p_program_id: programId,
    p_limit: unlimited ? 1_000_000 : GENERATION_LIMIT,
    p_window_hours: RATE_WINDOW_MS / (60 * 60 * 1000),
  });
  if (claimError) {
    return NextResponse.json({ error: "Could not start generation" }, { status: 500 });
  }
  if (!eventId) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `You've reached the limit of ${GENERATION_LIMIT} program generations per 7 days. Please try again later.`,
      },
      { status: 429 },
    );
  }

  // Recalculate: reset to generating and clear the old program before re-running.
  if (force) {
    await supabase
      .from("programs")
      .update({ status: "generating", program_data: null })
      .eq("id", programId);
  }

  const result = await generateProgram(supabase, programId);

  // Record actual token usage + estimated cost on this generation's event row.
  // Best-effort: a failed stamp (e.g. missing UPDATE policy) is logged, not fatal.
  if (eventId && result.usage) {
    const { error: usageError } = await supabase
      .from("generation_events")
      .update({
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cost_usd: result.usage.costUsd,
      })
      .eq("id", eventId);
    if (usageError) {
      console.warn(`[generate] failed to stamp usage on event ${eventId}: ${usageError.message}`);
    }
  }

  if (!result.ok) {
    return NextResponse.json({ status: "failed", issues: result.issues }, { status: 502 });
  }
  return NextResponse.json({ status: result.status, issues: result.issues, usage: result.usage });
}
