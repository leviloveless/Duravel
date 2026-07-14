import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { stravaAuthorizeUrl } from "@/lib/wearables/strava";

/**
 * GET /api/wearables/strava/connect
 *
 * Starts the Strava OAuth flow: stores a CSRF `state` in an httpOnly cookie and
 * redirects the user to Strava's authorize page. No-ops to the settings page with
 * an error if Strava isn't configured yet.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const settings = new URL("/settings/connections", request.url);
  if (!env.STRAVA_CLIENT_ID) {
    settings.searchParams.set("error", "not_configured");
    return NextResponse.redirect(settings);
  }

  const origin = env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const redirectUri = `${origin}/api/wearables/strava/callback`;

  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("strava_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(stravaAuthorizeUrl(env.STRAVA_CLIENT_ID, redirectUri, state));
}
