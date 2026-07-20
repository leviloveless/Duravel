import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdmin } from "@/lib/admin";
import { listProgramsForAdmin, listWaitlist } from "@/lib/admin-data";
import WaitlistControls from "@/components/admin/waitlist-controls";

/**
 * Admin console (#15/#16) — programs across all users + the coaching waitlist.
 * Gated by the ADMIN_EMAILS allowlist; a non-admin gets a 404 (no hint the route
 * exists).
 */
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-800",
  generating: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function AdminPage() {
  const admin = await getAdmin();
  if (!admin) notFound();

  const [programs, waitlist] = await Promise.all([listProgramsForAdmin(), listWaitlist()]);
  const pendingCount = waitlist.filter((w) => w.status === "applied").length;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin console</h1>
        <div className="flex items-center gap-4">
          <Link href="/admin/metrics" className="text-sm text-zinc-500 underline">
            Generation cost
          </Link>
          <Link href="/admin/impact" className="text-sm text-zinc-500 underline">
            Impact tracker
          </Link>
          <span className="text-xs text-zinc-500">{admin.email}</span>
        </div>
      </div>

      {/* Coaching waitlist */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Coaching waitlist{" "}
          {pendingCount > 0 && (
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {pendingCount} new
            </span>
          )}
        </h2>
        {waitlist.length === 0 ? (
          <p className="text-sm text-zinc-500">No applications yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {waitlist.map((w) => (
              <li key={w.id} className="rounded-xl border border-zinc-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {w.name} <span className="font-normal text-zinc-500">· {w.email}</span>
                    </p>
                    <p className="text-xs text-zinc-500">Applied {fmt(w.created_at)}</p>
                  </div>
                  <WaitlistControls id={w.id} status={w.status} />
                </div>
                <dl className="mt-2 grid gap-1 text-sm text-zinc-600">
                  {w.sport_goal && (
                    <div>
                      <dt className="inline font-medium text-zinc-500">Goal: </dt>
                      <dd className="inline">{w.sport_goal}</dd>
                    </div>
                  )}
                  {w.current_training && (
                    <div>
                      <dt className="inline font-medium text-zinc-500">Trains: </dt>
                      <dd className="inline">{w.current_training}</dd>
                    </div>
                  )}
                  {w.why && (
                    <div>
                      <dt className="inline font-medium text-zinc-500">Why: </dt>
                      <dd className="inline">{w.why}</dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Programs */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Programs ({programs.length})</h2>
        <ul className="flex flex-col gap-2">
          {programs.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/program/${p.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 transition-colors hover:bg-zinc-50"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{p.name ?? `${p.duration_weeks}-week program`}</span>
                  <span className="text-xs text-zinc-500">
                    {p.ownerName ?? "—"} · {p.ownerEmail ?? "—"} · created {fmt(p.created_at)}
                  </span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status] ?? ""}`}>
                  {p.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
