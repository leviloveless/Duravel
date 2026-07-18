/**
 * Duravel iOS — Part 6
 * Push registration with PRIMING.
 *
 * Golden rule: never cold-prompt the iOS system permission dialog. iOS only lets
 * you ask ONCE — if the user denies, you can never re-prompt (they must go to
 * Settings). So we show our OWN priming sheet first, and only call the real
 * `PushNotifications.requestPermissions()` if they tap "Turn on".
 *
 * Where to call from:
 *   - Do NOT call on app launch. Call `maybePrimePush()` at a moment of earned
 *     trust, e.g. right after the user finishes their FIRST logged session, or
 *     when they enable a workout reminder. Pass a reason string for copy.
 *   - Call `syncPushRegistrationIfGranted()` on every launch AFTER login — this
 *     silently re-registers (token can rotate) but never shows UI.
 *
 * This module is framework-agnostic (no React import). `showPrimingSheet` is
 * injected so the web app can render it with its own UI kit. See the bottom for
 * a wiring example against the Part 3 deep-link handler + Supabase client.
 */

import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type Token,
  type PermissionStatus,
} from '@capacitor/push-notifications';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ApnsEnv = 'production' | 'sandbox';

export interface PrimingCopy {
  title: string;
  body: string;
  confirmLabel: string; // "Turn on notifications"
  dismissLabel: string; // "Not now"
}

/**
 * Injected UI. Resolve true if the user accepted the priming (wants the real
 * prompt), false if they dismissed. The web app renders this however it likes.
 */
export type ShowPrimingSheet = (copy: PrimingCopy) => Promise<boolean>;

export interface RegisterDeps {
  supabase: SupabaseClient;
  showPrimingSheet: ShowPrimingSheet;
  /** Called on token errors / registration failures for logging. */
  onError?: (where: string, err: unknown) => void;
  /** Optional current app version string, stored with the token. */
  appVersion?: string;
  /** Optional stable per-install id (e.g. from @capacitor/device). */
  deviceId?: string;
  /** Injected so we don't hard-import a build flag. Defaults to prod. */
  resolveApnsEnv?: () => ApnsEnv;
}

// A tiny local key so we don't re-prime the SAME session repeatedly. This is a
// soft guard only; the real source of truth is the OS permission status.
let _primedThisSession = false;

// ─────────────────────────────────────────────────────────────────────────────
// Platform guard
// ─────────────────────────────────────────────────────────────────────────────

export function isNativePush(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

/**
 * APNs environment of THIS build. A sandbox (dev) token is rejected by the prod
 * APNs host and vice-versa, so we persist which host minted it.
 * Override via deps.resolveApnsEnv for custom build flags. Default heuristic:
 * a debug build (dev) → 'sandbox', else 'production'.
 */
function defaultResolveApnsEnv(): ApnsEnv {
  // Capacitor sets no direct debug flag; teams typically inject one at build.
  // Fallback: treat non-production as sandbox only if an explicit global says so.
  // Safer default is 'production' because TestFlight/App Store builds are prod.
  const g = globalThis as unknown as { __DURAVEL_APNS_ENV__?: ApnsEnv };
  return g.__DURAVEL_APNS_ENV__ ?? 'production';
}

// ─────────────────────────────────────────────────────────────────────────────
// Priming + permission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show our own priming sheet, and ONLY if accepted, ask iOS for permission and
 * register. Returns the final permission state. No-op (returns 'denied') on
 * non-native platforms.
 *
 * Idempotent per session and respects prior OS decisions:
 *   - If already granted → just (re)registers, no UI.
 *   - If already denied by OS → shows nothing (can't re-prompt); returns 'denied'.
 *   - If 'prompt' (never asked) → shows priming sheet, then maybe real prompt.
 */
export async function maybePrimePush(
  deps: RegisterDeps,
  copy: PrimingCopy,
): Promise<PermissionStatus['receive']> {
  if (!isNativePush()) return 'denied';

  let status: PermissionStatus;
  try {
    status = await PushNotifications.checkPermissions();
  } catch (err) {
    deps.onError?.('checkPermissions', err);
    return 'denied';
  }

  if (status.receive === 'granted') {
    await registerAndStore(deps);
    return 'granted';
  }

  // iOS: once denied you cannot re-prompt. Bail silently — a settings-deep-link
  // CTA should be surfaced elsewhere in the UI, not another OS prompt.
  if (status.receive === 'denied') {
    return 'denied';
  }

  // status.receive === 'prompt' (or 'prompt-with-rationale'): show OUR sheet.
  if (_primedThisSession) return status.receive;
  _primedThisSession = true;

  let accepted = false;
  try {
    accepted = await deps.showPrimingSheet(copy);
  } catch (err) {
    deps.onError?.('showPrimingSheet', err);
    return status.receive;
  }

  if (!accepted) {
    // User said "Not now" — do NOT fire the system prompt. We keep our one shot.
    return status.receive;
  }

  // Now the real system prompt (this is the single allowed OS ask).
  let requested: PermissionStatus;
  try {
    requested = await PushNotifications.requestPermissions();
  } catch (err) {
    deps.onError?.('requestPermissions', err);
    return status.receive;
  }

  if (requested.receive === 'granted') {
    await registerAndStore(deps);
  }
  return requested.receive;
}

/**
 * Silent re-registration path — call on every authed launch. If (and only if)
 * permission is already granted, (re)register and upsert the (possibly rotated)
 * token. Never shows UI.
 */
export async function syncPushRegistrationIfGranted(deps: RegisterDeps): Promise<void> {
  if (!isNativePush()) return;
  try {
    const status = await PushNotifications.checkPermissions();
    if (status.receive === 'granted') {
      await registerAndStore(deps);
    }
  } catch (err) {
    deps.onError?.('syncPushRegistrationIfGranted', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Register + persist token
// ─────────────────────────────────────────────────────────────────────────────

let _listenersBound = false;

/**
 * Wire the plugin listeners ONCE, then call register(). The 'registration'
 * event fires with the APNs token; we upsert it to Supabase via the RPC.
 */
async function registerAndStore(deps: RegisterDeps): Promise<void> {
  const resolveEnv = deps.resolveApnsEnv ?? defaultResolveApnsEnv;

  if (!_listenersBound) {
    _listenersBound = true;

    await PushNotifications.addListener('registration', async (token: Token) => {
      try {
        await upsertToken(deps, token.value, resolveEnv());
      } catch (err) {
        deps.onError?.('upsertToken', err);
      }
    });

    await PushNotifications.addListener('registrationError', (err) => {
      deps.onError?.('registrationError', err);
    });
  }

  try {
    await PushNotifications.register();
  } catch (err) {
    deps.onError?.('register', err);
  }
}

/** Upsert via the SECURITY INVOKER RPC so RLS + token re-homing are enforced. */
async function upsertToken(deps: RegisterDeps, token: string, apnsEnv: ApnsEnv): Promise<void> {
  const { error } = await deps.supabase.rpc('upsert_push_token', {
    p_token: token,
    p_platform: 'ios',
    p_apns_env: apnsEnv,
    p_device_id: deps.deviceId ?? null,
    p_app_version: deps.appVersion ?? null,
  });
  if (error) throw error;
}

/**
 * Best-effort local cleanup on sign-out. We do NOT delete the token server-side
 * here (the RPC re-homes on next login anyway), but you may call this to detach
 * the current device from the just-signed-out account. Requires the token; if
 * you don't cache it, skip — the unique constraint + re-home handles reuse.
 */
export async function detachTokenOnSignOut(
  supabase: SupabaseClient,
  token: string | null,
): Promise<void> {
  if (!token) return;
  // Owner-only RLS: this only works while still authenticated as the owner, so
  // call BEFORE supabase.auth.signOut().
  await supabase.from('push_tokens').delete().eq('token', token);
}

// ─────────────────────────────────────────────────────────────────────────────
// Default copy
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PRIMING_COPY: Record<string, PrimingCopy> = {
  postFirstSession: {
    title: 'Stay on track',
    body: 'Get a nudge before your sessions, streak alerts, and a heads-up when your coach updates your plan. You choose which — change anytime in Settings.',
    confirmLabel: 'Turn on notifications',
    dismissLabel: 'Not now',
  },
  reminderOptIn: {
    title: 'Remind me to train',
    body: "We'll send a quiet reminder before each scheduled session. Nothing else unless you ask.",
    confirmLabel: 'Turn on reminders',
    dismissLabel: 'Not now',
  },
};

/*
──────────────────────────────────────────────────────────────────────────────
WIRING EXAMPLE (drop into the shell's post-login bootstrap)
──────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabaseClient';
import { bindPushTapRouting } from './notificationCategories';
import {
  syncPushRegistrationIfGranted,
  maybePrimePush,
  DEFAULT_PRIMING_COPY,
  isNativePush,
} from './registration';

export async function initPushOnLaunch(navigate: (path: string) => void) {
  if (!isNativePush()) return;

  const deps = {
    supabase,
    showPrimingSheet: myUiKit.confirmSheet,  // returns Promise<boolean>
    appVersion: import.meta.env.VITE_APP_VERSION,
    onError: (where, err) => console.warn('[push]', where, err),
    resolveApnsEnv: () => (import.meta.env.PROD ? 'production' : 'sandbox'),
  };

  // 1) Route taps (works even before permission is granted for future taps).
  await bindPushTapRouting(navigate);

  // 2) Silent re-register if already granted.
  await syncPushRegistrationIfGranted(deps);
}

// Later, at a trust moment (e.g. session-complete screen):
export async function primeAfterFirstSession(deps) {
  await maybePrimePush(deps, DEFAULT_PRIMING_COPY.postFirstSession);
}
*/
