import { adminOrResponse } from "@/lib/admin-access";
import { listAccounts } from "@/lib/admin-accounts";
import {
  accessLabel,
  matchesFilter,
  matchesQuery,
  parseFilter,
  toCsv,
} from "@/lib/admin-account-rules";
import { recordAdminAction } from "@/lib/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The accounts list as a spreadsheet, honouring the same `q` and `filter` the
 * page does — so what downloads is what you were looking at. Cells are defused
 * against formula injection (see `csvField`). Recorded in the audit log, since
 * it is a copy of every athlete's email leaving the app.
 */
export async function GET(request: Request): Promise<Response> {
  const admin = await adminOrResponse();
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const filter = parseFilter(url.searchParams.get("filter") ?? undefined);
  const { accounts } = await listAccounts();
  const rows = accounts.filter((a) => matchesFilter(a, filter) && matchesQuery(a, q));

  const csv = toCsv([
    [
      "id",
      "email",
      "name",
      "primary_sport",
      "signed_up",
      "last_sign_in",
      "email_confirmed",
      "sign_in_method",
      "access",
      "tier",
      "trial_ends",
      "subscription_status",
      "plan",
      "suspended",
      "has_profile",
      "programs",
    ],
    ...rows.map((a) => [
      a.id,
      a.email,
      a.name,
      a.primarySport,
      a.createdAt,
      a.lastSignInAt,
      a.emailConfirmed,
      a.provider,
      accessLabel(a.access, a.suspended).label,
      a.access.entitled ? a.access.tier : "",
      a.access.trialEndsAt,
      a.subscription?.status ?? "",
      a.subscription?.plan ?? "",
      a.suspended,
      a.hasProfile,
      a.programCount,
    ]),
  ]);

  await recordAdminAction(
    createAdminClient(),
    admin,
    { id: null, email: null },
    "accounts.export_csv",
    {
      rows: rows.length,
      q,
      filter,
    },
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="duravel-accounts-${filter}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
