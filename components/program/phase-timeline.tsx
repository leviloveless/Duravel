import type { ProgramWeek } from "@/lib/schemas";
import { PHASE_COLORS, phaseBands, phaseDateRangeLabel, raceMarkers } from "./format";

/**
 * Mesocycle timeline: Base/Build/Peak/Taper bands sized by week count. Each band
 * carries its phase name, week count, and begin→end dates (Tasks addition #4),
 * so no separate legend/bubbles are needed. Race weeks are marked below.
 */
export default function PhaseTimeline({ weeks, startDate }: { weeks: ProgramWeek[]; startDate: string }) {
  const bands = phaseBands(weeks);
  const total = weeks.length || 1;
  const races = raceMarkers(weeks);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Coloured bands */}
      <div className="flex h-9 w-full overflow-hidden rounded-lg">
        {bands.map((b, i) => (
          <div
            key={i}
            className={`flex items-center justify-center ${PHASE_COLORS[b.phase].band} px-1 text-center text-[11px] font-semibold text-white`}
            style={{ width: `${(b.weeks / total) * 100}%` }}
            title={`${b.label}: ${b.weeks} weeks (${phaseDateRangeLabel(startDate, b.startWeek, b.endWeek)})`}
          >
            {b.weeks >= 2 ? b.label : ""}
          </div>
        ))}
      </div>

      {/* Per-band captions: weeks + date range, aligned under each band */}
      <div className="flex w-full">
        {bands.map((b, i) => (
          <div key={i} className="min-w-0 px-1 text-center" style={{ width: `${(b.weeks / total) * 100}%` }}>
            <span className="block truncate text-[11px] font-medium text-zinc-700">
              {b.label} · {b.weeks} wk{b.weeks > 1 ? "s" : ""}
            </span>
            <span className="block truncate text-[10px] text-zinc-500">
              {phaseDateRangeLabel(startDate, b.startWeek, b.endWeek)}
            </span>
          </div>
        ))}
      </div>

      {races.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {races.map((r) => (
            <span key={r.weekNumber} className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
              {r.priority} race · week {r.weekNumber}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
