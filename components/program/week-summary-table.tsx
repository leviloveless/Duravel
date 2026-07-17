import type { ProgramData, Session, WorkoutLog } from "@/lib/schemas";
import { weekTimeByCategory } from "@/lib/session-volume";
import { zoneEntries } from "./format";

type TrainingDay = WorkoutLog["day"];

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

/** Cardio-type session kinds (weightlifting is excluded from cardio time). */
const CARDIO_KINDS = new Set<Session["kind"]>(["run", "hybrid", "cardio", "swim", "bike", "brick"]);

/** Actual (logged) miles + cardio minutes for a week, from its workout logs. */
function weekActuals(week: ProgramData["weeks"][number], logs: WorkoutLog[]) {
  const sessionsByDay = new Map<TrainingDay, Session[]>();
  for (const d of week.days) sessionsByDay.set(d.day, d.sessions);
  let miles = 0;
  let cardioMin = 0;
  let hasMiles = false;
  let hasCardio = false;
  for (const log of logs) {
    const a = log.actuals;
    if (!a) continue;
    const session = sessionsByDay.get(log.day)?.[log.sessionIndex];
    if (typeof a.distanceMiles === "number") {
      miles += a.distanceMiles;
      hasMiles = true;
    }
    if (typeof a.durationMin === "number" && session && CARDIO_KINDS.has(session.kind)) {
      cardioMin += a.durationMin;
      hasCardio = true;
    }
  }
  return {
    miles: hasMiles ? Math.round(miles * 10) / 10 : null,
    cardioMin: hasCardio ? Math.round(cardioMin) : null,
  };
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 text-right tabular-nums ${className}`}>{children}</td>;
}

/**
 * Per-week summary table. Shows the microcycle, planned vs. actual cardio time
 * and mileage (Tasks addition #6), the weekly training-time breakdown —
 * metcon / strength / total (Tasks addition #3), weekly average resting HR + HRV
 * (Tasks addition #7), and the HR-zone distribution. Rendered full-width so the
 * whole table is visible without horizontal scrolling (Tasks addition #10).
 */
export default function WeekSummaryTable({
  weeks,
  logsByWeek,
  recoveryByWeek,
}: {
  weeks: ProgramData["weeks"];
  logsByWeek?: Map<number, WorkoutLog[]>;
  recoveryByWeek?: Map<number, WeekRecovery>;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold">Weekly summary</h2>
        <p className="text-xs text-zinc-500">
          Planned vs. actual cardio &amp; mileage · training-time breakdown · recovery · zone mix
        </p>
      </div>
      <div className="max-h-[70vh] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[46rem] text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-zinc-500">
            <tr className="text-[10px] uppercase tracking-wide">
              <th className="px-3 py-1.5 text-left font-medium" rowSpan={2}>
                Wk
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
              <th className="border-l border-zinc-200 px-2 py-1.5 text-center font-medium" colSpan={3}>
                Training time
              </th>
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
              <th className="border-l border-zinc-200 px-2 py-1 text-right font-medium">Metcon</th>
              <th className="px-2 py-1 text-right font-medium">Strength</th>
              <th className="px-2 py-1 text-right font-medium">Total</th>
              <th className="border-l border-zinc-200 px-2 py-1 text-right font-medium">RHR</th>
              <th className="px-2 py-1 text-right font-medium">HRV</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const logs = logsByWeek?.get(w.weekNumber) ?? [];
              const actuals = weekActuals(w, logs);
              const time = weekTimeByCategory(w);
              const rec = recoveryByWeek?.get(w.weekNumber);
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
                  <Cell className="text-zinc-500">{actuals.cardioMin != null ? `${actuals.cardioMin}m` : "—"}</Cell>
                  <Cell className="border-l border-zinc-100">{w.summary.totalMileage}</Cell>
                  <Cell className="text-zinc-500">{actuals.miles != null ? actuals.miles : "—"}</Cell>
                  <Cell className="border-l border-zinc-100">{time.metcon}m</Cell>
                  <Cell>{time.strength}m</Cell>
                  <Cell className="font-medium text-zinc-800">{time.total}m</Cell>
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
