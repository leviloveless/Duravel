import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdmin } from "@/lib/admin";
import type { ProgramData, GenerationInput } from "@/lib/schemas";
import { computePaces } from "@/lib/engine/paces";
import type { BrickTargets } from "@/lib/engine/brick-targets";
import WorkoutView from "@/components/program/workout-view";

/**
 * Workout view — a focused, check-off-as-you-go screen for a single day's
 * session(s). Designed for the mobile app (the WorkoutView component gates to
 * the native app, with a `?preview` escape for web testing). Finishing a
 * session writes one completed log via /api/logs.
 */
export default async function WorkoutPage({
  params,
}: {
  params: Promise<{ id: string; week: string; day: string }>;
}) {
  const { id, week, day } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const COLUMNS = "id, name, program_data, input_snapshot";
  const { data: ownProgram } = await supabase
    .from("programs")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  // The admin's preview of an athlete's program links here too; RLS hides
  // other athletes' programs, so the administrator reads it with the service
  // role (see the note in ../../../page.tsx). Read only.
  let program = ownProgram;
  if (!program && (await getAdmin())) {
    const adminDb = createAdminClient();
    const { data } = await adminDb.from("programs").select(COLUMNS).eq("id", id).maybeSingle();
    program = data;
  }
  if (!program) notFound();

  const data = program.program_data as ProgramData | null;
  const weekNumber = Number(week);
  const w = data?.weeks.find((x) => x.weekNumber === weekNumber);
  const sessions = w?.days.find((d) => d.day === day)?.sessions ?? [];

  // The athlete's own anchors, so a brick's legs read as watts and a pace rather
  // than as two bare zones. Read from the program's stored inputs — the same
  // place `/program/[id]` reads them — and computed at RENDER, so a program
  // generated before this shipped gains its targets without regeneration.
  const snapshot = program.input_snapshot as GenerationInput | null;
  const bench = snapshot?.profile?.benchmarks;
  const targets: BrickTargets = {
    ftpWatts: bench?.ftpWatts,
    paces: computePaces(bench ?? null),
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Link href={`/program/${id}`} className="text-sm text-zinc-500 hover:text-black">
          ← Back to program
        </Link>
        <span className="text-xs text-zinc-400">
          Week {weekNumber} · {day.toUpperCase()}
        </span>
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Workout view</h1>
      <WorkoutView
        programId={id}
        weekNumber={weekNumber}
        day={day}
        sessions={sessions}
        targets={targets}
      />
    </main>
  );
}
