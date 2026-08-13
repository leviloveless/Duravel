import { notFound } from "next/navigation";
import Link from "next/link";
import { getAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatInstant } from "@/lib/timezone";

/**
 * Admin view of the science-paper email captures (science_leads). Gated by the
 * ADMIN_EMAILS allowlist; reads the RLS-protected table via the service-role
 * client. Latest 500, newest first.
 */
export const dynamic = "force-dynamic";

type LeadRow = { email: string; source: string; sport: string | null; created_at: string };

export default async function AdminLeadsPage() {
  const admin = await getAdmin();
  if (!admin) notFound();

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("science_leads")
    .select("email, source, sport, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as LeadRow[];
  const total = rows.length;
  const distinct = new Set(rows.map((r) => r.email?.toLowerCase())).size;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Science-paper leads</h1>
        <Link href="/admin" className="text-sm underline">
          Admin
        </Link>
      </div>

      <div className="flex gap-8 text-sm">
        <div>
          <div className="text-2xl font-semibold tracking-tight">{total}</div>
          <div className="text-zinc-500">captured{total >= 500 ? " (latest 500)" : ""}</div>
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-tight">{distinct}</div>
          <div className="text-zinc-500">unique emails</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400">
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Sport</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 text-right font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                  No leads captured yet.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-b border-zinc-100 last:border-b-0">
                  <td className="px-4 py-2 text-zinc-800">{r.email}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.sport ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-500">{r.source}</td>
                  <td className="px-4 py-2 text-right text-zinc-500">
                    {formatInstant(
                      r.created_at,
                      null,
                      { month: "short", day: "numeric", year: "numeric" },
                      "",
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
