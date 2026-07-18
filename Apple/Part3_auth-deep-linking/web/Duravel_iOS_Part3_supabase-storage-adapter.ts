/**
 * Duravel iOS — Part 3
 * Supabase auth-session storage adapter for the Capacitor native shell.
 *
 * WHAT THIS DOES
 * --------------
 * Supabase-js persists the auth session (access token, refresh token, user)
 * through a pluggable `storage` object that implements getItem/setItem/removeItem.
 * In a browser it defaults to `localStorage`. Inside the Capacitor webview,
 * localStorage is (a) not guaranteed to survive across app upgrades / WKWebView
 * data purges and (b) not encrypted at rest. This module replaces it with a
 * native-backed adapter so the user stays logged in across cold launches.
 *
 * TWO BACKENDS ARE PROVIDED:
 *   1. PreferencesStorageAdapter  — @capacitor/preferences (iOS: UserDefaults).
 *                                   Durable across launches. NOT encrypted.
 *   2. SecureStorageAdapter       — @capacitor-community/secure-storage-plugin
 *                                   (iOS: Keychain, hardware-backed). Encrypted.
 *
 * IMPORTANT SECURITY NOTE (recorded for Levi in NEEDS_LEVI):
 *   @capacitor/preferences on iOS is backed by UserDefaults, which is plist
 *   storage in the app sandbox — NOT the Keychain, and NOT encrypted beyond
 *   the device's data-protection class. The refresh token is a long-lived
 *   credential, so for a health/fitness app handling payments we default to
 *   the Keychain-backed SecureStorageAdapter below. Preferences is kept as a
 *   fallback for platforms where the secure plugin is unavailable (e.g. web).
 *
 * USAGE (see native-bootstrap.ts for the wired-up client):
 *   import { createClient } from '@supabase/supabase-js'
 *   import { pickAuthStorage } from './Duravel_iOS_Part3_supabase-storage-adapter'
 *
 *   export const supabase = createClient(URL, ANON_KEY, {
 *     auth: {
 *       storage: pickAuthStorage(),
 *       storageKey: 'duravel.auth',      // namespaced key in native storage
 *       persistSession: true,
 *       autoRefreshToken: true,
 *       detectSessionInUrl: false,       // we route email links ourselves
 *     },
 *   })
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/**
 * The minimal async storage shape supabase-js expects. supabase-js awaits
 * every call, so returning Promises is fine (and required for native plugins).
 */
export interface SupportedStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

/**
 * Backend 1 — @capacitor/preferences (UserDefaults on iOS).
 * Durable, unencrypted. Good fallback; not our default on device.
 */
export const PreferencesStorageAdapter: SupportedStorage = {
  async getItem(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  },
  async removeItem(key: string): Promise<void> {
    await Preferences.remove({ key });
  },
};

/**
 * Backend 2 — Keychain-backed secure storage.
 *
 * Uses @capacitor-community/secure-storage-plugin. We import it lazily so the
 * bundle still builds on web (where the plugin has no implementation). If the
 * plugin is missing at runtime, callers fall back to Preferences.
 *
 * The plugin API: SecureStoragePlugin.get({ key }) throws when the key does
 * not exist (rather than returning null), so we translate that into null.
 */
let _securePlugin: any | undefined;
async function getSecurePlugin(): Promise<any | null> {
  if (_securePlugin !== undefined) return _securePlugin;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import('@capacitor-community/secure-storage-plugin');
    _securePlugin = mod.SecureStoragePlugin ?? null;
  } catch {
    _securePlugin = null;
  }
  return _securePlugin;
}

export const SecureStorageAdapter: SupportedStorage = {
  async getItem(key: string): Promise<string | null> {
    const plugin = await getSecurePlugin();
    if (!plugin) return PreferencesStorageAdapter.getItem(key);
    try {
      const { value } = await plugin.get({ key });
      return value ?? null;
    } catch {
      // Plugin throws when key is absent — treat as "no session".
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    const plugin = await getSecurePlugin();
    if (!plugin) return PreferencesStorageAdapter.setItem(key, value);
    await plugin.set({ key, value });
  },
  async removeItem(key: string): Promise<void> {
    const plugin = await getSecurePlugin();
    if (!plugin) return PreferencesStorageAdapter.removeItem(key);
    try {
      await plugin.remove({ key });
    } catch {
      /* already gone */
    }
  },
};

/**
 * Choose the right adapter for the current runtime:
 *   - Native iOS/Android → Keychain-backed SecureStorageAdapter
 *   - Web (Next.js in a normal browser, or `duravel dev`) → localStorage
 *     (returned as undefined so supabase-js uses its own default)
 *
 * Returning `undefined` on web lets supabase-js keep its built-in localStorage
 * behavior, so the same client factory works in the browser and in the shell.
 */
export function pickAuthStorage(): SupportedStorage | undefined {
  if (!Capacitor.isNativePlatform()) return undefined;
  return SecureStorageAdapter;
}
