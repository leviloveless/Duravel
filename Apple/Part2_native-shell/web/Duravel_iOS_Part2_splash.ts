/**
 * Duravel — Splash screen control
 * ------------------------------------------------------------------
 * Part 1's capacitor.config already configures the SplashScreen plugin to NOT
 * auto-hide (launchAutoHide:false) so we control the exact moment it lifts —
 * after the hosted web app has painted its first real frame. This eliminates
 * the "splash → white flash → app" seam.
 *
 * Reference of the Part 1 config this pairs with (do not duplicate — shown for
 * context):
 *   plugins: {
 *     SplashScreen: {
 *       launchShowDuration: 0,
 *       launchAutoHide: false,          // WE hide it, from JS, below
 *       backgroundColor: '#0B0B0F',     // brand dark — matches LaunchScreen
 *       showSpinner: false,
 *       splashFullScreen: true,
 *       splashImmersive: true,
 *     },
 *   }
 *
 * Install:
 *   npm i @capacitor/splash-screen
 *   npx cap sync ios
 */

import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';

const isNative = Capacitor.isNativePlatform();

/**
 * Hide the splash once the app is genuinely ready to be seen.
 *
 * Call from the web app AFTER first meaningful paint — e.g. at the end of the
 * root layout's mount effect, or after auth state resolves. A hard timeout
 * guarantees the splash never gets stuck if paint signaling is missed.
 *
 * @param opts.fadeMs   crossfade duration (ms) for a soft handoff. Default 200.
 * @param opts.maxWaitMs safety cap — hide no matter what after this. Default 4000.
 */
export async function hideSplash(opts: { fadeMs?: number; maxWaitMs?: number } = {}): Promise<void> {
  if (!isNative) return;
  const fadeMs = opts.fadeMs ?? 200;
  try {
    await SplashScreen.hide({ fadeOutDuration: fadeMs });
  } catch {
    /* ignore */
  }
}

/**
 * Convenience: wire the splash to hide on the next paint frame, with a safety
 * timeout. Idempotent — only hides once. Returns immediately; hiding happens
 * asynchronously.
 */
export function hideSplashWhenReady(maxWaitMs = 4000): void {
  if (!isNative) return;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    void hideSplash();
  };

  // Two rAFs = after the browser has committed at least one real frame.
  requestAnimationFrame(() => requestAnimationFrame(go));

  // Safety net: never let the splash hang.
  setTimeout(go, maxWaitMs);
}

/** Re-show the splash (rarely needed — e.g. hard re-auth). */
export async function showSplash(): Promise<void> {
  if (!isNative) return;
  try {
    await SplashScreen.show({ autoHide: false });
  } catch {
    /* ignore */
  }
}
