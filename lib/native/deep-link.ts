/**
 * Links that open the iPhone app (2026-09-28). PURE.
 *
 * Two kinds arrive through Capacitor's `appUrlOpen` event:
 *   - `duravel://auth/confirm?code=…` — the end of a Google / Apple sign-in. The
 *     provider ran in an in-app Safari sheet, which cannot hand a session to the
 *     web view; Supabase sends it back to the app's own scheme instead, and the
 *     web view finishes the exchange at /auth/confirm.
 *   - `https://duravel.app/…` — a Universal Link (a confirm or reset email tapped
 *     in Mail). Opened in the web view so the session lands in the app.
 *
 * Either way the answer is a URL on duravel.app for the web view to load, or
 * null. Nothing else: a link must never take the web view to another host.
 */

export const SITE_ORIGIN = "https://duravel.app";
export const APP_SCHEME = "duravel";

/** Where OAuth returns to in the app. Must be on Supabase's redirect allow-list (`duravel://**`). */
export function appAuthRedirect(next: string): string {
  return `${APP_SCHEME}://auth/confirm?next=${encodeURIComponent(next)}`;
}

export function webUrlForDeepLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  let path: string;
  if (url.protocol === `${APP_SCHEME}:`) {
    // duravel://auth/confirm parses with host "auth" and path "/confirm".
    path = `/${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } else if (url.protocol === "https:" && url.hostname === new URL(SITE_ORIGIN).hostname) {
    path = url.pathname;
  } else {
    return null;
  }

  // Resolve against the site and insist the result is still on it — so no
  // `//evil.example` or backslash trick can turn a path into another host.
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  const target = new URL(`${path}${url.search}`, SITE_ORIGIN);
  return target.origin === SITE_ORIGIN ? target.toString() : null;
}

/** True inside the iPhone app's web view (Capacitor injects its bridge there). */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}
