/**
 * Duravel — Status bar setup
 * ------------------------------------------------------------------
 * Duravel is a dark-branded app, so the status bar must use LIGHT content
 * (white glyphs) on the dark background. On iOS "Style.Dark" = light text
 * (the naming refers to the UI *content* style, not the bar color).
 *
 * Install:
 *   npm i @capacitor/status-bar
 *   npx cap sync ios
 *
 * Also set in ios/App/App/Info.plist (belt & suspenders — keeps the very first
 * frame correct before JS runs):
 *   <key>UIStatusBarStyle</key>              <string>UIStatusBarStyleLightContent</string>
 *   <key>UIViewControllerBasedStatusBarAppearance</key> <false/>
 *
 * Note: with Capacitor's default (non-overlay) webview on iOS, the web content
 * sits below the status bar, so we do NOT set overlaysWebView(true) here — that
 * would require the web layout to pad for the bar. Safe-area CSS handles insets
 * instead (see Duravel_iOS_Part2_safe-area.css).
 */

import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

const isNative = Capacitor.isNativePlatform();
const BRAND_BG = '#0B0B0F';

export async function setupStatusBar(): Promise<void> {
  if (!isNative) return;
  try {
    // Light glyphs for our dark theme.
    await StatusBar.setStyle({ style: Style.Dark });

    // setBackgroundColor is Android-only in Capacitor; guard to avoid a
    // rejected promise / console noise on iOS.
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: BRAND_BG });
    }

    // Ensure content is not tucked under the bar.
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    /* status bar not critical — ignore */
  }
}

/** Hide the status bar (e.g. during a full-screen workout timer). */
export async function hideStatusBar(): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.hide();
  } catch {
    /* ignore */
  }
}

/** Restore the status bar after a full-screen view. */
export async function showStatusBar(): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.show();
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* ignore */
  }
}
