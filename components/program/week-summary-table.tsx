import type { ProgramData } from "@/lib/schemas";
import { weekCardioMinutes, weekMileage, zoneEntries } from "./format";

/**
 * Compact per-week summary table (Tasks addition #5): total cardio time, total
 * mileage, and the HR-zone distribution for each week. Rendered inside a sticky
 * sidebar on the program view so it follows the screen while scrolling.
 */
export default function WeekSummaryTable({ weeks }: { weeks: ProgramData["weeks"] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold">Weekly summary</h2>
        <p className="text-xs text-zinc-500">Cardio time · mileage · zone mix</p>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Wk</th>
              <th className="px-2 py-2 text-right font-medium">Cardio</th>
              <th className="px-2 py-2 text-right font-medium">Miles</th>
              <th className="px-3 py-2 text-left font-medium">Zones</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekNumber} className="border-t border-zinc-100">
                <td className="px-3 py-2">
                  <a href={`#week-${w.weekNumber}`} className="font-medium text-zinc-800 hover:underline">
                    {w.weekNumber}
                  </a>
                  {w.raceDay && <span className="ml-1 text-red-600" title={`${w.raceDay.priority} race`}>●</span>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{weekCardioMinutes(w)}m</td>
                <td className="px-2 py-2 text-right tabular-nums">{weekMileage(w)}</td>
                <td className="px-3 py-2">
                  <div className="flex h-2 w-24 overflow-hidden rounded-full" title="Zone distribution">
                    {zoneEntries(w.summary.zoneDistribution).map((e) => (
                      <div key={e.zone} className={e.barClass} style={{ width: `${e.pct}%` }} title={`${e.label}: ${e.pct}%`} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
