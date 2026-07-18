/**
 * Duravel iOS — Part 3
 * The single Supabase client used inside the Capacitor shell.
 *
 * This wires the native-backed storage adapter into supabase-js so that the
 * session survives cold launches, and turns OFF `detectSessionInUrl` because
 * Duravel routes email/OAuth callback links itself via the deep-link router
 * (see Duravel_iOS_Part3_deep-link-router.ts).
 *
 * The web app (hyroxai/) already creates a browser client. Keep that one for
 * the browser. This file is imported by the SHELL glue (native-bootstrap.ts).
 * If the web app and shell share a client factory, pass `pickAuthStorage()`
 * into the existing factory instead of creating a second client — only ONE
 * GoTrue client should own the session per document, or refresh races occur.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pickAuthStorage } from './Duravel_iOS_Part3_supabase-storage-adapter';

// These are the SAME public values the web app already ships. The anon key is
// safe to embed in the client bundle; RLS protects the data. Do NOT put the
// service-role key here — it lives only in the deletion Edge Function.
const SUPABASE_URL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_URL) ||
  'https://YOUR-PROJECT-ref.supabase.co';
const SUPABASE_ANON_KEY =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
  'YOUR_SUPABASE_ANON_KEY';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Native Keychain-backed storage on device; localStorage on web.
      storage: pickAuthStorage(),
      // Namespace the persisted session so it never collides with other keys.
      storageKey: 'duravel.auth',
      persistSession: true,
      autoRefreshToken: true,
      // We parse callback links ourselves (email confirm / reset / OAuth).
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
  return _client;
}
