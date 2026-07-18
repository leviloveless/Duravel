/**
 * Duravel iOS — Part 3
 * Session lifecycle manager for the Capacitor shell.
 *
 * Responsibilities:
 *   1. Restore the persisted session on cold launch (keep users logged in).
 *   2. Proactively refresh the session when the app returns to foreground —
 *      iOS suspends the webview's timers, so supabase-js's autoRefresh timer
 *      can be stale after a long background; we force a refresh on resume.
 *   3. Broadcast auth state changes so the web UI (React) can react.
 *   4. Clear the session on sign-out.
 *
 * This module is imported by native-bootstrap.ts and initialised ONCE at
 * launch. It is safe to call getSession()/onAuthChange() from web code too.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './Duravel_iOS_Part3_supabase-client';

type SessionListener = (session: Session | null) => void;
const listeners = new Set<SessionListener>();

/** Subscribe to session changes (login/logout/refresh). Returns an unsubscribe. */
export function onAuthChange(cb: SessionListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(session: Session | null) {
  for (const cb of listeners) {
    try {
      cb(session);
    } catch (err) {
      // Never let one bad listener break auth propagation.
      console.error('[Duravel][session] listener error', err);
    }
  }
}

/** Read the current session (from native storage on first call). */
export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) {
    console.warn('[Duravel][session] getSession error', error.message);
    return null;
  }
  return data.session ?? null;
}

let _initialised = false;

/**
 * Initialise persistence + resume-refresh. Call once at launch.
 * Returns the restored session (or null) so the shell can decide whether to
 * show the app or the login screen without a flash.
 */
export async function initSessionManager(): Promise<Session | null> {
  if (_initialised) return getSession();
  _initialised = true;

  const supabase = getSupabase();

  // 1. Fan auth changes out to UI listeners.
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('[Duravel][session] auth event:', event);
    emit(session ?? null);
  });

  // 2. On resume from background, force a refresh if we hold a session.
  //    WKWebView pauses JS timers while backgrounded, so the built-in
  //    autoRefresh may not have fired — this closes the gap.
  if (Capacitor.isNativePlatform()) {
    App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) return;
      const current = await getSession();
      if (!current) return;
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        console.warn('[Duravel][session] resume refresh failed', error.message);
      }
    });
  }

  // 3. Restore whatever was persisted (Keychain) on cold launch.
  const restored = await getSession();
  return restored;
}

/** Full sign-out: clears the persisted session in native storage. */
export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) console.warn('[Duravel][session] signOut error', error.message);
  emit(null);
}
