import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { exchangeCodeForToken } from "@/lib/wearables/oura-api";
import { expiresAtFromNow, OURA_SCOPE } from "@/lib/wearables/oura";
import { upsertConnection } from "@/lib/wearables/connections";

/**
 * GET /api/wearables/oura/callback?code=...&state=...
 *
 * Completes OAuth: verifies the CSRF state cookie, exchanges the code for tokens
 * (Oura requires the same redirect_uri here as at authorize), stores the
 * connection (service role), and returns the user to the connections settings
 * page with a status flag.
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
  const expectedState = cookieStore.get("oura_oauth_state")?.value;
  cookieStore.delete("oura_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    settings.searchParams.set("error", "state");
    return NextResponse.redirect(settings);
  }

  const origin = env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  const redirectUri = `${origin}/api/wearables/oura/callback`;

  try {
    const token = await exchangeCodeForToken(code, redirectUri);
    await upsertConnection({
      userId: user.id,
      provider: "oura",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: expiresAtFromNow(token.expires_in),
      scope: token.scope ?? OURA_SCOPE,
    });
  } catch {
    settings.searchParams.set("error", "exchange");
    return NextResponse.redirect(settings);
  }

  settings.searchParams.set("connected", "oura");
  return NextResponse.redirect(settings);
}
