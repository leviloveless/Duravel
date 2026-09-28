/**
 * duravel.app/ios (2026-09-28) — where the QR code on /setup lands. Pure.
 *
 * The QR was printed into the setup page on 2026-09-13 pointing at a route that
 * did not exist. It now resolves in three stages as the app ships, driven by two
 * settings, so nothing has to be redeployed or reprinted along the way:
 *   App Store live   → forward to the listing;
 *   TestFlight open  → offer the public beta link;
 *   neither          → take an email for the beta waitlist.
 */

export type IosDestination =
  { kind: "app_store"; url: string } | { kind: "testflight"; url: string } | { kind: "waitlist" };

/** Only Apple's own hosts, over https — a mistyped setting must not send people elsewhere. */
export function appleUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    return host === "apps.apple.com" || host === "testflight.apple.com" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function iosDestination(
  appStore?: string | null,
  testflight?: string | null,
): IosDestination {
  const store = appleUrl(appStore);
  if (store) return { kind: "app_store", url: store };
  const beta = appleUrl(testflight);
  if (beta) return { kind: "testflight", url: beta };
  return { kind: "waitlist" };
}

export const IOS_WAITLIST_SOURCE = "ios_beta";
