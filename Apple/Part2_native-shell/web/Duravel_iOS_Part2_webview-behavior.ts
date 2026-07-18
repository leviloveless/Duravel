/**
 * Duravel — Webview native-feel behaviors
 * ------------------------------------------------------------------
 * Keyboard handling, overscroll/rubber-band suppression, iOS swipe-back gesture,
 * and platform tagging (adds html.duravel-native so the CSS files activate).
 *
 * Install:
 *   npm i @capacitor/keyboard @capacitor/app
 *   npx cap sync ios
 *
 * NATIVE-SIDE CONFIG (goes in capacitor.config — coordinate with Part 1):
 *   ios: {
 *     // Disable the whole-page rubber-band bounce so the shell doesn't feel
 *     // like a webpage. Inner scrollers still scroll (see CSS below).
 *     scrollEnabled: false,
 *     contentInset: 'never',
 *   },
 *   plugins: {
 *     Keyboard: {
 *       resize: 'native',        // let iOS resize the webview for the keyboard
 *       resizeOnFullScreen: true,
 *     },
 *   }
 *
 * SWIPE-BACK: the hosted app is a single-origin SPA loaded via server.url, so
 * iOS's edge-swipe maps to webview history. We enable allowsBackForwardNavigationGestures
 * in the native AppDelegate/config (see README) and additionally intercept the
 * hardware/gesture back at the JS layer via @capacitor/app 'backButton' where
 * relevant, so swiping back from the app root can be trapped instead of exiting.
 */

import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { App } from '@capacitor/app';

const isNative = Capacitor.isNativePlatform();
const isIOS = isNative && Capacitor.getPlatform() === 'ios';

/** Add html.duravel-native (+ .ios/.android) so the injected CSS activates. */
export function tagNativePlatform(): void {
  const el = document.documentElement;
  if (isNative) {
    el.classList.add('duravel-native');
    el.classList.add(Capacitor.getPlatform()); // 'ios' | 'android'
  }
}

/**
 * Suppress the document-level rubber-band bounce while still allowing real
 * inner scroll areas (anything marked [data-scroll] or .scrollable) to scroll.
 * Complements ios.scrollEnabled:false in the native config.
 */
export function lockDocumentOverscroll(): void {
  if (!isNative) return;

  // CSS: stop overscroll chaining at the root.
  const style = document.createElement('style');
  style.setAttribute('data-duravel', 'overscroll');
  style.textContent = `
    html.duravel-native, html.duravel-native body {
      overscroll-behavior: none;
      -webkit-overflow-scrolling: auto;
      height: 100%;
      overflow: hidden;               /* body itself doesn't scroll */
    }
    html.duravel-native [data-scroll],
    html.duravel-native .scrollable {
      overflow-y: auto;
      -webkit-overflow-scrolling: touch; /* momentum scroll inside panels */
      overscroll-behavior: contain;
    }
  `;
  document.head.appendChild(style);

  // JS: block touchmove that would scroll the document itself, but let touches
  // inside a designated scroller through.
  document.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const scroller = target.closest('[data-scroll], .scrollable');
      if (!scroller) {
        // Not inside a scroller → this move would bounce the page. Block it.
        if (e.cancelable) e.preventDefault();
      }
    },
    { passive: false },
  );
}

/**
 * Keyboard behavior: keep the focused input visible and emit body classes so
 * the app can shift sticky footers up when the keyboard is open.
 */
export function setupKeyboard(): void {
  if (!isNative) return;

  Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.style.setProperty('--duravel-keyboard-h', `${info.keyboardHeight}px`);
    document.body.classList.add('duravel-keyboard-open');
    // Nudge the focused element into view (native resize handles most of it).
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.scrollIntoView === 'function') {
      setTimeout(() => active.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    }
  });

  Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.style.setProperty('--duravel-keyboard-h', '0px');
    document.body.classList.remove('duravel-keyboard-open');
  });
}

/**
 * iOS swipe-back handling.
 *
 * Native gesture (allowsBackForwardNavigationGestures) drives WKWebView history
 * directly, which is what we want for in-app navigation. This adds a JS guard so
 * that a back gesture at the SPA's root, or while a modal is open, is handled by
 * the app instead of walking history off the app.
 *
 * @param onRootBack return true if you handled it (e.g. closed a sheet); return
 *                   false to allow default history back.
 */
export function setupSwipeBack(onRootBack?: () => boolean): void {
  if (!isNative) return;

  // Capacitor routes the iOS edge-swipe/back through the 'backButton' event.
  App.addListener('backButton', ({ canGoBack }) => {
    // Give the app a chance to intercept (close modal, exit fullscreen timer…).
    if (onRootBack && onRootBack()) return;

    if (canGoBack) {
      window.history.back();
    }
    // At true root we intentionally do nothing (don't exit the app on iOS).
  });
}

/** Convenience: apply all native-feel behaviors in the right order. */
export function setupWebviewBehavior(opts: { onRootBack?: () => boolean } = {}): void {
  tagNativePlatform();
  lockDocumentOverscroll();
  setupKeyboard();
  setupSwipeBack(opts.onRootBack);

  if (isIOS) {
    // Prevent the magnifying-glass / callout on long-press for a more app-like feel
    // (inputs & [data-selectable] keep normal selection).
    const style = document.createElement('style');
    style.setAttribute('data-duravel', 'ios-touch');
    style.textContent = `
      html.ios *:not(input):not(textarea):not([data-selectable]) {
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
      }
      html.ios input, html.ios textarea, html.ios [data-selectable] {
        -webkit-user-select: text;
        user-select: text;
      }
    `;
    document.head.appendChild(style);
  }
}
