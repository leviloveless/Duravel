import Link from "next/link";
import type { ProgramData, WorkoutLog } from "@/lib/schemas";
import type { ZoneBands } from "./format";
import type { SyncSuggestion, SyncActivitySummary } from "@/lib/wearables/suggest-data";
import PhaseTimeline from "./phase-timeline";
import WeekNav from "./week-nav";
import WeekCard from "./week-card";
import WeekSummaryTable, { type WeekRecovery } from "./week-summary-table";
import AdaptReview from "./adapt-review";
import SyncSuggestions from "./sync-suggestions";
import RegenerateButton from "@/app/program/[id]/regenerate-button";
import ResultCardLauncher from "./result-card-launcher";

export interface ProgramMeta {
  programId: string;
  name: string;
  durationWeeks: number;
  programType: string;
  startDate: string;
  maxHR: number;
  /** Sport id (e.g. "hyrox", "tri_140_6"); drives triathlon-specific views. */
  sport?: string;
  /** Custom HR zone bands (new-additions #3); omit for the standard bands. */
  zoneBands?: ZoneBands;
  /** Athlete first name for shareable result cards. */
  athleteName?: string;
}

/** Phase 2 logging/adaptation state, assembled by the program page. */
export interface ProgramActivity {
  logs: WorkoutLog[];
  /** Weeks whose review was applied → their logs are frozen. */
  frozenWeeks: number[];
  /** Weeks that were revised by an adaptation (target weeks). */
  adaptedWeeks: number[];
  /** The week awaiting review, if any. */
  reviewWeek: number | null;
  /** Weekly average resting HR + HRV by week number (Tasks addition #7). */
  recoveryByWeek?: Map<number, WeekRecovery>;
}

const PROGRAM_TYPE_LABEL: Record<string, string> = {
  goal_event: "Goal event",
  fixed_duration: "Fixed duration",
  general_fitness: "General fitness",
};

/** Full program view: header + timeline (weeks + phase dates) + sticky week nav,
 *  a scrolling column of week cards, and a sticky weekly-summary sidebar. */
export default function ProgramView({
  program,
  meta,
  activity,
  suggestions,
  linking,
}: {
  program: ProgramData;
  meta: ProgramMeta;
  activity?: ProgramActivity;
  /** Same-day link suggestions for synced-but-unlinked activities (Increment 3). */
  suggestions?: SyncSuggestion[];
  /** In-view sync-linking data: attachable workouts + per-session linked state. */
  linking?: {
    linkableActivities: SyncActivitySummary[];
    linkedBySession: Record<string, SyncActivitySummary>;
  };
}) {
  const logsByWeek = new Map<number, WorkoutLog[]>();
  for (const l of activity?.logs ?? []) {
    const list = logsByWeek.get(l.weekNumber) ?? [];
    list.push(l);
    logsByWeek.set(l.weekNumber, list);
  }
  const totalSessions = program.weeks.reduce(
    (n, w) => n + w.days.reduce((m, d) => m + d.sessions.filter((se) => se.kind !== "race").length, 0),
    0,
  );
  const completedSessions = (activity?.logs ?? []).filter((l) => l.status === "completed").length;
  const progStat1 = totalSessions > 0 ? `${completedSessions} / ${totalSessions}` : "";

  const isTriathlon = (meta.sport ?? "").startsWith("tri_");
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{meta.name}</h1>
            <p className="text-sm text-zinc-500">
              {meta.durationWeeks} weeks · {PROGRAM_TYPE_LABEL[meta.programType] ?? meta.programType}
            </p>
          </div>
          <div className="flex items-center gap-3 print:hidden">
            <Link
              href={`/program/${meta.programId}/edit`}
              className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              Edit inputs
            </Link>
            <RegenerateButton programId={meta.programId} />
            <ResultCardLauncher
              initial={{
                type: "program",
                progName: meta.name,
                progStat1,
                athlete: meta.athleteName ?? "",
              }}
            />
            <Link href="/dashboard" className="text-sm underline">
              Dashboard
            </Link>
          </div>
        </div>
        <PhaseTimeline weeks={program.weeks} startDate={meta.startDate} />
      </header>

      {activity?.reviewWeek != null && (
        <AdaptReview programId={meta.programId} weekNumber={activity.reviewWeek} />
      )}

      {suggestions && suggestions.length > 0 && (
        <SyncSuggestions programId={meta.programId} suggestions={suggestions} />
      )}

      <WeekNav weeks={program.weeks} />

      {/* Full-width weekly summary (extended so the whole table is visible
          without horizontal scroll — Tasks addition #10). */}
      <WeekSummaryTable
        weeks={program.weeks}
        startDate={meta.startDate}
        isTriathlon={isTriathlon}
        logsByWeek={logsByWeek}
        recoveryByWeek={activity?.recoveryByWeek}
      />

      {/* Week cards */}
      <div className="flex flex-col gap-6">
        {program.weeks.map((w) => (
          <WeekCard
            key={w.weekNumber}
            week={w}
            startDate={meta.startDate}
            maxHR={meta.maxHR}
            zoneBands={meta.zoneBands}
            logging={
              activity
                ? {
                    programId: meta.programId,
                    logs: logsByWeek.get(w.weekNumber) ?? [],
                    frozen: activity.frozenWeeks.includes(w.weekNumber),
                    adapted: activity.adaptedWeeks.includes(w.weekNumber),
                    linkableActivities: linking?.linkableActivities ?? [],
                    linkedBySession: linking?.linkedBySession ?? {},
                  }
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
