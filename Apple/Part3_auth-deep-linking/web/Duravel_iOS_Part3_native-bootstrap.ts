/**
 * Duravel iOS — Part 3
 * Native shell bootstrap — the ONE entrypoint to call at app launch.
 *
 * Wires together everything in Part 3:
 *   - session persistence + resume-refresh (session-manager)
 *   - deep-link routing incl. Supabase email links (deep-link-router)
 *
 * WHERE TO CALL IT
 * ----------------
 * Because Duravel loads the live web app via Capacitor `server.url`, this code
 * ships INSIDE the web bundle (hyroxai/) and runs in the webview. Call
 * bootstrapNativeShell() once, early, guarded by Capacitor.isNativePlatform().
 *
 * Next.js App Router example — a client component mounted in the root layout:
 *
 *   'use client';
 *   import { useEffect } from 'react';
 *   import { Capacitor } from '@capacitor/core';
 *   import { bootstrapNativeShell } from '@/native/Duravel_iOS_Part3_native-bootstrap';
 *
 *   export function NativeShellBootstrap() {
 *     useEffect(() => {
 *       if (Capacitor.isNativePlatform()) void bootstrapNativeShell();
 *     }, []);
 *     return null;
 *   }
 *
 * Then render <NativeShellBootstrap /> in app/layout.tsx.
 */

import { Capacitor } from '@capacitor/core';
import type { Session } from '@supabase/supabase-js';
import { initSessionManager, onAuthChange } from './Duravel_iOS_Part3_session-manager';
import { initDeepLinkRouter } from './Duravel_iOS_Part3_deep-link-router';

export interface BootstrapResult {
  session: Session | null;
  isNative: boolean;
}

let _booted: Promise<BootstrapResult> | null = null;

export function bootstrapNativeShell(): Promise<BootstrapResult> {
  if (_booted) return _booted;

  _booted = (async () => {
    const isNative = Capacitor.isNativePlatform();

    // Restore the persisted session first so the UI can render the right
    // screen without a login flash.
    const session = await initSessionManager();

    // Route deep links. onError should surface a toast in the web UI; we pass a
    // hook that the app can override by defining window.__duravelToast.
    await initDeepLinkRouter({
      onError: (msg) => {
        const anyWin = window as any;
        if (typeof anyWin.__duravelToast === 'function') anyWin.__duravelToast(msg);
        else console.warn('[Duravel][deeplink]', msg);
      },
    });

    return { session, isNative };
  })();

  return _booted;
}

// Re-export the commonly-needed hooks so app code has a single import surface.
export { onAuthChange, signOut, getSession } from './Duravel_iOS_Part3_session-manager';
export { signInWithApple } from './Duravel_iOS_Part3_apple-sign-in';
