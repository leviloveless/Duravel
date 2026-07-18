/**
 * Duravel — Web ↔ Native bridge (single import surface)
 * ==================================================================
 * The ONE module the hosted web app imports to reach every native capability.
 * Everything else in Part 2 is composed here so app code never touches Capacitor
 * plugins directly.
 *
 *   import { Duravel } from '@/lib/native/Duravel_iOS_Part2_native-bridge';
 *
 *   // once, as early as possible in the root layout:
 *   await Duravel.init({
 *     onReconnect: () => queryClient.invalidateQueries(),
 *     onRootBack: () => closeAnyOpenSheet(),   // return true if handled
 *   });
 *
 *   // then anywhere:
 *   Duravel.haptics.success();
 *   Duravel.ready();                // hides splash after first paint
 *   if (Duravel.isNative) { ... }
 *
 * DESIGN NOTES
 *  • Import-safe on the web: `isNative` is false and every call degrades to a
 *    no-op, so the same web bundle runs in a browser and in the iOS shell.
 *  • Injects safe-area.css + dark-mode.css at runtime IF they weren't compiled
 *    into the web app's global stylesheet (belt & suspenders — see injectCSS()).
 *  • Exposes window.DuravelNative so non-module / legacy code and the offline
 *    screen can reach the bridge too.
 *
 * Depends on the sibling Part 2 modules:
 *   ./Duravel_iOS_Part2_haptics
 *   ./Duravel_iOS_Part2_status-bar
 *   ./Duravel_iOS_Part2_splash
 *   ./Duravel_iOS_Part2_network
 *   ./Duravel_iOS_Part2_webview-behavior
 *
 * Install (all plugins used across Part 2):
 *   npm i @capacitor/core @capacitor/app @capacitor/haptics \
 *         @capacitor/status-bar @capacitor/splash-screen \
 *         @capacitor/keyboard @capacitor/network
 *   npx cap sync ios
 */

import { Capacitor } from '@capacitor/core';
import { App, type URLOpenListenerEvent } from '@capacitor/app';

import haptics from './Duravel_iOS_Part2_haptics';
import { setupStatusBar, hideStatusBar, showStatusBar } from './Duravel_iOS_Part2_status-bar';
import { hideSplashWhenReady, showSplash } from './Duravel_iOS_Part2_splash';
import { NetworkController } from './Duravel_iOS_Part2_network';
import { setupWebviewBehavior } from './Duravel_iOS_Part2_webview-behavior';

export interface DuravelInitOptions {
  /** Fired when connectivity returns after being offline (e.g. refetch data). */
  onReconnect?: () => void;
  /** Fired when the app goes offline. */
  onOffline?: () => void;
  /** Handle a back gesture/button. Return true if you consumed it. */
  onRootBack?: () => boolean;
  /** Handle a deep link (duravel://…). Receives the full URL. */
  onDeepLink?: (url: string) => void;
  /** Fired when the app returns to the foreground. */
  onResume?: () => void;
  /** Inject Part 2 CSS at runtime even if bundled into the web app. Default true. */
  injectStyles?: boolean;
}

const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';

let initialized = false;
let networkController: NetworkController | null = null;

/** Inject the Part 2 stylesheets at runtime (fallback if not bundled). */
function injectCSS(): void {
  if (!isNative) return;
  if (document.getElementById('duravel-native-css')) return;

  // These @import the sibling CSS files. If you serve them from the web app,
  // point the hrefs at their deployed paths. If you'd rather inline, paste the
  // contents of the two CSS files into the <style> below.
  const link = document.createElement('link');
  link.id = 'duravel-native-css';
  link.rel = 'stylesheet';
  // Adjust this path to wherever you host the combined native CSS.
  link.href = '/native/duravel-native.css';
  link.onerror = () => {
    // If the hosted file isn't present, at least guarantee a dark root so no
    // white flash — the critical subset, inlined.
    const s = document.createElement('style');
    s.textContent = `html,body,#root,#__next{background:#0B0B0F!important;}html{color-scheme:dark;}`;
    document.head.appendChild(s);
  };
  document.head.appendChild(link);
}

export const Duravel = {
  /** true only inside the native iOS/Android shell. */
  isNative,
  /** 'ios' | 'android' | 'web'. */
  platform,
  /** Semantic haptics (see haptics module). No-op on web. */
  haptics,

  /**
   * Initialize the native layer. Idempotent. Call once, as early as possible.
   */
  async init(opts: DuravelInitOptions = {}): Promise<void> {
    if (initialized) return;
    initialized = true;

    // Web: still expose the surface (all no-ops) so app code is uniform.
    (window as unknown as { DuravelNative?: typeof Duravel }).DuravelNative = Duravel;

    if (!isNative) return;

    if (opts.injectStyles !== false) injectCSS();

    // Order matters: tag platform + CSS behaviors first so styling is correct,
    // then chrome (status bar), then reactive controllers.
    setupWebviewBehavior({ onRootBack: opts.onRootBack });
    await setupStatusBar();

    // Connectivity overlay + reconnect handling.
    networkController = new NetworkController({
      onReconnect: opts.onReconnect,
      onOffline: opts.onOffline,
    });
    await networkController.start();

    // Foreground / resume.
    if (opts.onResume) {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) opts.onResume?.();
      });
    }

    // Deep links (duravel://…). Also handles universal links routed to the app.
    if (opts.onDeepLink) {
      App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
        opts.onDeepLink?.(event.url);
      });
      // Cold-start deep link.
      const launch = await App.getLaunchUrl();
      if (launch?.url) opts.onDeepLink(launch.url);
    }
  },

  /**
   * Signal the app has painted its first meaningful frame. Hides the splash.
   * Call from the root layout's mount effect (or after auth resolves).
   */
  ready(): void {
    hideSplashWhenReady();
  },

  /** Status bar controls (e.g. hide during a full-screen workout timer). */
  statusBar: {
    hide: hideStatusBar,
    show: showStatusBar,
  },

  /** Re-show the splash (rare — hard re-auth flows). */
  showSplash,

  /** Manually query connectivity-driven teardown (e.g. on logout/unmount). */
  async teardown(): Promise<void> {
    await networkController?.stop();
    networkController = null;
    initialized = false;
  },

  /** App version / build info (handy for support & feature gating). */
  async appInfo(): Promise<{ version: string; build: string } | null> {
    if (!isNative) return null;
    try {
      const info = await App.getInfo();
      return { version: info.version, build: info.build };
    } catch {
      return null;
    }
  },
};

export type DuravelBridge = typeof Duravel;
export default Duravel;

// Optional global typing so window.DuravelNative is typed for consumers.
declare global {
  interface Window {
    DuravelNative?: typeof Duravel;
  }
}
