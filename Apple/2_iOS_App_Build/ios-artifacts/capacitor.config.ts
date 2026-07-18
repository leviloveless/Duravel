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
 * Connect). Confirm the production URL before first build.
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
    limitsNavigationsToAppBoundDomains: true,
  },

  server: {
    // Remote-shell load target (Master Build Plan D1). Confirm domain.
    url: 'https://app.duravel.app',
    // Only the app's own domain is treated as in-app; everything else opens in
    // the system browser (see App plugin URL handling in Part 3).
    allowNavigation: ['app.duravel.app', '*.duravel.app'],
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
