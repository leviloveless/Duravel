import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProgramData } from "@/lib/schemas";
import GenerateTrigger from "./generate-trigger";

export default async function ProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: program } = await supabase
    .from("programs")
    .select("id, status, duration_weeks, program_type, program_data")
    .eq("id", id)
    .single();

  if (!program) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-24">
        <h1 className="text-2xl font-semibold">Program not found</h1>
        <Link href="/dashboard" className="text-sm underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const data = program.program_data as ProgramData | null;

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your program</h1>
        <Link href="/dashboard" className="text-sm underline">
          Dashboard
        </Link>
      </div>
      <p className="text-sm text-zinc-500">
        {program.duration_weeks}-week {program.program_type.replace("_", " ")} program.
      </p>

      {program.status !== "ready" && (
        <GenerateTrigger programId={program.id} initialStatus={program.status === "failed" ? "failed" : "generating"} />
      )}

      {program.status === "ready" && data && (
        <div className="flex flex-col gap-2">
          <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Program ready — {data.weeks.length} weeks generated. The full week-by-week view lands in Milestone 6.
          </p>
        </div>
      )}
    </main>
  );
}
