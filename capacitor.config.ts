import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iPhone app (2026-09-28). A native shell around the live site: it opens
 * https://duravel.app in a web view, so every web deploy reaches the app too and
 * only native changes (this file, `ios/`, the icon) need a new build.
 *
 * Builds run on Codemagic's Macs — see codemagic.yaml and docs/ios/IOS_SETUP.md.
 * Nothing here needs a Mac to edit.
 *
 * ONE HOST. `duravel.app` is the only in-app host. Every other host (Stripe
 * Checkout, Google, Apple, Strava, Oura) leaves the web view — that is what makes
 * Google sign-in work at all, since Google refuses embedded web views. The
 * sign-in buttons open their provider in an in-app Safari sheet instead and come
 * back through the `duravel://` scheme (lib/native/deep-link.ts).
 */
const config: CapacitorConfig = {
  appId: "app.duravel",
  appName: "Duravel",
  // What the shell shows if duravel.app cannot be reached at launch. Capacitor
  // requires a web directory even when it loads a remote URL.
  webDir: "ios-shell",
  // Lets the server and analytics tell app traffic from Safari traffic.
  appendUserAgent: "DuravelApp",
  backgroundColor: "#ffffff",
  server: {
    url: "https://duravel.app",
    // Open on the athlete's dashboard, not the marketing home page. Signed out,
    // the dashboard sends them to /login.
    appStartPath: "dashboard",
    // The apex, explicitly: a wildcard like *.duravel.app matches subdomains only.
    allowNavigation: ["duravel.app"],
    errorPath: "index.html",
  },
  ios: {
    // The site already lays itself out for a phone; let iOS keep it clear of
    // the notch and home bar instead of the page managing safe areas itself.
    contentInset: "automatic",
  },
};

export default config;
