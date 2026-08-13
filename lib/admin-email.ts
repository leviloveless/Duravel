import { createAdminClient } from "@/lib/supabase/admin";
import { rollupEmailHealth, type EmailHealth, type EmailSendRow } from "@/lib/email/health";

/**
 * Admin email-health read — SERVICE ROLE. `email_sends` has a read-own RLS policy
 * and `email_suppressions` has no user policies at all, so this must go through
 * the admin client. **Gate every caller on `getAdmin()` first.**
 *
 * Read-only: this module never writes, so an admin looking at the panel can
 * never perturb the ledger it is reporting on.
 */

const WINDOW_DAYS = 30;
/** Hard cap so a busy month can't pull an unbounded result set into memory. */
const ROW_LIMIT = 5000;

export type EmailAdminView = {
  health: EmailHealth;
  /** Addresses Resend told us to stop mailing (hard bounce / complaint / manual). */
  suppressions: { total: number; byReason: Array<{ reason: string; count: number }> };
  /** True when the row cap was hit — the rollup is then a lower bound. */
  truncated: boolean;
};

export async function getEmailAdminView(windowDays = WINDOW_DAYS): Promise<EmailAdminView> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const [sendsRes, suppRes] = await Promise.all([
    admin
      .from("email_sends")
      .select("template, category, status, error, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT),
    admin.from("email_suppressions").select("reason"),
  ]);

  const rows = (sendsRes.data as EmailSendRow[] | null) ?? [];
  const supp = (suppRes.data as { reason: string }[] | null) ?? [];

  const byReason = new Map<string, number>();
  for (const s of supp) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);

  return {
    health: rollupEmailHealth(rows, windowDays),
    suppressions: {
      total: supp.length,
      byReason: [...byReason.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    },
    truncated: rows.length >= ROW_LIMIT,
  };
}
