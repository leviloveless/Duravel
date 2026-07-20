import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { ouraAuthorizeUrl } from "@/lib/wearables/oura";

/**
 * GET /api/wearables/oura/connect
 *
 * Starts the Oura OAuth flow: stores a CSRF `state` in an httpOnly cookie and
 * redirects the user to Oura's authorize page. No-ops to the settings page with
 * an error if Oura isn't configured yet.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const settings = new URL("/settings/connections", request.url);
  if (!env.OURA_CLIENT_ID) {
    settings.searchParams.set("error", "not_configured");
    return NextResponse.redirect(settings);
  }

  const origin = env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const redirectUri = `${origin}/api/wearables/oura/callback`;

  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("oura_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(ouraAuthorizeUrl(env.OURA_CLIENT_ID, redirectUri, state));
}
