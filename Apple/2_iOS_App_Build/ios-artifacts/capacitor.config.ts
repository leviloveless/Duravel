import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Duravel iOS — Capacitor configuration.
 *
 * v1 strategy (Master Build Plan D1): remote shell. The native app loads the
 * hosted production web app and layers native plugins (HealthKit, Push, IAP,
 * StatusBar, SplashScreen, Haptics, Preferences) on top. Swap `server.url` for a
 * bundled `webDir` build later if offline / App Store review requires it.
 *
 * NOTE: keep `appId` = app.duravel everywhere (App ID, provisioning, App Store
 * Connect).
 *
 * ## The production URL is `duravel.app` — RESOLVED 2026-08-17
 *
 * This used to load `app.duravel.app`, which returns Vercel
 * `404: DEPLOYMENT_NOT_FOUND` — no project claims that hostname, so the shell
 * would have shown a Vercel error page on first launch.
 *
 * Repointing here was the fix rather than attaching the subdomain, because the
 * web app cannot serve a second host as things stand: `NEXT_PUBLIC_SITE_URL` is
 * a single value, and Stripe checkout, the Strava and Oura OAuth callbacks and
 * the password-reset links all resolve
 * `env.NEXT_PUBLIC_SITE_URL ?? request.origin`. Env wins, so an athlete on
 * `app.duravel.app` connecting Strava would be redirected to `duravel.app`
 * mid-flow — and, with the old `allowNavigation` below, straight out of the
 * webview, because `*.duravel.app` does not match the apex `duravel.app`.
 */
const config: CapacitorConfig = {
  appId: 'app.duravel',
  appName: 'Duravel',

  // Bundled web assets fallback dir (used if we move off the remote shell).
  // For the remote-shell build this can stay a minimal placeholder folder.
  webDir: 'public',

  ios: {
    // Let content flow under the status bar; we manage insets in CSS (Part 2).
    contentInset: 'always',
    // Duravel is a dark-branded app; keep the webview background dark to avoid
    // white flashes between splash and first paint.
    backgroundColor: '#0B0B0F',
    // Allow HealthKit / camera prompts to present over the webview.
    // ⚠️ This flag requires a `WKAppBoundDomains` array in Info.plist, and it
    // must list `duravel.app` (max 10 entries). Stripe Checkout, Strava and
    // Oura all navigate OFF-domain and are deliberately not listed — they open
    // in the system browser, which is the intended flow.
    limitsNavigationsToAppBoundDomains: true,
  },

  server: {
    // Remote-shell load target (Master Build Plan D1). This is the live app.
    url: 'https://duravel.app',
    // Only the app's own domain is treated as in-app; everything else opens in
    // the system browser (see App plugin URL handling in Part 3).
    // ⚠️ The apex is listed EXPLICITLY: `*.duravel.app` matches subdomains only,
    // so a wildcard alone would send every in-app navigation to Safari.
    allowNavigation: ['duravel.app', '*.duravel.app'],
    cleartext: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: false, // we hide it after first web paint (Part 2)
      backgroundColor: '#0B0B0F',
      showSpinner: false,
      iosSpinnerStyle: 'small',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'native',
    },
  },
};

export default config;
