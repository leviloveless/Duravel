import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { appleAppSiteAssociation } from "@/lib/apple/aasa";

/**
 * `GET /.well-known/apple-app-site-association` — the Universal Links
 * association file for `duravel.app`.
 *
 * A route rather than a file in `public/` because the payload embeds the Apple
 * Team ID, which is account data and does not belong in a public repo. See
 * `lib/apple/aasa.ts` for the path rules and for why a missing Team ID 404s
 * instead of serving a placeholder.
 *
 * The directory name has to stay `.well-known` — Next serves App Router
 * segments verbatim, and Apple fetches this exact path with no extension. It
 * must answer 200 with `application/json` and no redirect, which is why this is
 * a route handler returning `NextResponse.json` rather than a rewrite.
 *
 * `force-dynamic` keeps the Team ID a runtime value: static generation would
 * bake whatever was set at build time into the deployment, so rotating or first
 * setting `APPLE_TEAM_ID` would need a rebuild rather than a restart.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const body = appleAppSiteAssociation(env.APPLE_TEAM_ID);
  if (!body) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.json(body, {
    headers: {
      "Content-Type": "application/json",
      // Apple's CDN caches this; an hour is long enough to be cheap and short
      // enough that a correction is not stuck for a day.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
