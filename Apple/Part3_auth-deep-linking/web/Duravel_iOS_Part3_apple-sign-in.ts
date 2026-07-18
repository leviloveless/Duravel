/**
 * Duravel iOS — Part 3
 * Sign in with Apple (native) → Supabase session.
 *
 * WHY THIS IS REQUIRED
 * --------------------
 * App Store Review Guideline 4.8 ("Login Services") requires that any app
 * offering third-party or social login (Duravel offers email + others) must
 * ALSO offer Sign in with Apple as an equivalent option. Shipping without it
 * is a near-certain rejection.
 *
 * APPROACH
 * --------
 * On iOS we use the NATIVE Apple sheet via @capacitor-community/apple-sign-in
 * (ASAuthorizationController) rather than a web redirect. The plugin returns an
 * Apple identity token (a signed JWT). We hand that token to Supabase with
 * supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce }), which
 * verifies it against Apple's public keys and mints a Supabase session.
 *
 * NONCE
 * -----
 * Apple returns the SHA-256 hash of the nonce inside the identity token; the
 * raw nonce must be sent to Supabase so it can re-hash and compare. We generate
 * a cryptographically-random raw nonce, pass it to the plugin, and forward the
 * SAME raw nonce to Supabase. This binds the token to our request (replay
 * protection). See generateNonce() below.
 *
 * NAME CAPTURE (one-shot!)
 * ------------------------
 * Apple returns the user's givenName/familyName ONLY on the very first
 * authorization for this Apple ID + app. On every subsequent sign-in those
 * fields are null. So we persist the name to the profile on first sign-in.
 *
 * See Duravel_iOS_Part3_APPLE_SIGN_IN_SETUP.md for the Apple Developer +
 * Supabase dashboard configuration that MUST be in place for this to work.
 */

import { Capacitor } from '@capacitor/core';
import {
  SignInWithApple,
  type SignInWithAppleResponse,
  type SignInWithAppleOptions,
} from '@capacitor-community/apple-sign-in';
import { getSupabase } from './Duravel_iOS_Part3_supabase-client';

/** Client ID = the app's bundle id for the NATIVE flow. */
const APPLE_CLIENT_ID = 'app.duravel';
/** Only needed for the web-redirect fallback below; matches Apple "Return URL". */
const APPLE_REDIRECT_URI = 'https://app.duravel.app/auth/callback';

/**
 * Generate a cryptographically-random raw nonce (URL-safe). We hash it to hex
 * for the plugin (Apple expects the hashed nonce in the request) but keep the
 * RAW value to give to Supabase.
 */
async function generateNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw),
  );
  const hashed = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return { raw, hashed };
}

export interface AppleSignInResult {
  ok: boolean;
  isNewUser: boolean;
  error?: string;
}

/**
 * Run the native Apple sign-in flow and establish a Supabase session.
 * On non-native platforms, falls back to Supabase's OAuth web redirect.
 */
export async function signInWithApple(): Promise<AppleSignInResult> {
  const supabase = getSupabase();

  // --- Web fallback (browser / PWA): use Supabase's hosted OAuth redirect ---
  if (!Capacitor.isNativePlatform()) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: APPLE_REDIRECT_URI },
    });
    return { ok: !error, isNewUser: false, error: error?.message };
  }

  // --- Native iOS flow ---
  try {
    const { raw, hashed } = await generateNonce();

    const options: SignInWithAppleOptions = {
      clientId: APPLE_CLIENT_ID,
      redirectURI: APPLE_REDIRECT_URI, // required by the plugin API; unused natively
      scopes: 'email name',
      nonce: hashed, // Apple hashes+embeds this; we compare via raw below
    };

    const res: SignInWithAppleResponse = await SignInWithApple.authorize(options);
    const identityToken = res.response?.identityToken;
    if (!identityToken) {
      return { ok: false, isNewUser: false, error: 'No identity token from Apple' };
    }

    // Exchange Apple identity token for a Supabase session.
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: raw, // RAW nonce — Supabase re-hashes and compares to the token
    });
    if (error) return { ok: false, isNewUser: false, error: error.message };

    // Capture the display name on FIRST sign-in only (Apple sends it once).
    const given = res.response?.givenName ?? '';
    const family = res.response?.familyName ?? '';
    const fullName = `${given} ${family}`.trim();
    let isNewUser = false;

    if (fullName && data.user) {
      // Only write if we don't already have a name for this user.
      const existing =
        (data.user.user_metadata?.full_name as string | undefined) ?? '';
      if (!existing) {
        isNewUser = true;
        await supabase.auth.updateUser({ data: { full_name: fullName } });
        // Mirror into the app's profiles table if you keep one:
        await supabase
          .from('profiles')
          .update({ full_name: fullName })
          .eq('id', data.user.id);
      }
    }

    return { ok: true, isNewUser };
  } catch (err: any) {
    // User cancelled the sheet, or a config error. Cancellation is not an error
    // worth surfacing loudly.
    const msg = err?.message ?? String(err);
    const cancelled = /cancel/i.test(msg) || err?.code === '1001';
    return {
      ok: false,
      isNewUser: false,
      error: cancelled ? undefined : msg,
    };
  }
}
