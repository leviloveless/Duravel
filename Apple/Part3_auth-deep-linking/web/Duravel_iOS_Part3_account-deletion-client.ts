/**
 * Duravel iOS — Part 3
 * Client helper to invoke the delete-account Edge Function and then fully
 * sign the user out of the shell (clearing the Keychain session).
 *
 * Call this from the "Delete account" confirmation screen AFTER a typed
 * confirmation (see account-deletion-plan.md). It is irreversible.
 */

import { getSupabase } from './Duravel_iOS_Part3_supabase-client';
import { signOut } from './Duravel_iOS_Part3_session-manager';

export interface DeleteAccountResult {
  ok: boolean;
  error?: string;
}

export async function deleteAccount(): Promise<DeleteAccountResult> {
  const supabase = getSupabase();

  // Must be signed in — the function derives the user from the caller's JWT.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'You must be signed in.' };

  // supabase.functions.invoke automatically attaches the Authorization bearer.
  const { data, error } = await supabase.functions.invoke('delete-account', {
    method: 'POST',
  });

  if (error) return { ok: false, error: error.message };
  if (!(data as any)?.ok) {
    return { ok: false, error: (data as any)?.error ?? 'Deletion failed.' };
  }

  // Server-side account is gone; clear the local Keychain session so the app
  // returns to the logged-out state. signOut may 401 (user no longer exists) —
  // that's fine, we still wipe local state.
  try {
    await signOut();
  } catch {
    /* ignore — account already deleted server-side */
  }

  return { ok: true };
}
