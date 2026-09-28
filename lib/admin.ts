import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Admin access control (#15) — an ENV ALLOWLIST, no DB flag. `ADMIN_EMAILS` is a
 * comma/space-separated list of emails; a signed-in user whose auth email is on
 * it is an admin. Admin surfaces read/write other users' data via the
 * service-role client (which bypasses RLS), so every admin route MUST gate on
 * `getAdmin()` first. Parsing is pure + tested; the env + session reads live here.
 */

/** Parse the ADMIN_EMAILS env value into a normalized lowercase list. */
export function parseAdminEmails(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Is `email` present in the given allowlist string? (Pure — for tests.) */
export function emailIsAdmin(
  raw: string | null | undefined,
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return parseAdminEmails(raw).includes(email.trim().toLowerCase());
}

/** Is `email` an admin per the configured ADMIN_EMAILS? */
export function isAdminEmail(email: string | null | undefined): boolean {
  return emailIsAdmin(env.ADMIN_EMAILS, email);
}

/**
 * Whether the session has passed a second factor (2026-09-28).
 *
 * The admin can refund payments, cancel subscriptions and permanently delete
 * accounts. Without a second factor, a leaked or reused password is all that
 * stands in front of that. Supabase marks a session that has verified an
 * authenticator code `aal2`; a password-only session is `aal1`.
 */
export function mfaSatisfied(currentLevel: string | null | undefined): boolean {
  return currentLevel === "aal2";
}

export type AdminGate =
  | { state: "admin"; userId: string; email: string }
  | { state: "needs_mfa"; userId: string; email: string }
  | { state: "denied" };

/**
 * Where the caller stands.
 *
 * Three conditions, all required: on the `ADMIN_EMAILS` allowlist; that email
 * CONFIRMED (otherwise, were confirmation ever switched off in Supabase, anyone
 * could register the address and walk in — the gate would be tied to typing an
 * email rather than controlling its inbox); and a second factor verified this
 * session. `getUser()` validates the token with the auth server first, so the
 * `aal` read from that same session afterwards cannot be forged.
 */
export async function checkAdmin(): Promise<AdminGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !user.email_confirmed_at || !isAdminEmail(user.email)) {
    return { state: "denied" };
  }
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !mfaSatisfied(data?.currentLevel)) {
    return { state: "needs_mfa", userId: user.id, email: user.email };
  }
  return { state: "admin", userId: user.id, email: user.email };
}

/**
 * The signed-in admin, or null if not signed in / not on the allowlist / no
 * second factor this session. Call at the top of every admin route and 404 on
 * null BEFORE any service-role read or write.
 *
 * Returns null — never redirects — for an admin who hasn't entered a code yet,
 * because this is also what the athlete program page asks to decide whether to
 * show the coach view, and an athlete page must not bounce anyone to /admin/mfa.
 * Admin PAGES route that case with `adminGateMiss()`.
 */
export async function getAdmin(): Promise<{ userId: string; email: string } | null> {
  const gate = await checkAdmin();
  return gate.state === "admin" ? { userId: gate.userId, email: gate.email } : null;
}

/**
 * What an admin PAGE does when `getAdmin()` came back null: send an admin who
 * simply hasn't entered their code this session to /admin/mfa, and 404 everyone
 * else — so the route never announces there is something worth signing in for.
 */
export async function adminGateMiss(): Promise<never> {
  const gate = await checkAdmin();
  if (gate.state === "needs_mfa") redirect("/admin/mfa");
  notFound();
}
