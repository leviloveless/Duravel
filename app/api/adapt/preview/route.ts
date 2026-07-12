import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { previewAdaptation } from "@/lib/generation/adapt-week";

/**
 * POST /api/adapt/preview  { programId, weekNumber }
 *
 * Runs ONLY the deterministic adaptation engine (no AI, no writes, free) and
 * returns the signals + proposed rule + plain-language reason. Powers the
 * weekly review screen (phase2-spec.md §3b, §6).
 */
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
  try {
    const body = await request.json();
    programId = typeof body?.programId === "string" ? body.programId : undefined;
    weekNumber = Number.isInteger(body?.weekNumber) ? body.weekNumber : undefined;
  } catch {
    /* fall through */
  }
  if (!programId || !weekNumber || weekNumber < 1 || weekNumber > 24) {
    return NextResponse.json({ error: "programId and weekNumber are required" }, { status: 400 });
  }

  const result = await previewAdaptation(supabase, programId, weekNumber);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
