import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncAllConnected } from "@/lib/wearables/sync-all";

/**
 * POST /api/wearables/sync
 *
 * Pulls from EVERY API source the signed-in athlete has connected, in one call.
 * The per-provider routes (`/api/wearables/strava/sync`, `.../oura/sync`) stay
 * as they are for the Settings panel's per-connection control; this is the
 * everyday one-click path used by the program view.
 *
 * A provider that fails does not fail the request — its error comes back on its
 * own row in `results`, so a dead Oura token still lets Strava import.
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
    const result = await syncAllConnected(user.id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
