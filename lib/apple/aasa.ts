/**
 * The `apple-app-site-association` (AASA) file, which is what makes Universal
 * Links work: iOS fetches it from `https://<host>/.well-known/apple-app-site-association`
 * and, if the app is installed, opens matching links in the app instead of Safari.
 *
 * ## Why this is a route in the Next.js app rather than a static file
 *
 * The file has to be signed with the Apple **Team ID**, which is account data,
 * not source. A version with a `TEAMID` placeholder committed to a public repo
 * would be worse than no file at all — see `appleAppSiteAssociation` below.
 *
 * ## The host
 *
 * `duravel.app`, not `app.duravel.app` (Levi, 2026-08-17). The iOS shell was
 * originally specced against `app.duravel.app`, which returns Vercel
 * `404: DEPLOYMENT_NOT_FOUND` — but the deeper problem was that the app cannot
 * currently serve a second host at all: `NEXT_PUBLIC_SITE_URL` is a single value
 * and Stripe, Strava, Oura and the password-reset links all read
 * `env.NEXT_PUBLIC_SITE_URL ?? request.origin`, so env wins and an athlete on the
 * other host is redirected off it mid-OAuth. One host, one set of callbacks.
 *
 * ## Apple's requirements this file has to satisfy
 *
 *  - served at exactly `/.well-known/apple-app-site-association` — **no `.json`
 *    extension**;
 *  - `Content-Type: application/json`;
 *  - **no redirects** on the way to it, and reachable without authentication;
 *  - plain JSON (the old CMS-signed form is long obsolete).
 *
 * Apple's CDN fetches and caches this. That cache is the reason for the Team ID
 * rule below.
 */

/** Reverse-DNS bundle id, fixed across App ID / provisioning / App Store Connect. */
export const IOS_BUNDLE_ID = "app.duravel";

/**
 * Paths that must NOT open in the app.
 *
 * These are the public/marketing pages. Someone sharing a link to the pricing
 * page or the DEKA estimator is sharing it with people who do not have the app;
 * hijacking those into a webview for the few who do is worse for both. Auth and
 * training routes are the opposite case — they are for signed-in athletes and
 * belong in the app.
 *
 * Order matters: iOS evaluates `components` top-down and takes the first match,
 * so every exclusion has to precede the catch-all.
 */
export const PUBLIC_PATHS: readonly string[] = [
  "/",
  "/pricing",
  "/privacy",
  "/terms",
  "/science",
  "/impact",
  "/deka*",
  "/pace*",
  "/tools/*",
];

/**
 * Paths that must open in the app, most specific first.
 *
 * `/auth/*` is the one that actually matters for launch: Supabase's signup
 * confirmation and password-reset emails land there, and if those open in Safari
 * the athlete ends up signed in on the web while the app still shows a login
 * screen.
 */
export const APP_PATHS: readonly string[] = [
  "/auth/*",
  "/account/*",
  "/dashboard*",
  "/program/*",
  "/activity*",
  "/settings*",
  "/onboarding*",
  "/coaching*",
];

export interface AppleAppSiteAssociation {
  applinks: {
    details: Array<{
      appIDs: string[];
      components: Array<Record<string, string | boolean>>;
    }>;
  };
  webcredentials: { apps: string[] };
}

/**
 * Build the AASA for a Team ID, or `null` when there isn't one.
 *
 * **Null is deliberate and the route turns it into a 404.** Apple's CDN caches
 * what it fetches, so publishing a file containing the literal string `TEAMID`
 * would get an invalid association cached against the domain, and Universal
 * Links would keep failing after the real Team ID was configured, for reasons
 * invisible from the app. A 404 is honest: not set up yet, nothing cached,
 * working the moment `APPLE_TEAM_ID` is present.
 *
 * The Team ID is a 10-character alphanumeric string from Apple Developer →
 * Membership. Anything else is a typo, and a typo here fails the same silent,
 * cached way — so it is rejected rather than served.
 */
export function appleAppSiteAssociation(
  teamId: string | undefined,
): AppleAppSiteAssociation | null {
  const id = teamId?.trim();
  if (!id || !/^[A-Z0-9]{10}$/.test(id)) return null;

  const appId = `${id}.${IOS_BUNDLE_ID}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [
            ...PUBLIC_PATHS.map((p) => ({ "/": p, exclude: true, comment: "Public web page" })),
            ...APP_PATHS.map((p) => ({ "/": p, comment: "Signed-in athlete route" })),
          ],
        },
      ],
    },
    // Enables Password AutoFill and associates the domain for Sign in with Apple.
    webcredentials: { apps: [appId] },
  };
}
