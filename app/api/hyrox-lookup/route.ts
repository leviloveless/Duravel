import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { searchAthletes, hyresultConfigured } from "@/lib/hyrox-results-api";

/**
 * POST /api/hyrox-lookup  { first, last } (#17)
 *
 * Searches the HYROX Result API by name and returns the matching results
 * (finish time + event) for the athlete to confirm which is theirs. Server-side
 * so the API key never reaches the browser. One upstream call per lookup.
 */
export const maxDuration = 20;

const MAX_CANDIDATES = 12;
const BodySchema = z.object({
  first: z.string().max(80).optional().default(""),
  last: z.string().min(1).max(80),
});

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
  if (!parsed.success) return NextResponse.json({ error: "Enter a surname to search." }, { status: 400 });

  try {
    const candidates = (await searchAthletes(parsed.data.first, parsed.data.last))
      .filter((r) => r.totalTimeMs != null)
      .slice(0, MAX_CANDIDATES);
    return NextResponse.json({ candidates });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "lookup_failed";
    if (msg === "hyresult_rate_limited") {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    // Surface the upstream HTTP status (e.g. hyresult_error_404) so failures are
    // diagnosable from the client without exposing anything sensitive.
    const m = /^hyresult_error_(\d+)$/.exec(msg);
    const upstream = m ? Number(m[1]) : null;
    return NextResponse.json({ error: "lookup_failed", upstream }, { status: 502 });
  }
}
