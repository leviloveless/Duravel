import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdmin } from "@/lib/admin";
import { getAdminProgram } from "@/lib/admin-data";
import AdminProgramControls from "@/components/admin/admin-program-controls";
import CoachingNotes from "@/components/admin/coaching-notes";
import ProgramEditor from "@/components/admin/program-editor";
import ProgramFormEditor from "@/components/admin/program-form-editor";

/**
 * Admin program detail (#15) — full review + edit of one athlete's program:
 * coaching notes, a schema-validated program editor (edit any aspect),
 * recalculate, rename, and a read-out of their logs / readiness / profile.
 */
export const dynamic = "force-dynamic";

export default async function AdminProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin) notFound();

  const { id } = await params;
  const detail = await getAdminProgram(id);
  if (!detail) notFound();

  const { program, profile, logs, readiness, notes } = detail;
  const completed = logs.filter((l) => l.status === "completed").length;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <Link href="/admin" className="text-sm text-zinc-500 underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold">{program.name ?? "Program"}</h1>
        <p className="text-sm text-zinc-500">
          {profile?.first_name ?? "—"} · {(profile as { email?: string } | null)?.email ?? "—"} ·{" "}
          {program.program_type} · {program.duration_weeks} weeks · status {program.status}
        </p>
        <Link href={`/program/${program.id}`} className="text-sm text-zinc-500 underline">
          View as the athlete sees it →
        </Link>
      </div>

      <section className="rounded-2xl border border-zinc-200 p-5">
        <h2 className="mb-3 text-sm font-semibold">Controls</h2>
        <AdminProgramControls programId={program.id} currentName={program.name ?? ""} />
      </section>

      <section className="rounded-2xl border border-zinc-200 p-5">
        <h2 className="mb-3 text-sm font-semibold">Coaching notes</h2>
        <CoachingNotes programId={program.id} notes={notes.map((n) => ({ id: n.id, body: n.body, created_at: n.created_at }))} />
      </section>

      <section className="rounded-2xl border border-zinc-200 p-5">
        <h2 className="mb-3 text-sm font-semibold">Edit program</h2>
        {program.program_data ? (
          <>
            <ProgramFormEditor programId={program.id} initialData={program.program_data} />
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-zinc-500">Advanced: edit raw JSON</summary>
              <div className="mt-3">
                <ProgramEditor programId={program.id} initialJson={JSON.stringify(program.program_data, null, 2)} />
              </div>
            </details>
          </>
        ) : (
          <p className="text-sm text-zinc-500">No program data yet (still generating or failed).</p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 p-5">
          <h2 className="mb-2 text-sm font-semibold">Logs</h2>
          <p className="text-sm text-zinc-600">
            {logs.length} logged · {completed} completed
          </p>
          <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-auto text-xs text-zinc-600">
            {logs.slice(0, 40).map((l) => (
              <li key={l.id}>
                W{l.week_number} {l.day} #{l.session_index} — {l.status}
                {l.rpe != null && ` · RPE ${l.rpe}`}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-zinc-200 p-5">
          <h2 className="mb-2 text-sm font-semibold">Readiness</h2>
          {readiness.length === 0 ? (
            <p className="text-sm text-zinc-500">No check-ins.</p>
          ) : (
            <ul className="flex max-h-56 flex-col gap-1 overflow-auto text-xs text-zinc-600">
              {readiness.map((r) => (
                <li key={r.week_number}>
                  W{r.week_number} — sleep {r.sleep} · fatigue {r.fatigue} · stress {r.stress} · soreness{" "}
                  {r.soreness}
                  {r.resting_hr != null && ` · RHR ${r.resting_hr}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 p-5">
        <h2 className="mb-2 text-sm font-semibold">Athlete profile</h2>
        <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
          {JSON.stringify(profile, null, 2)}
        </pre>
      </section>
    </main>
  );
}
