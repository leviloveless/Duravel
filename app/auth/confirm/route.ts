import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";

/**
 * Handles the link Supabase emails on signup ("Confirm your email").
 * GET /auth/confirm?token_hash=...&type=signup&next=/onboarding
 */
/**
 * Only allow same-origin relative redirect targets. Rejects absolute URLs and
 * protocol-relative ("//evil.com") / backslash ("/\evil.com") tricks so the
 * post-verification redirect can't be turned into an open-redirect phishing hop.
 */
function safeNext(raw: string | null): string {
  const fallback = "/onboarding";
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback; // must be a relative path
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback; // not protocol-relative
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      redirect(next);
    }
  }

  redirect("/login?error=confirmation_failed");
}
