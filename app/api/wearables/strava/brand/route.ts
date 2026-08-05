import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env, envFlag } from "@/lib/env";
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
  /** Full workout summary to write. Omitted → the legacy one-line tag. Strava
   *  descriptions are capped well above this; 4k is a generous safety bound. */
  description: z.string().max(4000).optional(),
  /** Activity title, e.g. "Week 1 - Monday - Interval Run". */
  title: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!envFlag(env.STRAVA_WRITE_ENABLED)) {
    return NextResponse.json({ error: "not_enabled" }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    console.error("[strava/brand] invalid body", parsed.error.issues);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  try {
    const { activityId, programName, weekNumber, sessionLabel, description, title } = parsed.data;
    await brandStravaActivity(
      user.id,
      activityId,
      { programName, weekNumber, sessionLabel },
      description,
      title,
    );
    return NextResponse.json({ branded: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "brand_failed";
    // Log the underlying reason. Without this the route returned a bare 400 with
    // the cause invisible in production — diagnosing one real failure took a
    // browser session and a code read (2026-08-04).
    console.error("[strava/brand] failed", {
      userId: user.id,
      activityId: parsed.data.activityId,
      reason: msg,
    });
    if (msg === "strava_write_scope" || msg === "strava_write_forbidden") {
      return NextResponse.json({ error: "reconnect_required" }, { status: 409 });
    }
    if (msg === "strava_not_connected") {
      return NextResponse.json({ error: "not_connected" }, { status: 400 });
    }
    return NextResponse.json({ error: "brand_failed" }, { status: 400 });
  }
}
