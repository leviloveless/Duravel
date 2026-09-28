"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdminIdentity } from "@/lib/admin-access";
import { normalizeSvgDataUrl } from "@/lib/admin-account-rules";

/**
 * Two-factor enrolment and verification for the admin.
 *
 * These run on the USER-SCOPED client, not the service role: an authenticator is
 * enrolled to, and verified by, the administrator's own session — that is the
 * whole point. A successful verify upgrades this session to `aal2`, which is
 * what `requireAdmin()` checks.
 *
 * Both are identity-gated only (`requireAdminIdentity`), because they are how an
 * `aal1` session BECOMES `aal2`; requiring `aal2` here would be a locked door
 * with the key inside.
 */

export type EnrollState =
  | { step: "idle"; error?: string }
  | { step: "scan"; factorId: string; qr: string; secret: string; error?: string };

export async function startEnrollment(): Promise<EnrollState> {
  await requireAdminIdentity();
  const supabase = await createClient();

  // Clear half-finished enrolments first. Each "Set up" click creates a factor,
  // and an abandoned one would otherwise sit there unverified forever.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Duravel admin ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return { step: "idle", error: error?.message ?? "Couldn't start enrolment." };
  return {
    step: "scan",
    factorId: data.id,
    qr: normalizeSvgDataUrl(data.totp.qr_code),
    secret: data.totp.secret,
  };
}

export type VerifyState = { error?: string };

export async function verifyCode(_prev: VerifyState, form: FormData): Promise<VerifyState> {
  await requireAdminIdentity();
  const factorId = String(form.get("factorId") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code))
    return { error: "Enter the 6-digit code from your authenticator app." };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error)
    return {
      error: "That code didn't match. Codes change every 30 seconds — try the current one.",
    };
  redirect("/admin/users?ok=mfa");
}
