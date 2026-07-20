import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAthleteResult, hyresultConfigured } from "@/lib/hyrox-results-api";

/**
 * POST /api/hyrox-splits  { id } (#17)
 *
 * Given a result id from the name search, fetches that athlete's segment
 * breakdown (individual run legs + station/roxzone times) from the HYROX Result
 * API. Server-side so the API key never reaches the browser. One upstream call.
 * Splits are a nice-to-have on top of the finish time the search already returns,
 * so the client treats a failure here as non-fatal.
 */
export const maxDuration = 20;

// Result ids are opaque base64 blobs (~200 chars); cap generously.
const BodySchema = z.object({ id: z.string().min(1).max(4000) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!hyresultConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing result id." }, { status: 400 });

  try {
    const result = await getAthleteResult(parsed.data.id);
    return NextResponse.json({ splits: result.splits });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "lookup_failed";
    if (msg === "hyresult_rate_limited") {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    const m = /^hyresult_error_(\d+)$/.exec(msg);
    const upstream = m ? Number(m[1]) : null;
    return NextResponse.json({ error: "lookup_failed", upstream }, { status: 502 });
  }
}
