import Link from "next/link";
import type { ProgramData, WorkoutLog } from "@/lib/schemas";
import type { ZoneBands } from "./format";
import PhaseTimeline from "./phase-timeline";
import WeekNav from "./week-nav";
import WeekCard from "./week-card";
import WeekSummaryTable from "./week-summary-table";
import AdaptReview from "./adapt-review";
import RegenerateButton from "@/app/program/[id]/regenerate-button";

export interface ProgramMeta {
  programId: string;
  name: string;
  durationWeeks: number;
  programType: string;
  startDate: string;
  maxHR: number;
  /** Custom HR zone bands (new-additions #3); omit for the standard bands. */
  zoneBands?: ZoneBands;
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
}: {
  program: ProgramData;
  meta: ProgramMeta;
  activity?: ProgramActivity;
}) {
  const logsByWeek = new Map<number, WorkoutLog[]>();
  for (const l of activity?.logs ?? []) {
    const list = logsByWeek.get(l.weekNumber) ?? [];
    list.push(l);
    logsByWeek.set(l.weekNumber, list);
  }
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

      <WeekNav weeks={program.weeks} />

      {/* Weeks + sticky summary sidebar */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
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
                    }
                  : undefined
              }
            />
          ))}
        </div>
        <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:block lg:w-72 lg:self-start print:hidden">
          <WeekSummaryTable weeks={program.weeks} />
        </aside>
      </div>
    </div>
  );
}
