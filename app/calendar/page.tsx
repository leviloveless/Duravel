import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProgramExtras, getProgramLogs } from "@/lib/supabase/queries";
import { extrasFromRows } from "@/lib/extra-workouts";
import { weekStartDate } from "@/components/program/format";
import type { ProgramData, WorkoutLog } from "@/lib/schemas";
import { buildMonth, monthLabel, shiftMonth } from "@/lib/dashboard/calendar";
import { asHours } from "@/lib/dashboard/derive";
import CalendarGrid from "@/components/dashboard/calendar-grid";

export const metadata: Metadata = {
  title: "Calendar — Duravel",
  description: "Your training month, planned and completed.",
};

/** Today as a local calendar date — see the note in lib/signup-checks.ts. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const clampMonth = (n: number) => Math.min(12, Math.max(1, n));

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = todayISO();
  const params = await searchParams;
  const now = new Date();
  const year = Number(params.y) || now.getFullYear();
  const month = clampMonth(Number(params.m) || now.getMonth() + 1);

  // Every ready program, not just the active one: an athlete running a HYROX
  // block alongside a tune-up plan should see both on one calendar.
  const { data: rows } = await supabase
    .from("programs")
    .select("id, name, duration_weeks, start_date, program_data")
    .eq("user_id", user.id)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(6);

  const programs = await Promise.all(
    (rows ?? [])
      .filter((p) => p.program_data)
      .map(async (p) => {
        const [logRows, extraRows] = await Promise.all([
          getProgramLogs(p.id),
          getProgramExtras(p.id),
        ]);
        const logs: WorkoutLog[] = logRows.map((r) => ({
          weekNumber: r.week_number,
          day: r.day,
          sessionIndex: r.session_index,
          status: r.status,
          rpe: r.rpe,
          actuals: r.actuals,
          note: r.note,
        }));
        return {
          id: p.id,
          weeks: (p.program_data as ProgramData).weeks,
          logs,
          extras: extrasFromRows(extraRows),
          weekStartISO: (n: number) => {
            const d = weekStartDate(p.start_date, n);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          },
        };
      }),
  );

  const grid = buildMonth(year, month, today, programs);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const monthPlanned = grid.reduce((s, w) => s + w.plannedMin, 0);
  const monthDone = grid.reduce((s, w) => s + w.completedMin, 0);
  const monthMiles = grid.reduce((s, w) => s + w.miles, 0);

  const navLink = "border-line-strong rounded-md border px-3 py-1.5 text-sm hover:bg-zinc-50";

  return (
    <main className="mx-auto flex w-full max-w-[88rem] flex-col gap-4 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold tracking-wide uppercase">
          {monthLabel(year, month)}
        </h1>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/calendar?y=${prev.year}&m=${prev.month}`}
            className={navLink}
            aria-label="Previous month"
          >
            ←
          </Link>
          <Link href="/calendar" className={navLink}>
            Today
          </Link>
          <Link
            href={`/calendar?y=${next.year}&m=${next.month}`}
            className={navLink}
            aria-label="Next month"
          >
            →
          </Link>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-zinc-600">
          <span>
            <b className="text-zinc-900">{asHours(monthDone)}</b> / {asHours(monthPlanned)} h
          </span>
          <span>
            <b className="text-zinc-900">{Math.round(monthMiles * 10) / 10}</b> mi
          </span>
        </div>
      </header>

      {programs.length === 0 ? (
        <div className="border-line rounded-xl border bg-zinc-50 p-8 text-center">
          <p className="text-zinc-600">
            Nothing on the calendar yet.{" "}
            <Link href="/onboarding" className="text-accent underline">
              Build a program
            </Link>{" "}
            and every session will land here.
          </p>
        </div>
      ) : (
        <CalendarGrid weeks={grid} />
      )}
    </main>
  );
}
