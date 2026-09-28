import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * The account-admin audit trail (table `admin_audit_log`, migration 0048).
 *
 * Every change an administrator makes to someone else's account is recorded:
 * who, to whom, what, and the values involved. It is what a billing dispute or a
 * "why did my access change?" email turns on, and it keeps the target's email as
 * plain text so it still reads after a permanent delete has removed the account.
 *
 * Writing the log NEVER blocks the action. The action has already happened by
 * the time this runs; failing it now would leave the admin believing it had not.
 */

export type AuditEntry = {
  id: number;
  admin_email: string;
  target_user_id: string | null;
  target_email: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export async function recordAdminAction(
  admin: SupabaseClient,
  actor: Pick<User, "id" | "email">,
  target: { id: string | null; email: string | null },
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("admin_audit_log").insert({
    admin_id: actor.id,
    admin_email: actor.email ?? "unknown",
    target_user_id: target.id,
    target_email: target.email,
    action,
    detail,
  });
  if (error) console.error("[admin] audit write failed:", action, error.message);
}

/** Recent entries for one account, newest first. Empty when the table is absent. */
export async function auditFor(
  admin: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<AuditEntry[]> {
  const { data, error } = await admin
    .from("admin_audit_log")
    .select("id, admin_email, target_user_id, target_email, action, detail, created_at")
    .eq("target_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data as AuditEntry[] | null) ?? [];
}

/** Many entries in one insert — for bulk actions like the trial rescue. */
export async function recordAdminActions(
  admin: SupabaseClient,
  actor: Pick<User, "id" | "email">,
  entries: {
    target: { id: string | null; email: string | null };
    action: string;
    detail?: Record<string, unknown>;
  }[],
): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await admin.from("admin_audit_log").insert(
    entries.map((e) => ({
      admin_id: actor.id,
      admin_email: actor.email ?? "unknown",
      target_user_id: e.target.id,
      target_email: e.target.email,
      action: e.action,
      detail: e.detail ?? {},
    })),
  );
  if (error) console.error("[admin] bulk audit write failed:", error.message);
}
