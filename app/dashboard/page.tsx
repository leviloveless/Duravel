import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getUserPrograms, type ProgramSummaryRow } from "@/lib/supabase/queries";
import { signOut } from "@/app/login/actions";
import ThisWeekCard from "@/components/dashboard/this-week-card";
import TrialBanner from "@/components/trial-banner";
import RenameProgram from "./rename-program";
import DeleteProgram from "./delete-program";

const TYPE_LABEL: Record<string, string> = {
  goal_event: "Goal event",
  fixed_duration: "Fixed duration",
  general_fitness: "General fitness",
};

const STATUS_STYLE: Record<ProgramSummaryRow["status"], string> = {
  ready: "bg-emerald-100 text-emerald-800",
  generating: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function programTitle(p: ProgramSummaryRow): string {
  return p.name ?? `${p.duration_weeks}-week ${TYPE_LABEL[p.program_type] ?? p.program_type} program`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, programs] = await Promise.all([getCurrentProfile(), getUserPrograms()]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {profile ? `Welcome back, ${profile.first_name}` : "Your programs"}
        </h1>
        <form action={signOut}>
          <button type="submit" className="text-sm text-zinc-500 underline">
            Sign out
          </button>
        </form>
      </div>

      <TrialBanner />

      <ThisWeekCard />

      <Link
        href="/onboarding"
        className="self-start rounded-full bg-black px-6 py-3 text-white transition-colors hover:bg-zinc-800"
      >
        {programs.length > 0 ? "Build a new program" : "Build your program"}
      </Link>

      {programs.length === 0 ? (
        <p className="text-zinc-600">You haven&apos;t generated any programs yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {programs.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 pr-3 transition-colors hover:bg-zinc-50">
              <Link href={`/program/${p.id}`} className="flex flex-1 items-center justify-between px-4 py-3">
                <span className="flex flex-col">
                  <span className="font-medium">{programTitle(p)}</span>
                  <span className="text-xs text-zinc-500">
                    {p.duration_weeks} weeks · {TYPE_LABEL[p.program_type] ?? p.program_type} · created {formatDate(p.created_at)}
                  </span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}>
                  {p.status === "ready" ? "Ready" : p.status === "generating" ? "Generating…" : "Failed"}
                </span>
              </Link>
              <RenameProgram programId={p.id} currentName={programTitle(p)} />
              <DeleteProgram programId={p.id} title={programTitle(p)} />
            </li>
          ))}
        </ul>
      )}

      {profile && (
        <Link href="/profile" className="self-start text-sm underline">
          Edit profile
        </Link>
      )}
    </main>
  );
}
