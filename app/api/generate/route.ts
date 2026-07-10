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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let programId: string | undefined;
  try {
    const body = await request.json();
    programId = typeof body?.programId === "string" ? body.programId : undefined;
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
  if (program.status === "ready") {
    return NextResponse.json({ status: "ready" });
  }

  const result = await generateProgram(supabase, programId);
  if (!result.ok) {
    return NextResponse.json({ status: "failed", issues: result.issues }, { status: 502 });
  }
  return NextResponse.json({ status: result.status, issues: result.issues });
}
