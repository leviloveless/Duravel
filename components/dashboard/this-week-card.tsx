import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ProgramData, WorkoutLog } from "@/lib/schemas";
import { adherenceStreak } from "@/lib/engine/adapt";
import { getProgramLogs } from "@/lib/supabase/queries";
import { sessionTypeLabel, weekStartDate } from "@/components/program/format";

/**
 * Dashboard "This week" card (Phase 2, Milestone 11 — phase2-spec.md §3c).
 *
 * For the user's most recent ready program that's currently in progress:
 * today's sessions, quick link to the program week, log state at a glance,
 * and the adherence streak (consecutive weeks ≥80% of sessions completed).
 * Renders nothing when there's no active program — the dashboard stays clean.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export default async function ThisWeekCard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Most recent ready program that has started and hasn't finished.
  const { data: programs } = await supabase
    .from("programs")
    .select("id, name, duration_weeks, start_date, program_data")
    .eq("user_id", user.id)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(5);
  if (!programs?.length) return null;

  const now = Date.now();
  const active = programs.find((p) => {
    const start = weekStartDate(p.start_date, 1).getTime();
    return now >= start && now < start + p.duration_weeks * MS_PER_WEEK && p.program_data;
  });
  if (!active) return null;

  const data = active.program_data as ProgramData;
  const start = weekStartDate(active.start_date, 1).getTime();
  const currentWeekNumber = Math.min(
    active.duration_weeks,
    Math.floor((now - start) / MS_PER_WEEK) + 1,
  );
  const week = data.weeks.find((w) => w.weekNumber === currentWeekNumber);
  if (!week) return null;

  const todayKey = DAY_KEYS[new Date().getDay()];
  const todaySessions = week.days.find((d) => d.day === todayKey)?.sessions ?? [];

  const logRows = await getProgramLogs(active.id);
  const logs: WorkoutLog[] = logRows.map((r) => ({
    weekNumber: r.week_number,
    day: r.day,
    sessionIndex: r.session_index,
    status: r.status,
    rpe: r.rpe,
    actuals: r.actuals,
    note: r.note,
  }));
  const todayLogged = (i: number) =>
    logs.find((l) => l.weekNumber === currentWeekNumber && l.day === todayKey && l.sessionIndex === i);

  const lastElapsed = Math.min(active.duration_weeks, Math.max(0, Math.floor((now - start) / MS_PER_WEEK)));
  const streak = lastElapsed >= 1 ? adherenceStreak(data.weeks, logs, lastElapsed) : 0;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">This week</h2>
          <span className="text-xs text-zinc-500">
            Week {currentWeekNumber} of {active.duration_weeks} · {active.name ?? "Your program"}
          </span>
        </div>
        {streak > 0 && (
          <span
            className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"
            title="Consecutive weeks with at least 80% of sessions completed"
          >
            {streak}-week streak
          </span>
        )}
      </div>

      <div className="mt-3">
        {todaySessions.length === 0 ? (
          <p className="text-sm text-zinc-500">Rest day today. Recover well.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {todaySessions.map((s, i) => {
              const log = todayLogged(i);
              return (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-zinc-800">{sessionTypeLabel(s)}</span>
                  {log ? (
                    <span className="text-xs font-medium text-emerald-700">
                      {log.status === "completed" ? "✓ Done" : log.status === "partial" ? "½ Partial" : "✗ Skipped"}
                      {log.rpe != null && ` · RPE ${log.rpe}`}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">Not logged</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Link
        href={`/program/${active.id}#week-${currentWeekNumber}`}
        className="mt-3 inline-block text-sm underline"
      >
        Open week {currentWeekNumber}
      </Link>
    </section>
  );
}
