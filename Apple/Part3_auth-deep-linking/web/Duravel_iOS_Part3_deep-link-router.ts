/**
 * Duravel iOS — Part 3
 * Deep-link router for the Capacitor shell.
 *
 * Listens for @capacitor/app's `appUrlOpen` event (fired for BOTH Universal
 * Links https://app.duravel.app/... AND custom-scheme links duravel://...) and
 * routes the incoming URL into the correct in-webview route.
 *
 * The tricky cases are Supabase's auth links:
 *
 *   1. PKCE / magic-link style:  ...?code=<authCode>            (query param)
 *      → exchangeCodeForSession(code) then navigate to /dashboard.
 *
 *   2. Implicit / hash style:    ...#access_token=...&refresh_token=...&type=recovery
 *      → setSession({ access_token, refresh_token }); for type=recovery send
 *        the user to /reset-password so they can set a new password.
 *
 *   3. Errors:                   ...?error=access_denied&error_description=...
 *      → surface a friendly message on the login screen.
 *
 * Because the app already loads https://app.duravel.app via Capacitor
 * `server.url`, "navigating" in-webview is just a client-side route change.
 * We prefer replacing the location so the deep link doesn't pollute history,
 * and we strip tokens from the visible URL after consuming them.
 */

import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { getSupabase } from './Duravel_iOS_Part3_supabase-client';

/** Where to send the user after a given Supabase auth link type. */
const POST_AUTH_ROUTES: Record<string, string> = {
  recovery: '/reset-password',
  signup: '/dashboard',
  magiclink: '/dashboard',
  invite: '/onboarding',
  email_change: '/settings/account',
};

type Navigate = (path: string, opts?: { replace?: boolean }) => void;

/**
 * Default navigation: hard client-side navigation within the loaded web app.
 * If the web app exposes a router (e.g. window.__duravelNavigate), prefer it
 * so we don't full-reload. Falls back to location assignment.
 */
function defaultNavigate(path: string, opts?: { replace?: boolean }): void {
  const anyWin = window as any;
  if (typeof anyWin.__duravelNavigate === 'function') {
    anyWin.__duravelNavigate(path, opts);
    return;
  }
  const url = new URL(path, window.location.origin).toString();
  if (opts?.replace) window.location.replace(url);
  else window.location.assign(url);
}

/** Parse both the search string and the hash fragment into one param bag. */
function collectParams(u: URL): URLSearchParams {
  const params = new URLSearchParams(u.search);
  const hash = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
  if (hash) {
    const hp = new URLSearchParams(hash);
    hp.forEach((v, k) => {
      if (!params.has(k)) params.set(k, v);
    });
  }
  return params;
}

export interface RouterOptions {
  navigate?: Navigate;
  /** Called with a user-facing message when an auth link fails. */
  onError?: (message: string) => void;
}

/**
 * Handle a single incoming URL. Exported for unit testing without the plugin.
 * Returns the route it navigated to (or null if it ignored the URL).
 */
export async function handleIncomingUrl(
  rawUrl: string,
  opts: RouterOptions = {},
): Promise<string | null> {
  const navigate = opts.navigate ?? defaultNavigate;
  const onError = opts.onError ?? ((m) => console.warn('[Duravel][deeplink]', m));
  const supabase = getSupabase();

  let u: URL;
  try {
    // Custom-scheme URLs (duravel://auth/callback) parse fine with URL().
    u = new URL(rawUrl);
  } catch {
    onError('Malformed link');
    return null;
  }

  // Normalise: for custom scheme, host+pathname carry the route
  // (duravel://auth/callback → host "auth", path "/callback"). For Universal
  // Links the pathname is the route (/auth/callback).
  const isCustomScheme = u.protocol === 'duravel:';
  const path = isCustomScheme
    ? `/${u.host}${u.pathname}`.replace(/\/+$/, '') || '/'
    : u.pathname;

  const params = collectParams(u);

  // --- 0. Explicit auth error from Supabase/Apple ---
  const err = params.get('error') || params.get('error_code');
  if (err) {
    const desc =
      params.get('error_description') ||
      params.get('error_code') ||
      'Sign-in link could not be used.';
    onError(decodeURIComponent(desc.replace(/\+/g, ' ')));
    navigate('/login', { replace: true });
    return '/login';
  }

  // --- 1. PKCE code exchange (?code=...) ---
  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      onError(error.message);
      navigate('/login', { replace: true });
      return '/login';
    }
    const type = params.get('type') ?? 'magiclink';
    const dest = POST_AUTH_ROUTES[type] ?? '/dashboard';
    navigate(dest, { replace: true });
    return dest;
  }

  // --- 2. Implicit tokens in hash (#access_token=...&refresh_token=...) ---
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    if (error) {
      onError(error.message);
      navigate('/login', { replace: true });
      return '/login';
    }
    const type = params.get('type') ?? 'magiclink';
    const dest = POST_AUTH_ROUTES[type] ?? '/dashboard';
    navigate(dest, { replace: true });
    return dest;
  }

  // --- 3. Non-auth deep links: workout/program/invite/etc. ---
  //     Just forward the path (+ preserved query) into the web app.
  const search = u.search || '';
  const dest = `${path}${search}` || '/';
  navigate(dest);
  return dest;
}

let _registered = false;

/**
 * Register the appUrlOpen listener. Call once at launch (native-bootstrap).
 * Also handles the "cold start" case where the app was launched *by* a link:
 * @capacitor/app's getLaunchUrl() returns that initial URL.
 */
export async function initDeepLinkRouter(opts: RouterOptions = {}): Promise<void> {
  if (_registered) return;
  _registered = true;

  // Warm launches: link tapped while app is running/backgrounded.
  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    if (event?.url) void handleIncomingUrl(event.url, opts);
  });

  // Cold launch: app opened directly by a link.
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handleIncomingUrl(launch.url, opts);
  } catch {
    /* getLaunchUrl not available on web — ignore */
  }
}
