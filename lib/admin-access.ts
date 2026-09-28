import { notFound, redirect } from "next/navigation";
import { checkAdmin, emailIsAdmin } from "@/lib/admin";

/**
 * Gates for the account admin (/admin/users, /admin/mfa, /admin/announcements,
 * /admin/promos), built on `checkAdmin()` in `lib/admin.ts` so there is ONE
 * allowlist (`ADMIN_EMAILS`) and one rule for the whole of /admin.
 *
 * Every page, route handler and server action calls one of these FIRST. The
 * actions matter as much as the pages: a server action is a public POST
 * endpoint, and a page refusing to render does nothing to stop someone posting
 * to the action behind it.
 */

export type AdminActor = { id: string; email: string };

/**
 * Whether an identity is an administrator — PURE, for tests. Mirrors the
 * identity half of `checkAdmin()`: on the allowlist, and the email CONFIRMED.
 */
export function isAdminIdentity(
  allowlistRaw: string | null | undefined,
  email: string | null | undefined,
  emailConfirmedAt: string | null | undefined,
): boolean {
  return !!emailConfirmedAt && emailIsAdmin(allowlistRaw, email);
}

/** Pages and server actions: 404 for non-admins, /admin/mfa for an admin without a code. */
export async function requireAdmin(): Promise<AdminActor> {
  const gate = await checkAdmin();
  if (gate.state === "denied") notFound();
  if (gate.state === "needs_mfa") redirect("/admin/mfa");
  return { id: gate.userId, email: gate.email };
}

/**
 * Identity only — for /admin/mfa itself, which has to be reachable BEFORE the
 * second factor is verified, or nobody could ever verify one.
 */
export async function requireAdminIdentity(): Promise<AdminActor> {
  const gate = await checkAdmin();
  if (gate.state === "denied") notFound();
  return { id: gate.userId, email: gate.email };
}

/** Route handlers (the CSV and data exports) answer with a Response, not a render. */
export async function adminOrResponse(): Promise<AdminActor | Response> {
  const gate = await checkAdmin();
  if (gate.state === "denied") return new Response("Not found", { status: 404 });
  if (gate.state === "needs_mfa") {
    return new Response(null, { status: 303, headers: { Location: "/admin/mfa" } });
  }
  return { id: gate.userId, email: gate.email };
}
