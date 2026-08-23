import React from "react";
import type { ExtraWorkout, ProgramData, WorkoutLog } from "@/lib/schemas";
import { weekTimeByCategory, weekIronmanTime } from "@/lib/session-volume";
import { weekActualTimeByCategory } from "@/lib/program/week-actual-time";
import { zoneEntries, weekStartDate } from "./format";

/** Microcycle label + pill styling for the weekly summary "Cycle" column. */
const MICRO_TAG: Record<string, { label: string; className: string }> = {
  increase: { label: "Increase", className: "bg-emerald-100 text-emerald-700" },
  rebound: { label: "Rebound", className: "bg-sky-100 text-sky-700" },
  deload: { label: "Deload", className: "bg-amber-100 text-amber-700" },
  taper: { label: "Taper", className: "bg-violet-100 text-violet-700" },
  race: { label: "Race", className: "bg-red-100 text-red-700" },
};

/** Weekly average resting HR + HRV (Tasks addition #7), aligned to program weeks. */
export interface WeekRecovery {
  restingHr: number | null;
  hrv: number | null;
}

/** Compact week-start date label (e.g. "Jul 14") for the Dates column (Tasks addition #2). */
function weekDateLabel(startDate: string, weekNumber: number): string {
  // SAFE, do not "fix": the Date here comes from `parseISODate`, which builds
  // LOCAL midnight from a YYYY-MM-DD string. Both the server and the browser
  // therefore name the same calendar day, so there is no hydration mismatch.
  // Routing this through `formatInstant` would shift it by a zone offset and
  // CREATE the bug that helper exists to prevent (see lib/timezone.ts).
  return weekStartDate(startDate, weekNumber).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 text-right tabular-nums ${className}`}>{children}</td>;
}

/**
 * Per-week summary table. Shows the week's calendar start date (Tasks addition #2),
 * the microcycle, planned vs. actual cardio time and mileage (Tasks addition #6),
 * the weekly training-time breakdown (Tasks addition #3) — hybrid / strength / total
 * for HYROX/DEKA, or swim / bike / run / lift / total for triathlon, each now
 * PLANNED VS. ACTUAL (Levi, 2026-08-22) — weekly average
 * resting HR + HRV (Tasks addition #7), and the HR-zone distribution. Rendered
 * full-width so the whole table is visible without horizontal scrolling (Tasks #10).
 */
export default function WeekSummaryTable({
  weeks,
  startDate,
  isTriathlon = false,
  logsByWeek,
  extrasByWeek,
  recoveryByWeek,
}: {
  weeks: ProgramData["weeks"];
  startDate: string;
  /** Triathlon programs show swim/bike/run/lift time instead of hybrid/strength. */
  isTriathlon?: boolean;
  logsByWeek?: Map<number, WorkoutLog[]>;
  /** Off-plan work, which counts toward the ACTUAL columns (Levi, 2026-08-22). */
  extrasByWeek?: Map<number, ExtraWorkout[]>;
  recoveryByWeek?: Map<number, WeekRecovery>;
}) {
  const timeGroups = isTriathlon
    ? (["Swim", "Bike", "Run", "Lift", "Total"] as const)
    : (["Hybrid", "Strength", "Total"] as const);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold">Weekly summary</h2>
        <p className="text-xs text-zinc-500">
          Dates · planned vs. actual cardio, mileage and training time · recovery · zone mix
        </p>
      </div>
      <div className="max-h-[70vh] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[64rem] text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-zinc-500">
            <tr className="text-[10px] uppercase tracking-wide">
              <th className="px-3 py-1.5 text-left font-medium" rowSpan={2}>
                Wk
              </th>
              <th className="px-2 py-1.5 text-left font-medium" rowSpan={2}>
                Dates
              </th>
              <th className="px-2 py-1.5 text-left font-medium" rowSpan={2}>
                Cycle
              </th>
              <th className="border-l border-zinc-200 px-2 py-1.5 text-center font-medium" colSpan={2}>
                Cardio time
              </th>
              <th className="border-l border-zinc-200 px-2 py-1.5 text-center font-medium" colSpan={2}>
                Miles
              </th>
              {timeGroups.map((label) => (
                <th
                  key={label}
                  className="border-l border-zinc-200 px-2 py-1.5 text-center font-medium"
                  colSpan={2}
                >
                  {label}
                </th>
              ))}
              <th className="border-l border-zinc-200 px-2 py-1.5 text-center font-medium" colSpan={2}>
                Recovery avg
              </th>
              <th className="border-l border-zinc-200 px-3 py-1.5 text-left font-medium" rowSpan={2}>
                Zones
              </th>
            </tr>
            <tr className="text-[10px]">
              <th className="border-l border-zinc-200 px-2 py-1 text-right font-medium">Plan</th>
              <th className="px-2 py-1 text-right font-medium">Act</th>
              <th className="border-l border-zinc-200 px-2 py-1 text-right font-medium">Plan</th>
              <th className="px-2 py-1 text-right font-medium">Act</th>
              {timeGroups.map((label) => (
                <React.Fragment key={label}>
                  <th className="border-l border-zinc-200 px-2 py-1 text-right font-medium">Plan</th>
                  <th className="px-2 py-1 text-right font-medium">Act</th>
                </React.Fragment>
              ))}
              <th className="border-l border-zinc-200 px-2 py-1 text-right font-medium">RHR</th>
              <th className="px-2 py-1 text-right font-medium">HRV</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const logs = logsByWeek?.get(w.weekNumber) ?? [];
              const extras = extrasByWeek?.get(w.weekNumber) ?? [];
              const actual = weekActualTimeByCategory(w, logs, extras);
              const rec = recoveryByWeek?.get(w.weekNumber);
              const tri = isTriathlon ? weekIronmanTime(w) : null;
              const time = isTriathlon ? null : weekTimeByCategory(w);
              // Same order as `timeGroups`. `null` on the actual side means "no
              // logs yet", which prints a dash — a week logged as entirely
              // skipped prints 0, and the two are not the same thing.
              const timeCells: { plan: number; act: number | null }[] =
                isTriathlon ?
                  [
                    { plan: tri!.swim, act: actual.any ? actual.ironman.swim : null },
                    { plan: tri!.bike, act: actual.any ? actual.ironman.bike : null },
                    { plan: tri!.run, act: actual.any ? actual.ironman.run : null },
                    { plan: tri!.lift, act: actual.any ? actual.ironman.lift : null },
                    { plan: tri!.total, act: actual.any ? actual.ironman.total : null },
                  ]
                : [
                    { plan: time!.hybrid, act: actual.any ? actual.hybrid : null },
                    { plan: time!.strength, act: actual.any ? actual.strength : null },
                    { plan: time!.total, act: actual.any ? actual.total : null },
                  ];
              return (
                <tr key={w.weekNumber} className="border-t border-zinc-100">
                  <td className="px-3 py-2">
                    <a href={`#week-${w.weekNumber}`} className="font-medium text-zinc-800 hover:underline">
                      {w.weekNumber}
                    </a>
                    {w.raceDay && (
                      <span className="ml-1 text-red-600" role="img" aria-label={`${w.raceDay.priority} race`}>
                        ●
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-left text-zinc-500 tabular-nums">
                    {weekDateLabel(startDate, w.weekNumber)}
                  </td>
                  <td className="px-2 py-2">
                    {(() => {
                      const tag = MICRO_TAG[w.microWeek];
                      return tag ? (
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${tag.className}`}>
                          {tag.label}
                        </span>
                      ) : null;
                    })()}
                  </td>
                  <Cell className="border-l border-zinc-100">{w.summary.totalCardioMinutes}m</Cell>
                  <Cell className="text-zinc-500">
                    {actual.any ? `${actual.cardioMinutes}m` : "—"}
                  </Cell>
                  <Cell className="border-l border-zinc-100">{w.summary.totalMileage}</Cell>
                  <Cell className="text-zinc-500">{actual.any ? actual.miles : "—"}</Cell>
                  {timeCells.map((c, idx) => (
                    <React.Fragment key={timeGroups[idx]}>
                      <Cell
                        className={`border-l border-zinc-100 ${
                          idx === timeCells.length - 1 ? "font-medium text-zinc-800" : ""
                        }`}
                      >
                        {c.plan}m
                      </Cell>
                      <Cell className="text-zinc-500">{c.act != null ? `${c.act}m` : "—"}</Cell>
                    </React.Fragment>
                  ))}
                  <Cell className="border-l border-zinc-100 text-zinc-500">
                    {rec?.restingHr != null ? rec.restingHr : "—"}
                  </Cell>
                  <Cell className="text-zinc-500">{rec?.hrv != null ? rec.hrv : "—"}</Cell>
                  <td className="border-l border-zinc-100 px-3 py-2">
                    <div
                      className="flex h-2 w-24 overflow-hidden rounded-full"
                      role="img"
                      aria-label={`Zone mix: ${zoneEntries(w.summary.zoneDistribution)
                        .map((e) => `${e.label} ${e.pct}%`)
                        .join(", ")}`}
                    >
                      {zoneEntries(w.summary.zoneDistribution).map((e) => (
                        <div
                          key={e.zone}
                          className={e.barClass}
                          style={{ width: `${e.pct}%` }}
                          title={`${e.label}: ${e.pct}%`}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
