import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForToken } from "@/lib/wearables/strava-api";
import { expiresAtIso, STRAVA_SCOPE } from "@/lib/wearables/strava";
import { upsertConnection } from "@/lib/wearables/connections";

/**
 * GET /api/wearables/strava/callback?code=...&state=...
 *
 * Completes OAuth: verifies the CSRF state cookie, exchanges the code for tokens,
 * stores the connection (service role), and returns the user to the connections
 * settings page with a status flag.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const settings = new URL("/settings/connections", url.origin);

  if (url.searchParams.get("error")) {
    settings.searchParams.set("error", "denied");
    return NextResponse.redirect(settings);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("strava_oauth_state")?.value;
  cookieStore.delete("strava_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    settings.searchParams.set("error", "state");
    return NextResponse.redirect(settings);
  }

  try {
    const token = await exchangeCodeForToken(code);
    await upsertConnection({
      userId: user.id,
      provider: "strava",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: expiresAtIso(token.expires_at),
      scope: STRAVA_SCOPE,
      providerAthleteId: token.athlete?.id != null ? String(token.athlete.id) : null,
    });
  } catch {
    settings.searchParams.set("error", "exchange");
    return NextResponse.redirect(settings);
  }

  settings.searchParams.set("connected", "strava");
  return NextResponse.redirect(settings);
}
