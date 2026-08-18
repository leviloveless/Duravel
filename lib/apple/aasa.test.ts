/**
 * The Universal Links association file (Levi, 2026-08-17).
 *
 * ## Why this file is worth testing at all
 *
 * Every way it can be wrong fails the same way: **silently, and cached.** iOS
 * fetches `/.well-known/apple-app-site-association` through Apple's CDN, caches
 * the result, and if the file is malformed or names the wrong App ID, Universal
 * Links simply do not fire. There is no error surface — links open in Safari and
 * look like a design decision. Then the cache holds the bad answer after the fix.
 *
 * So the rules that matter are structural, and they are what this pins:
 *
 *  1. a placeholder or malformed Team ID must never be SERVED (→ `null` → 404),
 *     because a cached invalid association outlives the deploy that caused it;
 *  2. `/auth/*` must open in the app — Supabase's confirm and password-reset
 *     emails land there, and if they open in Safari the athlete ends up signed
 *     in on the web while the app still shows a login screen;
 *  3. exclusions must precede the routes they overlap, because iOS takes the
 *     FIRST matching component and stops.
 *
 * ## The host
 *
 * `duravel.app`. The shell was specced against `app.duravel.app`, which returns
 * Vercel `404: DEPLOYMENT_NOT_FOUND` — and repointing it was the right fix
 * rather than attaching the subdomain, because `NEXT_PUBLIC_SITE_URL` is a
 * single value that Stripe, Strava, Oura and password reset all read, so a
 * second host redirects athletes off itself mid-OAuth.
 */
import { describe, it, expect } from "vitest";
import { appleAppSiteAssociation, APP_PATHS, PUBLIC_PATHS, IOS_BUNDLE_ID } from "./aasa";

const TEAM = "A1B2C3D4E5";

describe("a Team ID that isn't real is never served", () => {
  it("refuses the placeholder that ships in the drafted artifact", () => {
    // Apple/Part3_auth-deep-linking/web/...json literally contains
    // "TEAMID.app.duravel". Serving that would cache an invalid association.
    expect(appleAppSiteAssociation("TEAMID")).toBeNull();
  });

  it("refuses missing, blank and whitespace", () => {
    expect(appleAppSiteAssociation(undefined)).toBeNull();
    expect(appleAppSiteAssociation("")).toBeNull();
    expect(appleAppSiteAssociation("   ")).toBeNull();
  });

  it("refuses anything that is not exactly 10 alphanumeric characters", () => {
    for (const bad of ["A1B2C3D4E", "A1B2C3D4E5F", "a1b2c3d4e5", "A1B2-C3D4E", "A1B2 C3D4E5"]) {
      expect(appleAppSiteAssociation(bad), bad).toBeNull();
    }
  });

  it("accepts a real-shaped Team ID and trims stray whitespace from the env var", () => {
    expect(appleAppSiteAssociation(TEAM)).not.toBeNull();
    expect(appleAppSiteAssociation(` ${TEAM}\n`)).toEqual(appleAppSiteAssociation(TEAM));
  });
});

describe("the association names the right app", () => {
  const aasa = appleAppSiteAssociation(TEAM)!;

  it("uses TEAMID.bundleid, the form Apple requires", () => {
    expect(aasa.applinks.details[0]!.appIDs).toEqual([`${TEAM}.${IOS_BUNDLE_ID}`]);
  });

  it("keeps the bundle id fixed — it must match App ID, provisioning and ASC", () => {
    expect(IOS_BUNDLE_ID).toBe("app.duravel");
  });

  it("declares webcredentials too, for Password AutoFill and Sign in with Apple", () => {
    expect(aasa.webcredentials.apps).toEqual([`${TEAM}.${IOS_BUNDLE_ID}`]);
  });
});

describe("path routing", () => {
  const components = appleAppSiteAssociation(TEAM)!.applinks.details[0]!.components;
  const paths = components.map((c) => c["/"] as string);
  const isExcluded = (p: string) => components.find((c) => c["/"] === p)?.exclude === true;

  it("opens the auth callback in the app — the one that breaks login if wrong", () => {
    expect(paths).toContain("/auth/*");
    expect(isExcluded("/auth/*")).toBe(false);
  });

  it("opens the athlete's own training routes in the app", () => {
    for (const p of ["/program/*", "/dashboard*", "/activity*", "/settings*"]) {
      expect(paths, p).toContain(p);
      expect(isExcluded(p), p).toBe(false);
    }
  });

  it("leaves the marketing pages in the browser", () => {
    // Sharing the pricing page or the DEKA estimator is sharing it with people
    // who do NOT have the app. Hijacking those into a webview helps nobody.
    for (const p of ["/", "/pricing", "/privacy", "/terms"]) {
      expect(isExcluded(p), p).toBe(true);
    }
  });

  it("puts EVERY exclusion before the app routes — iOS takes the first match", () => {
    // If an exclusion ever lands after an overlapping app route, the app route
    // wins and the public page is silently hijacked into the webview.
    const lastExclude = components.reduce((acc, c, i) => (c.exclude === true ? i : acc), -1);
    const firstInclude = components.findIndex((c) => c.exclude !== true);
    expect(lastExclude).toBeLessThan(firstInclude);
  });

  it("does not claim the bare root path as an app route", () => {
    // "/" as a catch-all would swallow every marketing link on the domain.
    expect(isExcluded("/")).toBe(true);
    expect(APP_PATHS).not.toContain("/");
  });

  it("has no path in both lists — an overlap is an ambiguity, not a preference", () => {
    for (const p of APP_PATHS) expect(PUBLIC_PATHS, p).not.toContain(p);
  });

  it("carries a comment on every component, so the next reader knows the intent", () => {
    for (const c of components) expect(typeof c.comment).toBe("string");
  });
});

describe("the payload is what Apple will actually parse", () => {
  it("survives a JSON round-trip unchanged — it is served via NextResponse.json", () => {
    const aasa = appleAppSiteAssociation(TEAM)!;
    expect(JSON.parse(JSON.stringify(aasa))).toEqual(aasa);
  });

  it("has exactly one details entry — iOS matches the first and ignores the rest", () => {
    expect(appleAppSiteAssociation(TEAM)!.applinks.details).toHaveLength(1);
  });
});
