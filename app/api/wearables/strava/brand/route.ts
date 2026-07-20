import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { brandStravaActivity } from "@/lib/wearables/strava-brand";

/**
 * POST /api/wearables/strava/brand
 *
 * Opt-in: write a Duravel tag onto one of the athlete's Strava activities (the
 * activity linked to a completed session). Gated by STRAVA_WRITE_ENABLED and by
 * the connection actually holding the `activity:write` scope — a connection made
 * before we added write returns `reconnect_required` so the UI can prompt a
 * one-tap reconnect.
 */
export const maxDuration = 30;

const BodySchema = z.object({
  activityId: z.string().min(1).max(32),
  programName: z.string().max(120).optional(),
  weekNumber: z.number().int().min(1).max(52).optional(),
  sessionLabel: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (env.STRAVA_WRITE_ENABLED !== "true") {
    return NextResponse.json({ error: "not_enabled" }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    const { activityId, programName, weekNumber, sessionLabel } = parsed.data;
    await brandStravaActivity(user.id, activityId, { programName, weekNumber, sessionLabel });
    return NextResponse.json({ branded: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "brand_failed";
    if (msg === "strava_write_scope" || msg === "strava_write_forbidden") {
      return NextResponse.json({ error: "reconnect_required" }, { status: 409 });
    }
    if (msg === "strava_not_connected") {
      return NextResponse.json({ error: "not_connected" }, { status: 400 });
    }
    return NextResponse.json({ error: "brand_failed" }, { status: 400 });
  }
}
