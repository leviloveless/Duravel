import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWelcome } from "@/lib/email/flows/welcome";
import { ensureProfileFromSignup } from "@/lib/signup-profile";
import { redirect } from "next/navigation";
import { after, type NextRequest } from "next/server";
import { type EmailOtpType, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Handles the link Supabase emails on signup ("Confirm your email").
 * GET /auth/confirm?token_hash=...&type=email&next=/onboarding
 *
 * The Supabase "Confirm signup" template should use the token-hash link so this
 * route performs the verification exactly once:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding
 *
 * The default {{ .ConfirmationURL }} template verifies on Supabase's side and
 * lands here WITHOUT a token_hash (sometimes with a PKCE ?code=). We handle all
 * three cases below and only show the error page when the address is genuinely
 * unconfirmed, so a successful confirmation never surfaces a spurious error.
 *
 * On the first successful confirmation we fire the welcome email NON-BLOCKING via
 * after() — it runs after the redirect response is sent, so it can never delay or
 * break the confirmation. sendWelcome is idempotent (once-ever dedup key), so the
 * repeated confirmations an email scanner can trigger never double-send.
 */
function safeNext(raw: string | null): string {
  const fallback = "/onboarding";
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback; // must be a relative path
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback; // not protocol-relative
  return raw;
}

/** Schedule the welcome email (post-response) then redirect. Never blocks/throws early. */
async function completeConfirmation(supabase: SupabaseClient, next: string): Promise<never> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const userId = user.id;

    // Create the profile row from the answers signup stashed on the auth user.
    // AWAITED rather than deferred to after(), because the very next page can
    // read it (the trial banner, and /start's "your trial is running"), and a
    // row that appears a beat later reads as a bug. It is a single insert that
    // no-ops when a row exists, and it never throws — see lib/signup-profile.ts.
    await ensureProfileFromSignup(supabase);

    after(async () => {
      try {
        await sendWelcome(createAdminClient(), userId);
      } catch (err) {
        console.error("[welcome] send failed:", err);
      }
    });
  }
  redirect(next);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();

  // 1) Preferred flow: token-hash link handled entirely by this app.
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      await completeConfirmation(supabase, next);
    }
  }

  // 2) PKCE flow: Supabase's hosted verify redirected here with a code.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await completeConfirmation(supabase, next);
    }
  }

  // 3) Already confirmed: an email scanner/prefetch consumed the one-time
  //    token, or Supabase's hosted verify already ran. If a valid session
  //    exists, treat it as success rather than showing a false error.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await completeConfirmation(supabase, next);
  }

  redirect("/login?error=confirmation_failed");
}
