import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncStrava } from "@/lib/wearables/strava-sync";

/**
 * POST /api/wearables/strava/sync
 *
 * Pulls the signed-in user's recent Strava activities into the staging table.
 * "Sync now" button + (later) a periodic/webhook trigger call this.
 */
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const result = await syncStrava(user.id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
