import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applyAdaptation } from "@/lib/generation/adapt-week";

/**
 * POST /api/adapt/apply  { programId, weekNumber, decision: "apply" | "dismiss" }
 *
 * Resolves a weekly review (phase2-spec.md §3b, §6).
 *  - dismiss: records the review as dismissed; nothing changes. Free.
 *  - apply:   re-runs the deterministic decision, refills the target week via
 *             one Haiku call when targets moved, splices it in, and writes the
 *             audit row. Rate-limited separately from full generations.
 */

// One Haiku call at most; small headroom over the default.
export const maxDuration = 60;

const DAILY_ADAPT_LIMIT = 7;
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
  let weekNumber: number | undefined;
  let decision: "apply" | "dismiss" | undefined;
  try {
    const body = await request.json();
    programId = typeof body?.programId === "string" ? body.programId : undefined;
    weekNumber = Number.isInteger(body?.weekNumber) ? body.weekNumber : undefined;
    decision = body?.decision === "apply" || body?.decision === "dismiss" ? body.decision : undefined;
  } catch {
    /* fall through */
  }
  if (!programId || !weekNumber || weekNumber < 1 || weekNumber > 24 || !decision) {
    return NextResponse.json(
      { error: "programId, weekNumber and decision are required" },
      { status: 400 },
    );
  }

  // Each week can be reviewed once (applied or dismissed).
  const { data: existing } = await supabase
    .from("adaptations")
    .select("id")
    .eq("program_id", programId)
    .eq("week_number", weekNumber)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "This week has already been reviewed" }, { status: 409 });
  }

  if (decision === "dismiss") {
    const { error } = await supabase.from("adaptations").insert({
      user_id: user.id,
      program_id: programId,
      week_number: weekNumber,
      target_week: weekNumber + 1,
      decision: "dismissed",
      rule_applied: "none",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, dismissed: true });
  }

  // Rate limit + run marker in one atomic DB step (kind='adapt', independent of
  // the generate limit) so concurrent requests can't slip past the cap — see
  // migration 0012. A normal user needs 1/week; 7/day is generous headroom.
  const { data: eventId, error: claimError } = await supabase.rpc("claim_generation_slot", {
    p_kind: "adapt",
    p_program_id: programId,
    p_limit: DAILY_ADAPT_LIMIT,
    p_window_hours: RATE_WINDOW_MS / (60 * 60 * 1000),
  });
  if (claimError) {
    return NextResponse.json({ error: "Could not start adaptation" }, { status: 500 });
  }
  if (!eventId) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `You've reached the limit of ${DAILY_ADAPT_LIMIT} weekly adaptations per day. Please try again later.`,
      },
      { status: 429 },
    );
  }

  const result = await applyAdaptation(supabase, user.id, programId, weekNumber);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Best-effort usage stamp (logged, not fatal, if it fails).
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
      console.warn(`[adapt] failed to stamp usage on event ${eventId}: ${usageError.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    rule: result.rule,
    reason: result.reason,
    targetWeek: result.targetWeek,
    refilled: result.refilled,
    usage: result.usage,
  });
}
