import Link from "next/link";
import type { ProgramData } from "@/lib/schemas";
import PhaseTimeline from "./phase-timeline";
import WeekNav from "./week-nav";
import WeekCard from "./week-card";
import WeekSummaryTable from "./week-summary-table";
import { PHASE_COLORS, phaseBands } from "./format";
import RegenerateButton from "@/app/program/[id]/regenerate-button";

export interface ProgramMeta {
  programId: string;
  name: string;
  durationWeeks: number;
  programType: string;
  startDate: string;
}

const PROGRAM_TYPE_LABEL: Record<string, string> = {
  goal_event: "Goal event",
  fixed_duration: "Fixed duration",
  general_fitness: "General fitness",
};

/** Mesocycle legend: which weeks belong to each phase (Tasks addition #2). */
function MesocycleLegend({ weeks }: { weeks: ProgramData["weeks"] }) {
  const bands = phaseBands(weeks);
  return (
    <div className="flex flex-wrap gap-2">
      {bands.map((b, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${PHASE_COLORS[b.phase].chip}`}
        >
          <span className={`h-2 w-2 rounded-full ${PHASE_COLORS[b.phase].band}`} />
          <span className="font-medium">{b.label}</span>
          <span className="opacity-80">
            {b.startWeek === b.endWeek ? `week ${b.startWeek}` : `weeks ${b.startWeek}–${b.endWeek}`} ({b.weeks} wk{b.weeks > 1 ? "s" : ""})
          </span>
        </span>
      ))}
    </div>
  );
}

/** Full program view: header + timeline + mesocycle legend + sticky week nav,
 *  a scrolling column of week cards, and a sticky weekly-summary sidebar. */
export default function ProgramView({ program, meta }: { program: ProgramData; meta: ProgramMeta }) {
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
            <RegenerateButton programId={meta.programId} />
            <Link href="/dashboard" className="text-sm underline">
              Dashboard
            </Link>
          </div>
        </div>
        <PhaseTimeline weeks={program.weeks} />
        <MesocycleLegend weeks={program.weeks} />
      </header>

      <WeekNav weeks={program.weeks} />

      {/* Weeks + sticky summary sidebar */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {program.weeks.map((w) => (
            <WeekCard key={w.weekNumber} week={w} startDate={meta.startDate} />
          ))}
        </div>
        <aside className="hidden w-72 shrink-0 lg:block print:hidden">
          <div className="sticky top-4">
            <WeekSummaryTable weeks={program.weeks} />
          </div>
        </aside>
      </div>
    </div>
  );
}
