import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ProgramData } from "@/lib/schemas";
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

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, program_data")
    .eq("id", id)
    .single();
  if (!program) notFound();

  const data = program.program_data as ProgramData | null;
  const weekNumber = Number(week);
  const w = data?.weeks.find((x) => x.weekNumber === weekNumber);
  const sessions = w?.days.find((d) => d.day === day)?.sessions ?? [];

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
      <WorkoutView programId={id} weekNumber={weekNumber} day={day} sessions={sessions} />
    </main>
  );
}
